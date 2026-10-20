import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { QUOTE_DECIMAL_FORMATS } from "../src/domain/quoteTotals.js";
import {
  assertPrismaMatchesMigrations,
  backendDirectory,
  createTableBody as findCreateTableBody,
  listMigrations,
  readMigrationStatements as readNamedMigration,
  sqlColumns,
} from "./helpers/migrationSchema.js";

const MIGRATION_NAME = "20261019120000_service_catalog";
const CATALOG_TABLES = ["measurement_units", "services", "service_versions"];

/**
 * Lee el SQL de la migración del catálogo sin comentarios para analizar solo sentencias.
 *
 * @returns {Promise<string>} SQL sin comentarios de línea.
 */
function readMigrationStatements() {
  return readNamedMigration(MIGRATION_NAME);
}

/**
 * Obtiene el cuerpo del CREATE TABLE de una tabla creada por esta migración.
 *
 * @param {string} sql - SQL sin comentarios.
 * @param {string} table - Tabla buscada.
 * @returns {string} Definiciones entre los paréntesis del CREATE TABLE.
 */
function createTableBody(sql, table) {
  const body = findCreateTableBody(sql, table);
  assert.ok(body, `Falta CREATE TABLE public.${table}`);
  return body;
}

test("schema.prisma y el historial de migraciones declaran las mismas columnas y nulabilidad", async () => {
  // Las columnas se acumulan a lo largo del historial: las añadidas por migraciones
  // posteriores (por ejemplo, unit_denomination_id) no pertenecen a esta migración.
  const schema = await readFile(path.join(backendDirectory, "prisma", "schema.prisma"), "utf8");
  for (const table of CATALOG_TABLES) await assertPrismaMatchesMigrations(schema, table);
});

test("la tarifa usa la escala monetaria del motor de cálculos", async () => {
  const sql = await readMigrationStatements();
  const { maxIntegerDigits, scale } = QUOTE_DECIMAL_FORMATS.unitRate;
  for (const table of ["services", "service_versions"]) {
    assert.equal(sqlColumns(createTableBody(sql, table)).get("reference_rate"), `NUMERIC(${maxIntegerDigits + scale},${scale}) NOT NULL`);
  }
});

test("restricciones de integridad, vigencia única e inmutabilidad del historial", async () => {
  const sql = await readMigrationStatements();
  for (const constraint of [
    "uq_measurement_units_code UNIQUE (code)",
    "uq_services_code UNIQUE (code)",
    "uq_service_versions_service_version UNIQUE (service_id, version_number)",
    "chk_services_reference_rate CHECK (reference_rate >= 0)",
    "chk_service_versions_reference_rate CHECK (reference_rate >= 0)",
    "chk_services_currency_code CHECK (currency_code = 'USD')",
    "chk_service_versions_version_number CHECK (version_number >= 1)",
  ]) {
    assert.ok(sql.includes(constraint), constraint);
  }
  assert.match(sql, /CREATE UNIQUE INDEX uq_service_versions_current ON public\.service_versions \(service_id\) WHERE is_current;/);
  assert.match(sql, /CREATE TRIGGER service_versions_immutable\s+BEFORE UPDATE OR DELETE ON public\.service_versions/);
  assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.prevent_service_version_mutation\(\) FROM PUBLIC;/);
  // Ninguna FK del catálogo borra en cascada: el historial y las unidades se conservan.
  const foreignKeys = [...sql.matchAll(/FOREIGN KEY[\s\S]*?ON DELETE (\w+)/g)].map(([, action]) => action);
  assert.equal(foreignKeys.length, 6);
  assert.deepEqual([...new Set(foreignKeys)], ["RESTRICT"]);
});

test("activa RLS en las tablas nuevas", async () => {
  const sql = await readMigrationStatements();
  for (const table of CATALOG_TABLES) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`));
  }
});

test("la migración no es destructiva: solo crea objetos nuevos y no toca datos", async () => {
  const sql = await readMigrationStatements();
  for (const forbidden of [
    /\bDROP\b/i,
    /\bTRUNCATE\s+(?:TABLE\s+)?public\./i,
    /\bINSERT\s+INTO\b/i,
    /\bUPDATE\s+public\./i,
    /\bDELETE\s+FROM\b/i,
    /\bALTER\s+TYPE\b/i,
    /\bRENAME\b/i,
    /\bGRANT\b/i,
  ]) {
    assert.doesNotMatch(sql, forbidden);
  }
  const alteredTables = [...sql.matchAll(/ALTER TABLE public\.([a-z_]+) (.*);/g)];
  for (const [, table, action] of alteredTables) {
    assert.ok(CATALOG_TABLES.includes(table), `ALTER TABLE sobre una tabla existente: ${table}`);
    assert.equal(action, "ENABLE ROW LEVEL SECURITY");
  }
  // Las tablas existentes solo se referencian como destino de claves foráneas.
  const referencedTables = new Set([...sql.matchAll(/REFERENCES public\.([a-z_]+)/g)].map(([, table]) => table));
  assert.deepEqual([...referencedTables].sort(), ["measurement_units", "services", "users"]);
});

test("la migración del catálogo se aplica después de las sesiones revocables", async () => {
  const migrations = await listMigrations();
  assert.ok(migrations.indexOf(MIGRATION_NAME) > migrations.indexOf("20261015090000_user_sessions"));
});
