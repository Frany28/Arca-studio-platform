import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { backendDirectory, listMigrations, readMigrationStatements } from "./helpers/migrationSchema.js";

const SEED_PATH = path.join(backendDirectory, "prisma", "seeds", "measurement_units.sql");
const DATA_MIGRATION = "20261020130000_measurement_units_catalog_data";
const DATA_MIGRATION_PATH = path.join(backendDirectory, "prisma", "migrations", DATA_MIGRATION, "migration.sql");

// Las 11 unidades aprobadas originalmente: su código, nombre, símbolo y decimales no cambian.
const ORIGINAL_UNITS = [
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

// Bloques de sort_order: categoría → códigos esperados, en orden de presentación.
const CATALOG = {
  100: ["square_meter", "square_centimeter", "square_foot", "hectare", "square_kilometer"],
  200: ["linear_meter", "meter", "millimeter", "centimeter", "kilometer", "inch", "foot"],
  300: ["cubic_meter", "cubic_centimeter", "liter", "us_gallon"],
  400: ["kilogram", "gram", "metric_ton"],
  500: ["unit", "piece", "point", "set", "pair", "package", "box", "bag", "roll", "lot"],
  600: ["hour", "minute", "day", "week", "month", "year"],
  700: ["man_hour", "man_day"],
  800: ["project", "space", "visit", "report", "drawing", "render", "global"],
  900: ["kilowatt_hour", "kilowatt", "kilovolt_ampere", "refrigeration_ton"],
};

// Duplicados semánticos que se modelan como denominaciones de otra base, no como bases.
// Metro y pieza sí son bases, separadas de metro lineal y unidad por decisión de ARCA.
const EXCLUDED_CODES = ["outlet", "workday", "room", "inspection"];

// Unidades contables o de empaque: no admiten cantidades fraccionarias.
const WHOLE_NUMBER_CODES = ["unit", "piece", "point", "set", "pair", "package", "box", "bag", "roll", "lot",
  "minute", "project", "space", "visit", "report", "drawing", "render", "global"];

/**
 * Extrae las filas del INSERT de la carga inicial de unidades base.
 *
 * @param {string} sql - Contenido del archivo de carga.
 * @returns {Array<{code: string, name: string, symbol: string, allowsDecimals: boolean, isActive: boolean, sortOrder: number}>} Filas.
 */
function seedRows(sql) {
  return [...sql.matchAll(/\(\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*(true|false),\s*(true|false),\s*(\d+)\s*\)/g)]
    .map(([, code, name, symbol, decimals, active, order]) => ({
      allowsDecimals: decimals === "true", code, isActive: active === "true", name, sortOrder: Number(order), symbol,
    }));
}

/**
 * Reproduce en JavaScript la clave de los índices únicos: NFKC, minúsculas y sin espacios
 * exteriores (lower(normalize(x, NFKC) COLLATE pg_c_utf8) y lower(btrim(x) COLLATE pg_c_utf8)).
 *
 * @param {string} value - Símbolo o nombre.
 * @returns {string} Clave de unicidad.
 */
function uniquenessKey(value) {
  return value.normalize("NFKC").toLowerCase().trim();
}

const sql = await readFile(SEED_PATH, "utf8");
const rows = seedRows(sql);
const byCode = new Map(rows.map((row) => [row.code, row]));

/**
 * Devuelve el bloque transaccional (de BEGIN; al final) de un archivo SQL, con saltos LF.
 *
 * @param {string} text - Contenido del archivo.
 * @returns {string} Bloque BEGIN…COMMIT.
 */
function transactionBlock(text) {
  const normalized = text.replace(/\r\n/g, "\n");
  return normalized.slice(normalized.indexOf("BEGIN;"));
}

test("solo la migración de datos carga unidades y su SQL es idéntico al catálogo fuente", async () => {
  assert.ok(existsSync(SEED_PATH));
  assert.ok(existsSync(DATA_MIGRATION_PATH));
  // Ninguna otra migración (en particular las estructurales) inserta unidades.
  const loaders = [];
  for (const name of await listMigrations()) {
    if (/INSERT INTO public\.measurement_units/i.test(await readMigrationStatements(name))) loaders.push(name);
  }
  assert.deepEqual(loaders, [DATA_MIGRATION]);
  // Una sola lista: el bloque BEGIN…COMMIT de la migración coincide byte a byte con el catálogo.
  const migrationSql = await readFile(DATA_MIGRATION_PATH, "utf8");
  assert.equal(transactionBlock(migrationSql), transactionBlock(sql));
  assert.deepEqual(seedRows(migrationSql), rows);
  // Es exclusivamente de datos: sin DDL.
  assert.doesNotMatch(migrationSql.replace(/--.*$/gm, ""), /\b(CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|DELETE|UPDATE)\b/i);
  // Va después de la migración estructural que crea los índices de unicidad.
  const migrations = await listMigrations();
  assert.ok(migrations.indexOf(DATA_MIGRATION) > migrations.indexOf("20261020090000_measurement_unit_denominations"));
});

test("es idempotente y no modifica ni elimina datos existentes", () => {
  const statements = sql.replace(/--.*$/gm, "");
  assert.match(statements, /INSERT INTO public\.measurement_units \(code, name, symbol, allows_decimals, is_active, sort_order\) VALUES/);
  assert.match(statements, /ON CONFLICT \(code\) DO NOTHING;/);
  for (const forbidden of [/\bUPDATE\b/i, /\bDELETE\b/i, /\bDROP\b/i, /\bTRUNCATE\b/i, /DO UPDATE/i, /\bALTER\b/i, /measurement_unit_denominations|public\.services/i]) {
    assert.doesNotMatch(statements, forbidden);
  }
  // El número de filas reconocidas coincide con el número de tuplas del VALUES.
  assert.equal(rows.length, (statements.match(/^\s*\('/gm) || []).length);
});

test("catálogo de 48 unidades agrupado por categorías con orden estable", () => {
  assert.equal(rows.length, 48);
  for (const [block, codes] of Object.entries(CATALOG)) {
    const inBlock = rows.filter((row) => Math.floor(row.sortOrder / 100) * 100 === Number(block));
    assert.deepEqual(inBlock.map((row) => row.code), codes, `bloque ${block}`);
    assert.deepEqual(inBlock.map((row) => row.sortOrder), codes.map((_, index) => Number(block) + index + 1), `orden ${block}`);
  }
  assert.deepEqual(rows.map((row) => row.sortOrder), [...rows.map((row) => row.sortOrder)].sort((a, b) => a - b));
  assert.ok(rows.every((row) => row.isActive));
});

test("conserva las 11 unidades originales con sus códigos, nombres, símbolos y decimales", () => {
  for (const [code, name, symbol, allowsDecimals] of ORIGINAL_UNITS) {
    assert.deepEqual(
      { allowsDecimals: byCode.get(code)?.allowsDecimals, name: byCode.get(code)?.name, symbol: byCode.get(code)?.symbol },
      { allowsDecimals, name, symbol },
      code,
    );
  }
});

test("códigos, nombres y símbolos únicos con la misma equivalencia que PostgreSQL", () => {
  for (const field of ["code", "name", "symbol"]) {
    const keys = rows.map((row) => (field === "code" ? row.code : uniquenessKey(row[field])));
    const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
    assert.deepEqual(duplicates, [], field);
  }
  for (const row of rows) {
    assert.match(row.code, /^[a-z0-9]+(_[a-z0-9]+)*$/, row.code);
    assert.ok(row.code.length <= 30, row.code);
    assert.ok(row.symbol === row.symbol.trim() && row.symbol.length >= 1 && row.symbol.length <= 10, row.symbol);
    assert.ok(row.name === row.name.trim() && row.name.length >= 1 && row.name.length <= 80, row.name);
    // NFC: el texto guardado no cambia al normalizarse.
    assert.equal(row.name, row.name.normalize("NFC"), row.code);
    assert.equal(row.symbol, row.symbol.normalize("NFC"), row.code);
  }
  // Superíndices Unicode correctos (no "m2" ni "m3").
  assert.equal(byCode.get("square_meter").symbol, "m²");
  assert.equal(byCode.get("cubic_meter").symbol, "m³");
});

test("las duplicidades semánticas quedan fuera del catálogo base", () => {
  for (const code of EXCLUDED_CODES) assert.ok(!byCode.has(code), code);
  for (const name of ["Salida", "Jornada", "Ambiente", "Inspección"]) {
    assert.ok(!rows.some((row) => uniquenessKey(row.name) === uniquenessKey(name)), name);
  }
});

test("metro y metro lineal, y pieza y unidad, son unidades base distintas", () => {
  assert.deepEqual(
    [byCode.get("meter"), byCode.get("linear_meter")].map(({ name, symbol, allowsDecimals }) => [name, symbol, allowsDecimals]),
    [["Metro", "m", true], ["Metro lineal", "m.l.", true]],
  );
  assert.deepEqual(
    [byCode.get("piece"), byCode.get("unit")].map(({ name, symbol, allowsDecimals }) => [name, symbol, allowsDecimals]),
    [["Pieza", "pza.", false], ["Unidad", "und.", false]],
  );
  // Cada pareja tiene claves de unicidad distintas y la nueva va justo después de la original.
  assert.notEqual(uniquenessKey("m"), uniquenessKey("m.l."));
  assert.notEqual(uniquenessKey("pza."), uniquenessKey("und."));
  assert.equal(byCode.get("meter").sortOrder, byCode.get("linear_meter").sortOrder + 1);
  assert.equal(byCode.get("piece").sortOrder, byCode.get("unit").sortOrder + 1);
});

test("decimales: magnitudes, tiempo, mano de obra y energía sí; contables y empaques no", () => {
  for (const code of WHOLE_NUMBER_CODES) assert.equal(byCode.get(code)?.allowsDecimals, false, code);
  for (const row of rows.filter((item) => !WHOLE_NUMBER_CODES.includes(item.code))) {
    assert.equal(row.allowsDecimals, true, row.code);
  }
});
