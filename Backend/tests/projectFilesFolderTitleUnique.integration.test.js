import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

import { applyMigration, createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

/*
 * Migración 20261126120000_project_files_folder_title_unique sobre PostgreSQL real. Opcional y local:
 *   ARCA_FILE_MANAGER_DB_TESTS=1
 *   ARCA_FILE_MANAGER_TEST_DATABASE_URL=postgres://postgres@localhost:54329/postgres
 * Base propia con el historial anterior a la migración, eliminada al terminar; nunca lee .env.
 * Cubre: aborto sin cambios ante homónimos existentes, preflight y postcheck, huella de files, el
 * comportamiento del índice (carpetas, raíz, mayúsculas, borrados lógicos, adjuntos de solicitudes),
 * dos inserciones simultáneas y la traducción de la violación a 409.
 */

const MIGRATION = "20261126120000_project_files_folder_title_unique";
const enabled = process.env.ARCA_FILE_MANAGER_DB_TESTS === "1" && process.env.ARCA_FILE_MANAGER_TEST_DATABASE_URL;
const skip = !enabled && "Requiere PostgreSQL local, ARCA_FILE_MANAGER_DB_TESTS=1 y ARCA_FILE_MANAGER_TEST_DATABASE_URL.";

let database;
let pg;
const seed = {};

/**
 * Ejecuta una consulta en la base desechable.
 *
 * @param {string} sql - Sentencia.
 * @param {unknown[]} [values] - Parámetros.
 * @returns {Promise<Array<object>>} Filas.
 */
async function rows(sql, values = []) {
  return (await database.client.query(sql, values)).rows;
}

/**
 * Inserta un archivo de proyecto mínimo (sin versiones: el índice solo mira `files`).
 *
 * @param {{ title: string, folderId?: number|null, projectId?: number, status?: string, deleted?: boolean }} file - Datos.
 * @param {{ query: Function }} [executor] - Cliente.
 * @returns {Promise<number>} Id.
 */
async function insertFile({ deleted = false, folderId = null, projectId = seed.project, status = "active", title }, executor = database.client) {
  const result = await executor.query(
    `insert into public.files (project_id, uploaded_by, title, file_type, file_category, current_version, status, folder_id, deleted_at)
     values ($1, $2, $3, 'application/pdf', 'document', 1, $4::file_status, $5, $6) returning id::int`,
    [projectId, seed.user, title, status, folderId, deleted ? new Date() : null],
  );
  return result.rows[0].id;
}

/**
 * Ejecuta un archivo de comprobación (preflight o postcheck) sin las metaórdenes de psql y devuelve
 * la unión de sus columnas `ok_*` y de los valores que se comparan.
 *
 * @param {"preflight"|"postcheck"} name - Archivo.
 * @returns {Promise<{ ok: Record<string, boolean>, values: Record<string, unknown>, results: Array<object> }>} Resultado.
 */
async function runCheck(name) {
  const sql = (await readFile(new URL(`../prisma/checks/${MIGRATION}/${name}.sql`, import.meta.url), "utf8"))
    .split("\n").filter((line) => !line.startsWith("\\")).join("\n");
  const results = [].concat(await database.client.query(sql));
  const ok = {};
  const values = {};
  for (const result of results) {
    for (const row of result.rows || []) {
      for (const [key, value] of Object.entries(row)) (key.startsWith("ok_") ? ok : values)[key] = value;
    }
  }
  return { ok, results, values };
}

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({ baseUrl: process.env.ARCA_FILE_MANAGER_TEST_DATABASE_URL, prefix: "arca_title_unique", recordMigrations: true, stopBefore: MIGRATION });
  ({ default: pg } = await import("pg"));
  const role = (await rows("insert into public.roles (code, name) values ('admin', 'admin') returning id::int"))[0].id;
  seed.user = (await rows("insert into public.users (role_id, email, first_name, last_name, password_hash) values ($1, 'admin@titulos.test', 'Ana', 'Admin', '!disabled!') returning id::int", [role]))[0].id;
  seed.client = (await rows("insert into public.clients (name, email) values ('Cliente', 'cliente@titulos.test') returning id::int"))[0].id;
  const project = async (name) => (await rows(`insert into public.projects (client_id, created_by, name, status, public_slug, start_date, project_type, location, has_plans)
    values ($1, $2, $3, 'in_process', $4, '2026-11-01', 'residential', 'Caracas', false) returning id::int`, [seed.client, seed.user, name, `tu-${randomUUID()}`]))[0].id;
  seed.project = await project("Títulos");
  seed.other = await project("Otro");
  const folder = async (projectId, name) => (await rows("insert into public.project_folders (project_id, parent_id, name, created_by) values ($1, null, $2, $3) returning id::int", [projectId, name, seed.user]))[0].id;
  seed.plans = await folder(seed.project, "Planos");
  seed.additional = await folder(seed.project, "Adicionales");
});

