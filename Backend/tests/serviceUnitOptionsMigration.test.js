import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { QUOTE_DECIMAL_FORMATS } from "../src/domain/quoteTotals.js";
import {
  assertPrismaMatchesMigrations,
  backendDirectory,
  createTableBody,
  listMigrations,
  readMigrationStatements,
  sqlColumns,
} from "./helpers/migrationSchema.js";

const MIGRATION_NAME = "20261027120000_service_unit_options";
const SINGLE_UNIT_MIGRATION = "20261030120000_service_single_unit_option";
// Límite histórico de unidades por servicio fijado por 20261027120000 (antes de la unidad única).
const HISTORICAL_UNIT_OPTIONS_MAX = 10;
const NEW_TABLES = ["service_unit_options", "service_version_unit_options"];
const RATE_TYPE = `NUMERIC(${QUOTE_DECIMAL_FORMATS.unitRate.maxIntegerDigits + QUOTE_DECIMAL_FORMATS.unitRate.scale},${QUOTE_DECIMAL_FORMATS.unitRate.scale})`;

/**
 * Devuelve el cuerpo del CREATE TABLE de una tabla de esta migración y falla si no existe.
 *
 * @param {string} sql - SQL sin comentarios.
 * @param {string} table - Tabla buscada.
 * @returns {string} Definiciones del CREATE TABLE.
 */
function tableBody(sql, table) {
  const body = createTableBody(sql, table);
  assert.ok(body, `Falta CREATE TABLE public.${table}`);
  return body;
}

test("la migración va después de Cotizaciones y schema.prisma declara las mismas columnas", async () => {
  const migrations = await listMigrations();
  assert.ok(migrations.indexOf(MIGRATION_NAME) > migrations.indexOf("20261026120000_quotes"));
  const schema = await readFile(path.join(backendDirectory, "prisma", "schema.prisma"), "utf8");
  for (const table of [...NEW_TABLES, "quote_items"]) await assertPrismaMatchesMigrations(schema, table);
});

test("tarifas por unidad con la escala del motor y NULL como tarifa pendiente de validación comercial", async () => {
  const sql = await readMigrationStatements(MIGRATION_NAME);
  for (const table of NEW_TABLES) {
    const columns = sqlColumns(tableBody(sql, table));
    // Sin NOT NULL: una unidad puede quedar pendiente sin inventar una tarifa.
    assert.equal(columns.get("reference_rate"), RATE_TYPE);
    assert.equal(columns.get("position"), "SMALLINT NOT NULL");
    assert.equal(columns.get("presentation_label"), "VARCHAR(80)");
    assert.match(sql, new RegExp(`chk_${table}_position CHECK \\(position BETWEEN 1 AND ${HISTORICAL_UNIT_OPTIONS_MAX}\\)`));
    assert.match(sql, new RegExp(`chk_${table}_reference_rate CHECK \\(reference_rate IS NULL OR reference_rate >= 0\\)`));
  }
});

test("integridad: posiciones únicas, sin unidades repetidas, denominación de su base y unidad cotizada de la misma versión", async () => {
  const sql = await readMigrationStatements(MIGRATION_NAME);
  for (const constraint of [
    "uq_service_unit_options_position UNIQUE (service_id, position)",
    "uq_service_unit_options_unit UNIQUE NULLS NOT DISTINCT (service_id, measurement_unit_id, unit_denomination_id)",
    "FOREIGN KEY (unit_denomination_id, measurement_unit_id) REFERENCES public.measurement_unit_denominations(id, measurement_unit_id)",
    "uq_service_version_unit_options_position UNIQUE (service_version_id, position)",
    "uq_service_version_unit_options_id_version UNIQUE (id, service_version_id)",
    "chk_service_version_unit_options_denomination CHECK ((unit_denomination_id IS NULL) = (unit_denomination IS NULL))",
    "FOREIGN KEY (service_version_unit_option_id, service_version_id)",
    "REFERENCES public.service_version_unit_options(id, service_version_id)",
  ]) {
    assert.ok(sql.includes(constraint), constraint);
  }
  assert.doesNotMatch(sql, /ON DELETE CASCADE/i);
  // service_unit_options (3), service_version_unit_options (3) y quote_items (1).
  assert.equal((sql.match(/ON DELETE RESTRICT/g) || []).length, 7);
});

