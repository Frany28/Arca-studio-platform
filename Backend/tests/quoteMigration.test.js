import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { QUOTE_DECIMAL_FORMATS } from "../src/domain/quoteTotals.js";
import {
  assertPrismaMatchesMigrations,
  backendDirectory,
  createTableBody,
  readMigrationStatements,
  sqlColumns,
} from "./helpers/migrationSchema.js";

const MIGRATION_NAME = "20261026120000_quotes";
const QUOTE_TABLES = ["quotes", "quote_versions", "quote_items"];

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

/**
 * Escribe el tipo NUMERIC equivalente a un formato del motor de cálculo.
 *
 * @param {{ maxIntegerDigits: number, scale: number }} format - Precisión.
 * @returns {string} Tipo SQL.
 */
function numericOf({ maxIntegerDigits, scale }) {
  return `NUMERIC(${maxIntegerDigits + scale},${scale})`;
}

test("schema.prisma y el historial de migraciones declaran las mismas columnas y nulabilidad", async () => {
  const schema = await readFile(path.join(backendDirectory, "prisma", "schema.prisma"), "utf8");
  for (const table of QUOTE_TABLES) await assertPrismaMatchesMigrations(schema, table);
});

test("cantidades, tarifas e importes usan las escalas del motor de cálculo", async () => {
  const sql = await readMigrationStatements(MIGRATION_NAME);
  const items = sqlColumns(tableBody(sql, "quote_items"));
  assert.equal(items.get("quantity"), `${numericOf(QUOTE_DECIMAL_FORMATS.quantity)} NOT NULL`);
  for (const column of ["unit_rate", "reference_rate"]) assert.equal(items.get(column), `${numericOf(QUOTE_DECIMAL_FORMATS.unitRate)} NOT NULL`);
  assert.equal(items.get("subtotal"), `${numericOf(QUOTE_DECIMAL_FORMATS.amount)} NOT NULL`);
  assert.equal(sqlColumns(tableBody(sql, "quote_versions")).get("services_total"), `${numericOf(QUOTE_DECIMAL_FORMATS.amount)} NOT NULL`);
  // El subtotal se comprueba con el mismo redondeo que el motor (mitad hacia arriba).
  assert.match(sql, /chk_quote_items_subtotal CHECK \(subtotal = round\(quantity \* unit_rate, 2\)\)/);
});

test("integridad: código único, una versión vigente, un servicio por versión y versión del mismo servicio", async () => {
  const sql = await readMigrationStatements(MIGRATION_NAME);
  for (const constraint of [
    "uq_quotes_code UNIQUE (code)",
    "chk_quotes_code CHECK (code ~ '^COT-[0-9]{3,}$')",
    "uq_quote_versions_quote_version UNIQUE (quote_id, version_number)",
    "uq_quote_items_version_line UNIQUE (quote_version_id, line_number)",
    "uq_quote_items_version_service UNIQUE (quote_version_id, service_id)",
    "FOREIGN KEY (service_version_id, service_id) REFERENCES public.service_versions(id, service_id)",
    "chk_quote_items_quantity CHECK (quantity > 0)",
    "chk_quote_versions_currency_code CHECK (currency_code = 'USD')",
  ]) {
    assert.ok(sql.includes(constraint), constraint);
  }
  assert.match(sql, /CREATE UNIQUE INDEX uq_quote_versions_current ON public\.quote_versions \(quote_id\) WHERE is_current;/);
  // Ninguna clave foránea borra en cascada: el historial no puede desaparecer con sus referencias.
  assert.doesNotMatch(sql, /ON DELETE CASCADE/i);
  // quotes (2), quote_versions (4) y quote_items (3).
  assert.equal((sql.match(/ON DELETE RESTRICT/g) || []).length, 9);
});

test("historial inmutable: versiones solo retiran su vigencia y los conceptos no cambian", async () => {
  const sql = await readMigrationStatements(MIGRATION_NAME);
  assert.match(sql, /CREATE TRIGGER quote_versions_immutable\s+BEFORE UPDATE OR DELETE ON public\.quote_versions/);
  assert.match(sql, /CREATE TRIGGER quote_items_immutable\s+BEFORE UPDATE OR DELETE ON public\.quote_items/);
  assert.match(sql, /\(to_jsonb\(NEW\) - 'is_current'\) IS DISTINCT FROM \(to_jsonb\(OLD\) - 'is_current'\)/);
  for (const fn of ["prevent_quote_version_mutation", "prevent_quote_item_mutation"]) {
    assert.match(sql, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\(\\) FROM PUBLIC;`));
    assert.match(sql, new RegExp(`CREATE FUNCTION public\\.${fn}\\(\\) RETURNS trigger\\s+LANGUAGE plpgsql\\s+SET search_path = ''`));
  }
});

test("seguridad y alcance: RLS en las tablas nuevas y ningún cambio destructivo sobre las existentes", async () => {
  const sql = await readMigrationStatements(MIGRATION_NAME);
  for (const table of QUOTE_TABLES) assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`));
  // `REVOKE TRUNCATE, ...` retira un privilegio; lo prohibido es vaciar o borrar objetos y datos.
  assert.doesNotMatch(sql, /\b(DROP\s|TRUNCATE\s+(TABLE\s+)?public|DELETE FROM|UPDATE public\.|INSERT INTO)/i);
  const alters = [...sql.matchAll(/ALTER TABLE public\.(\w+)\s+(?!ENABLE ROW LEVEL SECURITY)([^;]+);/g)].map(([, table, change]) => `${table}: ${change.trim()}`);
  assert.deepEqual(alters, ["service_versions: ADD CONSTRAINT uq_service_versions_id_service UNIQUE (id, service_id)"]);
});