after(async () => {
  await database?.drop();
});

test("con homónimos en una misma ubicación la migración aborta sin cambios y el preflight los enumera sin nombres", { skip }, async () => {
  const first = await insertFile({ title: "Plano.pdf" });
  const second = await insertFile({ title: "plano.PDF" });
  const before = await runCheck("preflight");
  assert.equal(before.ok.ok_no_conflicts, false);
  const detail = before.results.flatMap((result) => result.rows || []).find((row) => Array.isArray(row.file_ids));
  assert.deepEqual([detail.location, detail.file_ids.map(Number)], ["raíz", [first, second]]);
  assert.equal(JSON.stringify(before.results.flatMap((result) => result.rows || [])).includes("lano"), false, "el informe no contiene nombres de archivo");

  await assert.rejects(applyMigration(database.client, MIGRATION), (error) => error.code === "23505" && /1 grupos de archivos/.test(error.message) && !/lano/.test(error.message));
  await database.client.query("rollback");
  assert.equal((await rows("select to_regclass('public.uq_files_project_folder_title') as index"))[0].index, null, "sin índice a medias");

  // Resolución humana: se renombra el segundo; después el preflight queda limpio.
  await rows("update public.files set title = 'plano (2).PDF' where id = $1", [second]);
});

test("preflight limpio, migración, postcheck con la definición exacta y huella de files intacta", { skip }, async () => {
  await insertFile({ folderId: seed.plans, title: "plano.pdf" });
  await insertFile({ folderId: seed.additional, title: "plano.pdf" });
  await insertFile({ deleted: true, title: "plano.pdf" });
  const before = await runCheck("preflight");
  assert.ok(Object.values(before.ok).every(Boolean), JSON.stringify(before.ok));
  assert.equal(Number(before.values.other_open_transactions), 0);

  await applyMigration(database.client, MIGRATION);
  const bytes = await readFile(new URL(`../prisma/migrations/${MIGRATION}/migration.sql`, import.meta.url));
  assert.equal(bytes.includes(Buffer.from("\r\n")), false, "LF: checksum reproducible");
  await rows("insert into public._prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count) values ($1, $2, $3, now(), 1)",
    [randomUUID(), createHash("sha256").update(bytes).digest("hex"), MIGRATION]);

  const afterCheck = await runCheck("postcheck");
  assert.ok(Object.values(afterCheck.ok).every(Boolean), JSON.stringify(afterCheck.ok));
  assert.equal(afterCheck.values.recorded_checksum, createHash("sha256").update(bytes).digest("hex"));
  assert.deepEqual([afterCheck.values.files_total, afterCheck.values.files_fingerprint], [before.values.files_total, before.values.files_fingerprint], "no cambia filas");
});

