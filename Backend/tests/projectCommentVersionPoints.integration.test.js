import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

import { applyMigration, createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

/*
 * Migración 20261119120000_project_comment_version_points (Fase 1.2, B6) contra PostgreSQL real.
 * Opcional y local:
 *   ARCA_COMMENT_VERSION_POINTS_DB_TESTS=1
 *   ARCA_COMMENT_VERSION_POINTS_TEST_DATABASE_URL=postgres://postgres@localhost:54329/postgres
 * Base propia detenida antes de la migración, con puntos de panorámica existentes. Comprueba preflight
 * y postcheck, conservación de las filas, checksum, unicidad con versión NULL, aislamiento por versión,
 * filas fuera del índice (retiradas y respuestas) y la reversión documentada.
 */

const MIGRATION = "20261119120000_project_comment_version_points";
const MIGRATION_FILE = new URL(`../prisma/migrations/${MIGRATION}/migration.sql`, import.meta.url);
const enabled = process.env.ARCA_COMMENT_VERSION_POINTS_DB_TESTS === "1" && process.env.ARCA_COMMENT_VERSION_POINTS_TEST_DATABASE_URL;
const skip = !enabled && "Requiere PostgreSQL local, ARCA_COMMENT_VERSION_POINTS_DB_TESTS=1 y ARCA_COMMENT_VERSION_POINTS_TEST_DATABASE_URL.";
const ROLLBACK_SQL = `
  BEGIN;
  CREATE UNIQUE INDEX project_comments_panorama_point_unique_idx ON public.project_comments (
    project_id, comment_type, coalesce(target_id, ''), ((target_metadata->>'pointNumber')::integer))
    WHERE deleted_at IS NULL AND parent_comment_id IS NULL AND comment_type = 'panorama'::public.comment_type AND target_metadata ? 'pointNumber';
  DROP INDEX public.project_comments_panorama_version_point_unique_idx;
  DELETE FROM public._prisma_migrations WHERE migration_name = '${MIGRATION}';
  COMMIT;`;

let database;
const ids = {};
const checks = {};

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
 * Ejecuta un archivo de comprobación (sin metacomandos de psql) y devuelve todas sus filas.
 *
 * @param {"preflight"|"postcheck"} name - Archivo.
 * @returns {Promise<Array<object>>} Filas de todas las consultas.
 */
async function runCheck(name) {
  const source = await readFile(new URL(`../prisma/checks/${MIGRATION}/${name}.sql`, import.meta.url), "utf8");
  return (await database.client.query(source.replace(/^\\.*$/gm, ""))).flatMap((result) => result.rows);
}

/**
 * Comprueba que todos los indicadores ok_* de un check sean verdaderos.
 *
 * @param {Array<object>} checkRows - Filas del check.
 * @param {string} label - Nombre para los mensajes.
 * @returns {void}
 */
function assertAllOk(checkRows, label) {
  const indicators = checkRows.flatMap((row) => Object.entries(row).filter(([key]) => key.startsWith("ok_")));
  assert.ok(indicators.length > 0, `${label} sin indicadores`);
  for (const [key, value] of indicators) assert.equal(value, true, `${label}.${key}`);
}

/**
 * Huella de todos los comentarios: número de filas y hash de su contenido ordenado por id.
 *
 * @returns {Promise<{ total: number, fingerprint: string }>} Huella.
 */
async function commentFingerprint() {
  const [row] = await rows(`select count(*)::int as total,
    md5(coalesce(string_agg(concat_ws('|', id, project_id, user_id, parent_comment_id, comment_type, content, target_id,
      target_metadata::text, file_id, file_version_id, deleted_at), ';' order by id), '')) as fingerprint
    from public.project_comments`);
  return row;
}

/**
 * Inserta un comentario de panorámica con número de punto y versión opcional.
 *
 * @param {object} options - Comentario.
 * @param {number} options.point - Número de punto.
 * @param {number|null} [options.versionId] - Versión comentada.
 * @param {string} [options.targetId] - Destino.
 * @param {number|null} [options.parentId] - Comentario raíz.
 * @param {boolean} [options.deleted] - Comentario retirado.
 * @returns {Promise<number>} Id del comentario.
 */
async function insertPoint({ deleted = false, parentId = null, point, targetId = String(ids.fileId), versionId = null }) {
  const [row] = await rows(`insert into public.project_comments (project_id, user_id, parent_comment_id, comment_type, content, target_id,
      target_metadata, status, file_id, file_version_id, deleted_at)
    values ($1, $2, $3, 'panorama', 'Punto', $4, jsonb_build_object('pointNumber', $5::int), 'active', $6, $7, $8) returning id::int`, [
    ids.projectId, ids.admin, parentId, targetId, point, versionId === null ? null : ids.fileId, versionId, deleted ? new Date() : null,
  ]);
  return row.id;
}

/**
 * Espera que una inserción falle por el índice indicado.
 *
 * @param {Promise<unknown>} operation - Inserción.
 * @param {string} constraint - Índice esperado.
 * @returns {Promise<void>}
 */
async function assertDuplicate(operation, constraint) {
  await assert.rejects(operation, (error) => error.code === "23505" && error.constraint === constraint);
}

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({
    baseUrl: process.env.ARCA_COMMENT_VERSION_POINTS_TEST_DATABASE_URL,
    prefix: "arca_comment_version_points",
    stopBefore: MIGRATION,
  });
  const [role] = await rows("insert into public.roles (code, name) values ('admin', 'admin') returning id");
  const [admin] = await rows(`insert into public.users (role_id, email, first_name, last_name, password_hash)
    values ($1, 'admin@puntos.test', 'A', 'B', '!disabled!') returning id::int`, [role.id]);
  const [client] = await rows("insert into public.clients (name, email) values ('Cliente', 'cliente@puntos.test') returning id::int");
  const [project] = await rows(`insert into public.projects (client_id, created_by, name, status, public_slug, start_date, project_type, location, has_plans)
    values ($1, $2, 'Puntos', 'in_process', 'puntos-b6', '2026-11-01', 'residential', 'Caracas', false) returning id::int`, [client.id, admin.id]);
  Object.assign(ids, { admin: admin.id, projectId: project.id });
  const [file] = await rows(`insert into public.files (project_id, uploaded_by, title, file_type, file_category, current_version, access_policy)
    values ($1, $2, '360.jpg', 'image/jpeg', 'image', 2, 1) returning id::int`, [project.id, admin.id]);
  ids.fileId = file.id;
  ids.versions = [];
  for (const number of [1, 2]) {
    const [version] = await rows(`insert into public.file_versions (file_id, uploaded_by, version_number, file_name, original_name, file_url, file_extension,
        file_size, is_current, content_type, review_status, reviewed_by, reviewed_at)
      values ($1, $2, $3, $4, '360.jpg', 's3://ficticio', 'jpg', 10, $5, 'image/jpeg', 'approved', $2, now()) returning id::int`,
    [file.id, admin.id, number, `projects/${project.id}/files/${file.id}/v${number}/360.jpg`, number === 2]);
    ids.versions.push(version.id);
  }

  // Puntos existentes antes de la migración: dos raíces, una respuesta que copia el punto 1, un
  // retirado con el punto 1 y otro destino con el punto 1.
  ids.existing = [await insertPoint({ point: 1 }), await insertPoint({ point: 2 })];
  ids.existing.push(await insertPoint({ parentId: ids.existing[0], point: 1 }));
  ids.existing.push(await insertPoint({ deleted: true, point: 1 }));
  ids.existing.push(await insertPoint({ point: 1, targetId: "render-portada" }));

  const previous = (await readdir(new URL("../prisma/migrations/", import.meta.url))).filter((name) => /^\d{14}_/.test(name) && name < MIGRATION);
  for (const name of previous) {
    await rows(`insert into public._prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count)
      values ($1, 'ensayo-local', $2, now(), 1)`, [randomUUID(), name]);
  }
  checks.preflight = await runCheck("preflight");
  checks.before = await commentFingerprint();
  await applyMigration(database.client, MIGRATION);
  checks.checksum = createHash("sha256").update(await readFile(MIGRATION_FILE)).digest("hex");
  await rows(`insert into public._prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count)
    values ($1, $2, $3, now(), 1)`, [randomUUID(), checks.checksum, MIGRATION]);
  checks.after = await commentFingerprint();
  checks.postcheck = await runCheck("postcheck");
});