test("historial inmutable y coherencia diferida con el servicio y la versión", async () => {
  const sql = await readMigrationStatements(MIGRATION_NAME);
  assert.match(sql, /CREATE TRIGGER service_version_unit_options_immutable\s+BEFORE UPDATE OR DELETE ON public\.service_version_unit_options/);
  for (const trigger of [
    "service_unit_options_consistent\\s+AFTER INSERT OR UPDATE OR DELETE ON public\\.service_unit_options",
    "services_unit_options_consistent\\s+AFTER INSERT OR UPDATE OF measurement_unit_id, unit_denomination_id, reference_rate ON public\\.services",
    "service_versions_unit_options_consistent\\s+AFTER INSERT ON public\\.service_versions",
    "service_version_unit_options_consistent\\s+AFTER INSERT ON public\\.service_version_unit_options",
  ]) {
    assert.match(sql, new RegExp(`CREATE CONSTRAINT TRIGGER ${trigger}\\s+DEFERRABLE INITIALLY DEFERRED`));
  }
  for (const fn of ["prevent_service_version_unit_option_mutation", "assert_service_unit_options", "assert_service_version_unit_options", "prevent_denomination_unit_change"]) {
    assert.match(sql, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\(\\) FROM PUBLIC;`));
  }
  // El cambio de base de una denominación también lo bloquean las unidades alternativas.
  assert.match(sql, /EXISTS \(SELECT 1 FROM public\.service_unit_options WHERE unit_denomination_id = OLD\.id\)/);
  assert.match(sql, /EXISTS \(SELECT 1 FROM public\.service_version_unit_options WHERE unit_denomination_id = OLD\.id\)/);
});

test("cualquier escritor mantiene la coherencia: services sincroniza la principal y cada versión copia sus unidades", async () => {
  const sql = await readMigrationStatements(MIGRATION_NAME);
  assert.match(sql, /CREATE TRIGGER services_sync_primary_unit_option\s+AFTER INSERT OR UPDATE OF measurement_unit_id, unit_denomination_id, reference_rate ON public\.services/);
  assert.match(sql, /CREATE TRIGGER service_versions_snapshot_unit_options\s+AFTER INSERT ON public\.service_versions/);
  for (const fn of ["sync_service_primary_unit_option", "snapshot_service_version_unit_options"]) {
    assert.match(sql, new RegExp(`CREATE FUNCTION public\\.${fn}\\(\\) RETURNS trigger\\s+LANGUAGE plpgsql\\s+SET search_path = ''`));
    assert.match(sql, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\(\\) FROM PUBLIC;`));
  }
  // La tarifa del servicio solo se copia a la principal cuando es su única unidad.
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM public\.service_unit_options alternative WHERE alternative\.service_id = NEW\.id AND alternative\.position > 1\)/);
  // Las ramas por tabla usan IF: un CASE de PL/pgSQL prepara todas sus ramas y fallaría.
  assert.doesNotMatch(sql, /:= CASE/);
});

test("alcance: solo añade objetos, rellena la posición 1 y restaura el trigger de conceptos en la misma transacción", async () => {
  const sql = await readMigrationStatements(MIGRATION_NAME);
  for (const table of NEW_TABLES) assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`));
  assert.match(sql, /REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public\.service_unit_options FROM anon, authenticated, service_role/);
  assert.doesNotMatch(sql, /\b(DROP\s|TRUNCATE\s+(TABLE\s+)?public|DELETE FROM)/i);
  // Las únicas escrituras de datos de la propia migración (fuera de los cuerpos de las funciones):
  // el relleno de las nuevas tablas y del concepto cotizado.
  const statements = sql.replace(/\$\$[\s\S]*?\$\$/g, "");
  assert.deepEqual([...statements.matchAll(/INSERT INTO public\.(\w+)/g)].map(([, table]) => table), NEW_TABLES);
  assert.deepEqual([...statements.matchAll(/UPDATE public\.(\w+)/g)].map(([, table]) => table), ["quote_items"]);
  const disable = sql.indexOf("ALTER TABLE public.quote_items DISABLE TRIGGER quote_items_immutable;");
  const update = sql.indexOf("UPDATE public.quote_items");
  const enable = sql.indexOf("ALTER TABLE public.quote_items ENABLE TRIGGER quote_items_immutable;");
  assert.ok(disable > 0 && disable < update && update < enable, "El trigger se desactiva solo alrededor del relleno");
  assert.ok(sql.trim().startsWith("BEGIN;") && sql.trim().endsWith("COMMIT;"), "Una sola transacción");
});

test("unidad única: la migración nueva va después y exige una unidad vigente con tarifa sin revalidar el historial", async () => {
  const migrations = await listMigrations();
  assert.ok(migrations.indexOf(SINGLE_UNIT_MIGRATION) > migrations.indexOf(MIGRATION_NAME));
  const sql = await readMigrationStatements(SINGLE_UNIT_MIGRATION);
  assert.ok(sql.trim().startsWith("BEGIN;") && sql.trim().endsWith("COMMIT;"), "Una sola transacción");
  // Aborta antes de añadir restricciones si queda algún servicio por separar.
  assert.match(sql, /IF EXISTS \(SELECT 1 FROM public\.service_unit_options WHERE position > 1 OR reference_rate IS NULL\) THEN\s+RAISE EXCEPTION/);
  assert.ok(sql.includes("chk_service_unit_options_single CHECK (position = 1),"));
  assert.ok(sql.includes("chk_service_unit_options_rate_confirmed CHECK (reference_rate IS NOT NULL);"));
  // Las copias históricas (versiones con alternativas o tarifa pendiente) no se revalidan.
  assert.ok(sql.includes("chk_service_version_unit_options_single CHECK (position = 1) NOT VALID,"));
  assert.ok(sql.includes("chk_service_version_unit_options_rate_confirmed CHECK (reference_rate IS NOT NULL) NOT VALID;"));
});

test("unidad única: solo añade restricciones; no modifica datos, triggers, secuencias ni la migración anterior", async () => {
  const sql = await readMigrationStatements(SINGLE_UNIT_MIGRATION);
  const statements = sql.replace(/\$\$[\s\S]*?\$\$/g, "");
  assert.doesNotMatch(statements, /\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|DISABLE TRIGGER|ENABLE TRIGGER|SEQUENCE|setval|RESTART)\b/i);
  assert.deepEqual([...statements.matchAll(/ALTER TABLE public\.(\w+)/g)].map(([, table]) => table), ["service_unit_options", "service_version_unit_options"]);
  const previous = await readMigrationStatements(MIGRATION_NAME);
  assert.doesNotMatch(previous, /chk_service_(version_)?unit_options_(single|rate_confirmed) CHECK/, "La migración aplicada no se edita");
});