test("índice: mismo nombre en carpetas distintas y otro proyecto; repetido en carpeta o raíz (sin distinguir mayúsculas), 23505", { skip }, async () => {
  const violation = async (file) => {
    const error = await insertFile(file).then(() => null, (caught) => caught);
    assert.deepEqual([error?.code, error?.constraint], ["23505", "uq_files_project_folder_title"], JSON.stringify(file));
  };
  await violation({ folderId: seed.plans, title: "PLANO.pdf" });
  // Raíz: «Plano.pdf» y el renombrado «plano (2).PDF» siguen vigentes (el borrado lógico no cuenta).
  await violation({ title: "PLANO.PDF" });
  await violation({ title: "Plano (2).pdf" });
  await insertFile({ title: "Plano (3).pdf" });
  await insertFile({ projectId: seed.other, title: "plano.pdf" });
  await insertFile({ projectId: seed.other, folderId: null, title: "Único.pdf" });

  // Borrados lógicos y archivos retirados no ocupan el nombre; al reactivarse chocarían.
  const retired = await insertFile({ folderId: seed.plans, status: "deleted", title: "plano.pdf" });
  const restore = await database.client.query("update public.files set status = 'active' where id = $1", [retired]).then(() => null, (error) => error);
  assert.equal(restore?.constraint, "uq_files_project_folder_title");

  // Mover a una carpeta con homónimo también lo impide el índice.
  const loose = await insertFile({ folderId: seed.additional, title: "Memoria.pdf" });
  await insertFile({ folderId: seed.plans, title: "memoria.pdf" });
  const move = await database.client.query("update public.files set folder_id = $2 where id = $1", [loose, seed.plans]).then(() => null, (error) => error);
  assert.equal(move?.constraint, "uq_files_project_folder_title");
});

test("dos inserciones simultáneas con el mismo nombre y ubicación: la segunda espera y recibe 23505", { skip }, async () => {
  const [first, second] = [new pg.Client({ connectionString: database.databaseUrl }), new pg.Client({ connectionString: database.databaseUrl })];
  await Promise.all([first.connect(), second.connect()]);
  try {
    await first.query("begin");
    // ASCII: lower() de PostgreSQL sigue el LC_CTYPE de la base (con «C», «Á» no cambia; ver ARCHITECTURE).
    await insertFile({ folderId: seed.additional, title: "Simultaneo.pdf" }, first);
    const pending = insertFile({ folderId: seed.additional, title: "SIMULTANEO.pdf" }, second).then(() => null, (error) => error);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await first.query("commit");
    const error = await pending;
    assert.deepEqual([error?.code, error?.constraint], ["23505", "uq_files_project_folder_title"]);
  } finally {
    await Promise.all([first.end(), second.end()]);
  }
  assert.equal((await rows("select count(*)::int as total from public.files where folder_id = $1 and lower(title) = lower('Simultaneo.pdf')", [seed.additional]))[0].total, 1);
  // Aplicación e índice usan el mismo lower() de la base: si esta no pliega «Á», ninguno de los dos lo hace.
  const [{ ctype, folds }] = await rows("select datctype as ctype, lower('Á') = 'á' as folds from pg_database where datname = current_database()");
  const accented = [];
  for (const title of ["ánfora.pdf", "ÁNFORA.pdf"]) accented.push(await insertFile({ folderId: seed.plans, title }).then(() => "ok", (error) => error.constraint));
  assert.deepEqual(accented, folds ? ["ok", "uq_files_project_folder_title"] : ["ok", "ok"], `LC_CTYPE ${ctype}`);
});

test("la violación del índice se traduce a 409 DUPLICATE_PROJECT_FILE; otras violaciones conservan su 409 genérico", { skip }, async () => {
  const { normalizeError } = await import("../src/errors/appError.js");
  const error = await insertFile({ folderId: seed.plans, title: "PLANO.pdf" }).then(() => null, (caught) => caught);
  const normalized = normalizeError(error);
  assert.deepEqual([normalized.status, normalized.code], [409, "DUPLICATE_PROJECT_FILE"]);
  assert.equal(normalized.publicMessage.includes("lano"), false, "no expone el valor de la clave");
  assert.equal(normalizeError(Object.assign(new Error("x"), { code: "23505", constraint: "otra" })).code, "RESOURCE_CONFLICT");
});