after(async () => {
  if (database) await database.drop();
});

test("preflight y postcheck correctos; los puntos existentes se conservan idénticos; checksum de los bytes en LF", { skip }, async () => {
  assertAllOk(checks.preflight, "preflight");
  assertAllOk(checks.postcheck, "postcheck");
  assert.deepEqual(checks.after, checks.before, "ninguna fila cambia");
  assert.equal(checks.before.total, 5);
  const bytes = await readFile(MIGRATION_FILE);
  assert.equal(bytes.includes(Buffer.from("\r\n")), false, "LF");
  assert.equal(checks.checksum, "41b9363e31d9a956260db403c0dce11d665267b1f4921cad1c9fd70d37c83c92");
});

test("versión NULL: la unicidad es la anterior (mismo destino y punto rechazados; retirados y respuestas fuera)", { skip }, async () => {
  const index = "project_comments_panorama_version_point_unique_idx";
  await assertDuplicate(insertPoint({ point: 1 }), index);
  await assertDuplicate(insertPoint({ point: 2 }), index);
  // Otro destino, una respuesta o un comentario retirado no compiten por el número.
  assert.ok(await insertPoint({ point: 2, targetId: "render-portada" }));
  assert.ok(await insertPoint({ parentId: ids.existing[1], point: 2 }));
  assert.ok(await insertPoint({ deleted: true, point: 2 }));
  assert.ok(await insertPoint({ point: 3 }), "el siguiente número libre");
});

