import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  assertPrismaMatchesMigrations,
  backendDirectory,
  listMigrations,
  readMigrationStatements,
} from "./helpers/migrationSchema.js";

const MIGRATION_NAME = "20261020090000_measurement_unit_denominations";
const SEED_PATH = path.join(backendDirectory, "prisma", "seeds", "measurement_units.sql");
const EXPECTED_UNITS = [
  ["square_meter", "Metro cuadrado", "m²", true],
  ["linear_meter", "Metro lineal", "m.l.", true],
  ["point", "Punto", "pt.", false],
  ["unit", "Unidad", "und.", false],
  ["project", "Proyecto", "proy.", false],
  ["space", "Espacio", "esp.", false],
  ["hour", "Hora", "hrs", true],
  ["minute", "Minuto", "min", false],
  ["week", "Semana", "sem.", true],
  ["month", "Mes", "mes", true],
  ["global", "Global", "glb.", false],
];

/**
 * Extrae las filas del INSERT de la carga inicial de unidades base.
 *
 * @param {string} sql - Contenido del archivo de carga.
 * @returns {Array<[string, string, string, boolean, boolean, number]>} Filas (código, nombre, símbolo, decimales, activa, orden).
 */
function seedRows(sql) {
  return [...sql.matchAll(/\(\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*(true|false),\s*(true|false),\s*(\d+)\s*\)/g)]
    .map(([, code, name, symbol, decimals, active, order]) => [code, name, symbol, decimals === "true", active === "true", Number(order)]);
}

test("schema.prisma coincide con el historial acumulado para unidades, denominaciones, servicios y versiones", async () => {
  const schema = await readFile(path.join(backendDirectory, "prisma", "schema.prisma"), "utf8");
  for (const table of ["measurement_units", "measurement_unit_denominations", "services", "service_versions"]) {
    await assertPrismaMatchesMigrations(schema, table);
  }
});

test("la migración es aditiva: no elimina, renombra ni altera columnas o datos existentes", async () => {
  const sql = await readMigrationStatements(MIGRATION_NAME);
  for (const forbidden of [
    /\bDROP\b/i, /\bTRUNCATE\s+(?:TABLE\s+)?public\./i, /\bINSERT\s+INTO\b/i, /\bUPDATE\s+public\./i,
    /\bDELETE\s+FROM\b/i, /\bRENAME\b/i, /\bALTER\s+COLUMN\b/i, /\bALTER\s+TYPE\b/i, /\bGRANT\b/i,
  ]) {
    assert.doesNotMatch(sql, forbidden);
  }
  const allowed = {
    measurement_unit_denominations: /^ENABLE ROW LEVEL SECURITY$/,
    measurement_units: /^ADD CONSTRAINT chk_measurement_units_symbol_format /,
    service_versions: /^(ADD COLUMN unit_denomination(_id)? |ADD CONSTRAINT (fk|chk)_service_versions_unit_denomination)/,
    services: /^(ADD COLUMN unit_denomination_id |ADD CONSTRAINT fk_services_unit_denomination)/,
  };
  for (const [, table, action] of sql.matchAll(/ALTER TABLE public\.([a-z_]+)\s+([\s\S]*?);/g)) {
    assert.ok(allowed[table], `ALTER TABLE no previsto sobre ${table}`);
    assert.match(action.replace(/\s+/g, " ").trim(), allowed[table], `${table}: ${action}`);
  }
  // Las columnas nuevas de tablas existentes son opcionales (sin NOT NULL ni DEFAULT).
  for (const [, , definition] of sql.matchAll(/ADD COLUMN ([a-z_]+) ([^;]+);/g)) {
    assert.doesNotMatch(definition, /NOT NULL|DEFAULT/i);
  }
});

test("restricciones: unicidad equivalente, FK compuesta, base inmutable, RLS y privilegios", async () => {
  const sql = await readMigrationStatements(MIGRATION_NAME);
  const compact = sql.replace(/\s+/g, " ");
  for (const fragment of [
    // La intercalación pg_c_utf8 hace que lower() aplique Unicode con independencia del locale de la base.
    "CREATE UNIQUE INDEX uq_measurement_units_symbol_key ON public.measurement_units (lower(normalize(symbol, NFKC) COLLATE pg_c_utf8))",
    "CREATE UNIQUE INDEX uq_measurement_units_name_key ON public.measurement_units (lower(btrim(name) COLLATE pg_c_utf8))",
    "CREATE UNIQUE INDEX uq_measurement_unit_denominations_key ON public.measurement_unit_denominations (measurement_unit_id, lower(normalize(denomination, NFKC) COLLATE pg_c_utf8))",
    "CONSTRAINT uq_measurement_unit_denominations_id_unit UNIQUE (id, measurement_unit_id)",
    "FOREIGN KEY (unit_denomination_id, measurement_unit_id) REFERENCES public.measurement_unit_denominations (id, measurement_unit_id) ON DELETE RESTRICT",
    "CHECK ((unit_denomination_id IS NULL) = (unit_denomination IS NULL))",
    "BEFORE UPDATE OF measurement_unit_id ON public.measurement_unit_denominations",
    "REVOKE EXECUTE ON FUNCTION public.prevent_denomination_unit_change() FROM PUBLIC",
    "ALTER TABLE public.measurement_unit_denominations ENABLE ROW LEVEL SECURITY",
    "REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLE public.measurement_unit_denominations FROM anon, authenticated, service_role",
  ]) {
    assert.ok(compact.includes(fragment), fragment);
  }
  // Ninguna FK nueva borra en cascada.
  assert.deepEqual([...new Set([...sql.matchAll(/ON DELETE (\w+)/g)].map(([, action]) => action))], ["RESTRICT"]);
});

test("la migración se aplica después del catálogo de servicios", async () => {
  const migrations = await listMigrations();
  assert.ok(migrations.indexOf(MIGRATION_NAME) > migrations.indexOf("20261019120000_service_catalog"));
});

test("carga inicial: fuera de las migraciones, idempotente y con el catálogo aprobado", async () => {
  assert.ok(existsSync(SEED_PATH));
  // Prisma no debe ejecutarla junto con la migración estructural.
  for (const name of await listMigrations()) {
    assert.doesNotMatch(await readMigrationStatements(name), /INSERT INTO public\.measurement_units/i, name);
  }
  const sql = await readFile(SEED_PATH, "utf8");
  assert.match(sql, /ON CONFLICT \(code\) DO NOTHING/);
  const rows = seedRows(sql);
  assert.deepEqual(rows.map(([code, name, symbol, decimals]) => [code, name, symbol, decimals]), EXPECTED_UNITS);
  assert.deepEqual(rows.map((row) => row[5]), EXPECTED_UNITS.map((_, index) => index + 1));
  assert.ok(rows.every((row) => row[4] === true));
  // m² usa el superíndice U+00B2.
  assert.equal(rows[0][2].codePointAt(1), 0x00b2);
  // Abreviaturas y nombres únicos con la misma equivalencia que los índices (NFKC, minúsculas).
  const keys = (values) => new Set(values.map((value) => value.normalize("NFKC").toLowerCase().trim()));
  assert.equal(keys(rows.map((row) => row[2])).size, rows.length);
  assert.equal(keys(rows.map((row) => row[1])).size, rows.length);
  assert.ok(rows.every(([code, , symbol]) => /^[a-z0-9]+(_[a-z0-9]+)*$/.test(code) && symbol.length <= 10 && symbol === symbol.trim()));
});
