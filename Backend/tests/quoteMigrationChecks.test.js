import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { backendDirectory } from "./helpers/migrationSchema.js";

// Comprobaciones previas y posteriores de 20261026120000_quotes (prisma/checks). Se ejecutan a
// mano contra la base que se migra, así que deben ser inocuas y estar al día con migration.sql.
const MIGRATION_DIRECTORY = path.join(backendDirectory, "prisma", "migrations", "20261026120000_quotes");
const CHECKS_DIRECTORY = path.join(backendDirectory, "prisma", "checks", "20261026120000_quotes");
const WRITE_STATEMENT = /^\s*(insert|update|delete|merge|alter|create|drop|truncate|grant|revoke|comment|vacuum|reindex|cluster|copy|lock|call|do|set\s+(?!local\s)|commit)\b/im;

/**
 * Lee un archivo de comprobación como texto.
 *
 * @param {string} name - preflight.sql o postcheck.sql.
 * @returns {Promise<string>} Contenido del archivo.
 */
function readCheck(name) {
  return readFile(path.join(CHECKS_DIRECTORY, name), "utf8");
}

/**
 * Quita los comentarios SQL de línea para analizar solo las sentencias.
 *
 * @param {string} sql - Texto SQL.
 * @returns {string} Texto sin comentarios.
 */
function withoutComments(sql) {
  return sql.replace(/--.*$/gm, "");
}

for (const name of ["preflight.sql", "postcheck.sql"]) {
  test(`${name}: transacción de solo lectura que termina en ROLLBACK y sin sentencias de escritura`, async () => {
    const sql = withoutComments(await readCheck(name));
    assert.match(sql, /\\set ON_ERROR_STOP on/, "psql se detiene ante el primer error");
    assert.match(sql, /^BEGIN TRANSACTION READ ONLY;/m);
    assert.match(sql.trimEnd(), /ROLLBACK;$/, "Termina deshaciendo la transacción");
    assert.doesNotMatch(sql, WRITE_STATEMENT, "Solo SELECT dentro de la transacción");
    // query_to_xml ejecuta SQL dinámico: solo se usa con SELECT de lectura.
    for (const [, dynamic] of sql.matchAll(/format\('([^']*)'/g)) assert.match(dynamic, /^SELECT /, dynamic);
  });
}

test("postcheck.sql enumera exactamente las restricciones, índices y triggers que crea la migración", async () => {
  const migration = withoutComments(await readFile(path.join(MIGRATION_DIRECTORY, "migration.sql"), "utf8"));
  const postcheck = await readCheck("postcheck.sql");
  const created = {
    constraints: [...migration.matchAll(/CONSTRAINT (\w+)/g)].map((match) => match[1]),
    indexes: [...migration.matchAll(/CREATE (?:UNIQUE )?INDEX (\w+)/g)].map((match) => match[1]),
    triggers: [...migration.matchAll(/CREATE TRIGGER (\w+)/g)].map((match) => match[1]),
  };
  const expectedBlock = (heading) => {
    const start = postcheck.indexOf(heading);
    const values = postcheck.slice(start, postcheck.indexOf(")\nSELECT", start));
    return [...values.matchAll(/\('(\w+)'\)/g)].map((match) => match[1]);
  };
  assert.ok(created.constraints.length > 20 && created.indexes.length > 5, "La migración se analizó");
  assert.deepEqual(expectedBlock("-- 3. Restricciones esperadas").sort(), [...created.constraints].sort());
  assert.deepEqual(expectedBlock("-- 4. Índices esperados").sort(), [...created.indexes].sort());
  for (const trigger of created.triggers) assert.match(postcheck, new RegExp(`'${trigger}'`), trigger);
});
