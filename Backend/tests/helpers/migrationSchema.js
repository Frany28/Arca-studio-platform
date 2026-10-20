import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Análisis estático compartido de prisma/migrations y schema.prisma para las pruebas de
// migraciones. Las columnas de una tabla se acumulan a lo largo del historial (CREATE TABLE
// más ALTER TABLE ... ADD COLUMN posteriores), igual que las aplica `prisma migrate deploy`.

export const backendDirectory = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const migrationsDirectory = path.join(backendDirectory, "prisma", "migrations");
const PRISMA_SCALARS = new Set(["BigInt", "Boolean", "DateTime", "Decimal", "Int", "String", "service_kind"]);

/**
 * Lista las migraciones versionadas en orden de aplicación.
 *
 * @returns {Promise<Array<string>>} Nombres de carpeta ordenados.
 */
export async function listMigrations() {
  return (await readdir(migrationsDirectory)).filter((name) => /^\d{14}_/.test(name)).sort();
}

/**
 * Lee el SQL de una migración sin comentarios de línea, para analizar solo sentencias.
 *
 * @param {string} name - Carpeta de la migración.
 * @returns {Promise<string>} SQL sin comentarios.
 */
export async function readMigrationStatements(name) {
  return (await readFile(path.join(migrationsDirectory, name, "migration.sql"), "utf8")).replace(/--.*$/gm, "");
}

/**
 * Obtiene el cuerpo del CREATE TABLE de una tabla, o null si la migración no la crea.
 *
 * @param {string} sql - SQL sin comentarios.
 * @param {string} table - Tabla buscada.
 * @returns {string|null} Definiciones entre los paréntesis del CREATE TABLE.
 */
export function createTableBody(sql, table) {
  return sql.match(new RegExp(`CREATE TABLE public\\.${table} \\(([\\s\\S]*?)\\n\\);`))?.[1] ?? null;
}

/**
 * Lista las columnas declaradas en el cuerpo de un CREATE TABLE (excluye restricciones).
 *
 * @param {string} body - Cuerpo del CREATE TABLE.
 * @returns {Map<string, string>} Columna → definición SQL.
 */
export function sqlColumns(body) {
  const columns = new Map();
  for (const line of body.split("\n").map((value) => value.trim()).filter(Boolean)) {
    // Restricciones, incluidas las que continúan en líneas propias (FOREIGN KEY, CHECK...).
    if (/^(CONSTRAINT|FOREIGN|ON |REFERENCES|CHECK)/.test(line)) continue;
    const [name, ...definition] = line.replace(/,$/, "").split(/\s+/);
    columns.set(name, definition.join(" "));
  }
  return columns;
}

/**
 * Lista las columnas que una migración añade a una tabla con ALTER TABLE ... ADD COLUMN.
 *
 * @param {string} sql - SQL sin comentarios.
 * @param {string} table - Tabla buscada.
 * @returns {Map<string, string>} Columna → definición SQL.
 */
export function addedColumns(sql, table) {
  const columns = new Map();
  for (const [, name, definition] of sql.matchAll(new RegExp(`ALTER TABLE public\\.${table} ADD COLUMN ([a-z_]+) ([^;]+);`, "g"))) {
    columns.set(name, definition.trim());
  }
  return columns;
}

/**
 * Reúne las columnas de una tabla a lo largo de todo el historial de migraciones.
 *
 * @param {string} table - Tabla buscada.
 * @returns {Promise<Map<string, string>>} Columna → definición SQL.
 */
export async function accumulatedColumns(table) {
  const columns = new Map();
  for (const name of await listMigrations()) {
    const sql = await readMigrationStatements(name);
    const body = createTableBody(sql, table);
    if (body) for (const [column, definition] of sqlColumns(body)) columns.set(column, definition);
    for (const [column, definition] of addedColumns(sql, table)) columns.set(column, definition);
  }
  return columns;
}

/**
 * Lista los campos escalares (columnas) de un modelo de schema.prisma.
 *
 * @param {string} schema - Contenido de schema.prisma.
 * @param {string} model - Modelo buscado.
 * @returns {Map<string, string>} Campo → definición Prisma.
 */
export function prismaColumns(schema, model) {
  const match = schema.match(new RegExp(`^model ${model} \\{([\\s\\S]*?)^\\}`, "m"));
  assert.ok(match, `Falta el modelo ${model}`);
  const columns = new Map();
  for (const line of match[1].split("\n").map((value) => value.trim())) {
    const [name, type, ...rest] = line.split(/\s+/);
    if (!name || name.startsWith("@@") || name.startsWith("//")) continue;
    if (PRISMA_SCALARS.has(type?.replace(/\?$/, ""))) columns.set(name, `${type} ${rest.join(" ")}`);
  }
  return columns;
}

/**
 * Comprueba que un modelo de Prisma y el historial de migraciones declaran las mismas
 * columnas con la misma nulabilidad.
 *
 * @param {string} schema - Contenido de schema.prisma.
 * @param {string} table - Tabla y modelo comparados.
 * @returns {Promise<void>}
 */
export async function assertPrismaMatchesMigrations(schema, table) {
  const fromSql = await accumulatedColumns(table);
  const fromPrisma = prismaColumns(schema, table);
  assert.deepEqual([...fromPrisma.keys()].sort(), [...fromSql.keys()].sort(), table);
  for (const [column, prismaDefinition] of fromPrisma) {
    const isOptional = /^\S+\?/.test(prismaDefinition);
    const sqlNotNull = /NOT NULL/.test(fromSql.get(column));
    assert.equal(sqlNotNull, !isOptional, `${table}.${column}: nulabilidad distinta`);
  }
}