test("numeración aislada por versión: cada versión empieza en 1 y no choca con NULL ni con otra versión", { skip }, async () => {
  const index = "project_comments_panorama_version_point_unique_idx";
  const [v1, v2] = ids.versions;
  assert.ok(await insertPoint({ point: 1, versionId: v1 }), "convive con el punto 1 sin versión");
  assert.ok(await insertPoint({ point: 1, versionId: v2 }), "convive con el punto 1 de otra versión");
  assert.ok(await insertPoint({ point: 2, versionId: v1 }));
  await assertDuplicate(insertPoint({ point: 1, versionId: v1 }), index);
  await assertDuplicate(insertPoint({ point: 2, versionId: v1 }), index);
  const counts = await rows(`select coalesce(file_version_id, 0)::int as version_id, count(*)::int as roots
    from public.project_comments where target_id = $1 and parent_comment_id is null and deleted_at is null and comment_type = 'panorama'
    group by 1 order by 1`, [String(ids.fileId)]);
  assert.deepEqual(counts, [{ roots: 3, version_id: 0 }, { roots: 2, version_id: v1 }, { roots: 1, version_id: v2 }]);
});

test("reversión documentada: bloqueada (23505) mientras existan puntos repetidos entre versiones; posible sin ellos", { skip }, async () => {
  await assert.rejects(database.client.query(ROLLBACK_SQL), (error) => error.code === "23505");
  await rows("rollback");
  assert.ok((await rows("select to_regclass('public.project_comments_panorama_version_point_unique_idx') as idx"))[0].idx, "sigue la migración");
  // Sin puntos repetidos entre versiones (retirando los de versión), la reversión se completa.
  await rows("update public.project_comments set deleted_at = now() where file_version_id is not null");
  await database.client.query(ROLLBACK_SQL);
  assertAllOk(await runCheck("preflight"), "preflight tras revertir");
  await applyMigration(database.client, MIGRATION);
  await rows(`insert into public._prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count)
    values ($1, $2, $3, now(), 1)`, [randomUUID(), checks.checksum, MIGRATION]);
  assertAllOk(await runCheck("postcheck"), "postcheck tras volver a migrar");
});
