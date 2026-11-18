import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

import pg from "pg";

import { applyMigration, createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

/*
 * Ensayo de la expansión 20261118120000_project_file_review_audience_expand (Fase 1.2, B3) contra
 * PostgreSQL real. Opcional y local:
 *   ARCA_FILE_REVIEW_EXPANSION_DB_TESTS=1
 *   ARCA_FILE_REVIEW_EXPANSION_TEST_DATABASE_URL=postgres://postgres@localhost:54329/postgres
 * Aplica el historial hasta antes de la migración, registra datos existentes, ejecuta preflight,
 * migración y postcheck, y comprueba compatibilidad, integridad entre archivos y versiones,
 * autorizaciones, vínculos de garantías del mismo proyecto y reversión ante un fallo o un bloqueo.
 * Datos ficticios; nunca lee .env.
 */

const MIGRATION = "20261118120000_project_file_review_audience_expand";
const MIGRATION_FILE = new URL(`../prisma/migrations/${MIGRATION}/migration.sql`, import.meta.url);
const enabled = process.env.ARCA_FILE_REVIEW_EXPANSION_DB_TESTS === "1" && process.env.ARCA_FILE_REVIEW_EXPANSION_TEST_DATABASE_URL;
const skip = !enabled && "Requiere PostgreSQL local, ARCA_FILE_REVIEW_EXPANSION_DB_TESTS=1 y ARCA_FILE_REVIEW_EXPANSION_TEST_DATABASE_URL.";

let database;
let ids;
const checks = {};

/**
 * Ejecuta una consulta en la base desechable con el cliente propietario.
 *
 * @param {string} sql - Sentencia.
 * @param {unknown[]} [values] - Parámetros.
 * @returns {Promise<Array<object>>} Filas.
 */
async function rows(sql, values = []) {
  return (await database.client.query(sql, values)).rows;
}

/**
 * Ejecuta un archivo de comprobación sobre un cliente y devuelve todas sus filas.
 *
 * @param {import("pg").Client} client - Cliente de la base.
 * @param {"preflight"|"postcheck"} name - Archivo.
 * @returns {Promise<Array<object>>} Filas de todas las consultas.
 */
async function runCheck(client, name) {
  const source = await readFile(new URL(`../prisma/checks/${MIGRATION}/${name}.sql`, import.meta.url), "utf8");
  const results = await client.query(source.replace(/^\\.*$/gm, ""));
  return results.flatMap((result) => result.rows);
}

/**
 * Comprueba que todos los indicadores ok_* de un check sean verdaderos.
 *
 * @param {Array<object>} checkRows - Filas del check.
 * @param {string} label - Nombre para los mensajes.
 * @returns {void}
 */
function assertAllOk(checkRows, label) {
  let indicators = 0;
  for (const row of checkRows) {
    for (const [key, value] of Object.entries(row)) {
      if (!key.startsWith("ok_")) continue;
      indicators += 1;
      assert.equal(value, true, `${label}: ${row.name || row.table_name || row.column_name || ""}.${key}`);
    }
  }
  assert.ok(indicators > 0, `${label} sin indicadores`);
}

/**
 * Devuelve la huella de cada tabla alterada tal como la calculan los checks.
 *
 * @param {Array<object>} checkRows - Filas del check.
 * @returns {object} Tabla → [filas, huella].
 */
function fingerprints(checkRows) {
  return Object.fromEntries(checkRows.filter((row) => row.fingerprint).map((row) => [row.table_name, [row.row_count, row.fingerprint]]));
}

/**
 * Registra como terminadas las migraciones anteriores, como las dejaría `prisma migrate deploy`.
 * El helper las aplica sin Prisma y el preflight exige que la configuración de drafts esté aplicada.
 *
 * @param {import("pg").Client} client - Cliente de la base.
 * @returns {Promise<void>}
 */
async function recordPreviousMigrations(client) {
  const names = (await readdir(new URL("../prisma/migrations/", import.meta.url))).filter((name) => /^\d{14}_/.test(name) && name < MIGRATION);
  for (const name of names) {
    await client.query(`insert into public._prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count)
      values ($1, 'ensayo-local', $2, now(), 1)`, [randomUUID(), name]);
  }
}

/**
 * Registra la migración aplicada como lo haría `prisma migrate deploy`, con el SHA-256 de sus bytes.
 *
 * @param {import("pg").Client} client - Cliente de la base.
 * @returns {Promise<string>} Checksum registrado.
 */
async function recordMigration(client) {
  const checksum = createHash("sha256").update(await readFile(MIGRATION_FILE)).digest("hex");
  await client.query(`insert into public._prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count)
    values ($1, $2, $3, now(), 1)`, [randomUUID(), checksum, MIGRATION]);
  return checksum;
}

/**
 * Inserta un archivo con versiones como lo hace el backend actual (sin columnas nuevas).
 *
 * @param {object} options - Archivo.
 * @param {number|null} [options.projectId] - Proyecto (o null si es de una solicitud).
 * @param {number|null} [options.requestId] - Solicitud.
 * @param {number} options.versions - Número de versiones (la última es la vigente).
 * @returns {Promise<{ fileId: number, versionIds: number[] }>} Identificadores.
 */
async function insertLegacyFile({ projectId = null, requestId = null, versions }) {
  const [file] = await rows(`insert into public.files (project_id, project_request_id, uploaded_by, title, file_type, current_version)
    values ($1, $2, $3, $4, 'application/pdf', $5) returning id::int`, [projectId, requestId, ids.admin, `archivo-${randomUUID()}.pdf`, versions]);
  const versionIds = [];
  for (let number = 1; number <= versions; number += 1) {
    const [version] = await rows(`insert into public.file_versions (file_id, uploaded_by, version_number, file_name, original_name, file_url, file_extension, file_size, is_current)
      values ($1, $2, $3, $4, 'archivo.pdf', 's3://ficticio/archivo.pdf', 'pdf', 10, $5) returning id::int`,
    [file.id, ids.admin, number, `projects/${file.id}/v${number}.pdf`, number === versions]);
    versionIds.push(version.id);
  }
  return { fileId: file.id, versionIds };
}

/**
 * Espera que una sentencia falle con el código SQLSTATE indicado.
 *
 * @param {string} sql - Sentencia.
 * @param {unknown[]} values - Parámetros.
 * @param {string} code - SQLSTATE esperado.
 * @param {string} [constraint] - Restricción esperada.
 * @returns {Promise<void>}
 */
async function assertFails(sql, values, code, constraint) {
  await assert.rejects(rows(sql, values), (error) => {
    assert.equal(error.code, code, error.message);
    if (constraint) assert.equal(error.constraint, constraint);
    return true;
  });
}

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({
    baseUrl: process.env.ARCA_FILE_REVIEW_EXPANSION_TEST_DATABASE_URL,
    createApiRoles: true,
    prefix: "arca_file_review_expansion",
    stopBefore: MIGRATION,
  });
  const [adminRole] = await rows("insert into public.roles (code, name) values ('admin', 'Administrador') returning id");
  const [admin] = await rows(`insert into public.users (role_id, email, first_name, last_name, password_hash)
    values ($1, 'admin@expansion.test', 'Admin', 'Expansión', '!disabled!') returning id::int`, [adminRole.id]);
  const [client] = await rows("insert into public.clients (name, email) values ('Cliente Expansión', 'cliente@expansion.test') returning id::int");
  const project = async (name, slug) => (await rows(`insert into public.projects (client_id, created_by, name, status, public_slug)
    values ($1, $2, $3, 'draft', $4) returning id::int`, [client.id, admin.id, name, slug]))[0].id;
  ids = { admin: admin.id, client: client.id };
  ids.projectA = await project("Proyecto A", "proyecto-a-expansion");
  ids.projectB = await project("Proyecto B", "proyecto-b-expansion");
  const [request] = await rows(`insert into public.project_requests (client_id, requested_by, project_name, project_type, location, description, status)
    values ($1, $2, 'Solicitud', 'residential', 'Caracas', 'Descripción', 'draft') returning id::int`, [client.id, admin.id]);
  const warranty = async (projectId) => (await rows(`insert into public.project_warranties (project_id, product, model, code, start_date, service_date, end_date, created_by)
    values ($1, 'Calentador', 'X1', 'C-1', '2026-01-01', '2026-06-01', '2027-01-01', $2) returning id::int`, [projectId, admin.id]))[0].id;

  // Datos existentes antes de la migración: una versión, varias versiones, un adjunto de solicitud,
  // un archivo retirado heredado y garantías de dos proyectos.
  ids.single = await insertLegacyFile({ projectId: ids.projectA, versions: 1 });
  ids.multi = await insertLegacyFile({ projectId: ids.projectA, versions: 2 });
  ids.otherProjectFile = await insertLegacyFile({ projectId: ids.projectB, versions: 1 });
  ids.requestFile = await insertLegacyFile({ requestId: request.id, versions: 1 });
  const retired = await insertLegacyFile({ projectId: ids.projectA, versions: 1 });
  await rows("update public.files set status = 'deleted', deleted_at = now() where id = $1", [retired.fileId]);
  ids.warrantyA = await warranty(ids.projectA);
  ids.warrantyA2 = await warranty(ids.projectA);
  ids.warrantyB = await warranty(ids.projectB);

  await recordPreviousMigrations(database.client);
  checks.preflight = await runCheck(database.client, "preflight");
  await applyMigration(database.client, MIGRATION);
  checks.checksum = await recordMigration(database.client);
  checks.postcheck = await runCheck(database.client, "postcheck");
});

after(async () => {
  if (database) await database.drop();
});

test("preflight y postcheck correctos, datos existentes idénticos y checksum de los bytes en LF", { skip }, async () => {
  assertAllOk(checks.preflight, "preflight");
  assertAllOk(checks.postcheck, "postcheck");
  assert.deepEqual(fingerprints(checks.postcheck), fingerprints(checks.preflight));
  assert.equal(Object.keys(fingerprints(checks.preflight)).length, 3);
  const bytes = await readFile(MIGRATION_FILE);
  assert.equal(bytes.includes(Buffer.from("\r\n")), false, "la migración se guarda en LF (.gitattributes eol=lf)");
  assert.equal(checks.postcheck.find((row) => "recorded_checksum" in row).recorded_checksum, checks.checksum);
  const preflightCounts = checks.preflight.find((row) => "files_with_several_versions" in row);
  assert.equal(Number(preflightCounts.files_with_several_versions), 1);
});

test("compatibilidad: el backend actual sigue insertando y leyendo archivos con su SQL de siempre", { skip }, async () => {
  const legacy = await insertLegacyFile({ projectId: ids.projectA, versions: 1 });
  const [stored] = await rows(`select f.access_policy, v.review_status, v.content_type, v.reviewed_at, v.restored_from_version_id
    from public.files f join public.file_versions v on v.file_id = f.id where f.id = $1`, [legacy.fileId]);
  assert.deepEqual(stored, { access_policy: null, content_type: null, restored_from_version_id: null, review_status: null, reviewed_at: null });
  // La lectura de la versión vigente (fileRepository) no cambia.
  const [current] = await rows(`select v.id::int from public.files f left join public.file_versions v
    on v.file_id = f.id and v.version_number = f.current_version and v.deleted_at is null where f.id = $1`, [ids.multi.fileId]);
  assert.equal(current.id, ids.multi.versionIds[1]);
  // Aprobar una solicitud sigue moviendo su adjunto al proyecto (cambia project_id de la fila).
  await rows("update public.files set project_id = $2, project_request_id = null, origin_project_request_id = project_request_id where id = $1", [ids.requestFile.fileId, ids.projectB]);
  await rows("update public.files set project_id = null, project_request_id = origin_project_request_id, origin_project_request_id = null where id = $1", [ids.requestFile.fileId]);
});

test("primera versión pendiente y versión pendiente junto a la vigente, sin cambiar restricciones existentes", { skip }, async () => {
  const [file] = await rows(`insert into public.files (project_id, uploaded_by, title, file_type, current_version, access_policy)
    values ($1, $2, 'pendiente.pdf', 'application/pdf', null, 1) returning id::int`, [ids.projectA, ids.admin]);
  await rows(`insert into public.file_versions (file_id, uploaded_by, version_number, file_name, original_name, file_url, file_extension, file_size, is_current, content_type, review_status)
    values ($1, $2, 1, 'projects/p/v1.pdf', 'pendiente.pdf', 's3://ficticio/p.pdf', 'pdf', 10, false, 'application/pdf', 'pending')`, [file.id, ids.admin]);
  const [{ current_version: currentVersion }] = await rows("select current_version from public.files where id = $1", [file.id]);
  assert.equal(currentVersion, null);
  await rows(`insert into public.file_versions (file_id, uploaded_by, version_number, file_name, original_name, file_url, file_extension, file_size, is_current, content_type, review_status)
    values ($1, $2, 2, 'projects/s/v2.pdf', 'archivo.pdf', 's3://ficticio/v2.pdf', 'pdf', 10, false, 'image/png', 'pending')`, [ids.single.fileId, ids.admin]);
  // Una segunda vigente sigue rechazándose (uq_file_versions_current, sin cambios).
  await assertFails(`insert into public.file_versions (file_id, uploaded_by, version_number, file_name, original_name, file_url, file_extension, file_size, is_current)
    values ($1, $2, 3, 'x', 'x', 'x', 'pdf', 10, true)`, [ids.single.fileId, ids.admin], "23505", "uq_file_versions_current");
  // Varias pendientes por archivo no se impiden: es la propuesta PR1, sin aprobar.
  await rows(`insert into public.file_versions (file_id, uploaded_by, version_number, file_name, original_name, file_url, file_extension, file_size, is_current, review_status)
    values ($1, $2, 4, 'projects/s/v4.pdf', 'archivo.pdf', 's3://ficticio/v4.pdf', 'pdf', 10, false, 'pending')`, [ids.single.fileId, ids.admin]);
});

test("revisión: estados coherentes y rechazo con motivo; aprobar admite comentario", { skip }, async () => {
  const [version] = ids.multi.versionIds;
  const update = (set, values = []) => rows(`update public.file_versions set ${set} where id = $1`, [version, ...values]);
  const fails = (set, values = []) => assertFails(`update public.file_versions set ${set} where id = $1`, [version, ...values], "23514", "chk_file_versions_review_state");
  await fails("review_status = 'rejected', reviewed_at = now()");
  await fails("review_status = 'rejected', reviewed_at = now(), review_reason = '   '");
  await fails("review_status = 'pending', reviewed_at = now()");
  await fails("review_status = 'approved'");
  await fails("reviewed_by = $2", [ids.admin]);
  await update("review_status = 'pending'");
  await update("review_status = 'rejected', reviewed_at = now(), reviewed_by = $2, review_reason = 'Falta firma del cliente'", [ids.admin]);
  await update("review_status = 'approved', reviewed_at = now(), review_reason = 'Aprobado con observaciones'");
  await update("review_status = null, reviewed_at = null, reviewed_by = null, review_reason = null");
  await assertFails("update public.file_versions set content_type = '  ' where id = $1", [version], "23514", "chk_file_versions_content_type");
  await assertFails("update public.file_versions set reviewed_by = 999999, review_status = 'approved', reviewed_at = now() where id = $1", [version], "23503", "fk_file_versions_reviewed_by");
});

test("regresión: chk_file_versions_review_state solo acepta combinaciones explícitamente válidas (sin NULL tolerado)", { skip }, async () => {
  const { versionIds: [versionId] } = await insertLegacyFile({ projectId: ids.projectA, versions: 1 });
  const at = "2026-11-18T12:00:00Z";
  const by = ids.admin;
  /**
   * Fija los cuatro datos de revisión de la versión en una sola sentencia.
   *
   * @param {object} state - Estado de revisión.
   * @returns {Promise<Array<object>>} Filas.
   */
  const write = ({ reason = null, reviewedAt = null, reviewedBy = null, status = null }) => rows(
    `update public.file_versions set review_status = $2::public.file_version_review_status, reviewed_at = $3::timestamptz,
       reviewed_by = $4::bigint, review_reason = $5 where id = $1`,
    [versionId, status, reviewedAt, reviewedBy, reason],
  );
  const valid = [
    ["heredada sin datos", {}],
    ["pendiente sin datos", { status: "pending" }],
    ["aprobada con fecha", { reviewedAt: at, status: "approved" }],
    ["aprobada con fecha, revisor y comentario", { reason: "Aprobado", reviewedAt: at, reviewedBy: by, status: "approved" }],
    ["rechazada con fecha y motivo", { reason: "Falta firma", reviewedAt: at, status: "rejected" }],
    ["rechazada con fecha, revisor y motivo", { reason: "Falta firma", reviewedAt: at, reviewedBy: by, status: "rejected" }],
  ];
  const invalid = [
    ["heredada con fecha de revisión (caso NULL)", { reviewedAt: at }],
    ["heredada con revisor", { reviewedBy: by }],
    ["heredada con motivo", { reason: "x" }],
    ["heredada con fecha, revisor y motivo", { reason: "x", reviewedAt: at, reviewedBy: by }],
    ["pendiente con fecha", { reviewedAt: at, status: "pending" }],
    ["pendiente con revisor", { reviewedBy: by, status: "pending" }],
    ["pendiente con motivo", { reason: "x", status: "pending" }],
    ["aprobada sin fecha", { status: "approved" }],
    ["aprobada sin fecha con revisor", { reviewedBy: by, status: "approved" }],
    ["rechazada sin fecha", { reason: "Falta firma", status: "rejected" }],
    ["rechazada sin motivo", { reviewedAt: at, status: "rejected" }],
    ["rechazada con motivo en blanco", { reason: "   ", reviewedAt: at, status: "rejected" }],
  ];
  for (const [label, state] of valid) {
    await assert.doesNotReject(write(state), label);
  }
  for (const [label, state] of invalid) {
    await write({});
    await assert.rejects(write(state), (error) => {
      assert.equal(error.code, "23514", `${label}: ${error.message}`);
      assert.equal(error.constraint, "chk_file_versions_review_state", label);
      return true;
    }, label);
  }
  // La fila queda como heredada: ningún intento inválido dejó datos.
  const [stored] = await rows("select review_status, reviewed_at, reviewed_by, review_reason from public.file_versions where id = $1", [versionId]);
  assert.deepEqual(stored, { review_reason: null, review_status: null, reviewed_at: null, reviewed_by: null });
});

test("restaurar solo apunta a otra versión del mismo archivo", { skip }, async () => {
  const [first, second] = ids.multi.versionIds;
  await rows("update public.file_versions set restored_from_version_id = $2 where id = $1", [second, first]);
  await assertFails("update public.file_versions set restored_from_version_id = $2 where id = $1", [second, ids.otherProjectFile.versionIds[0]], "23503", "fk_file_versions_restored_from");
  await assertFails("update public.file_versions set restored_from_version_id = id where id = $1", [second], "23514", "chk_file_versions_restored_from_other");
  // Restaurar una versión rechazada no se impide en la base: es la propuesta PR2.
  await rows("update public.file_versions set review_status = 'rejected', reviewed_at = now(), review_reason = 'x' where id = $1", [first]);
  await rows("update public.file_versions set restored_from_version_id = $2 where id = $1", [second, first]);
});

test("autorizaciones: versión del mismo archivo, archivo del mismo proyecto y una sola activa del cliente", { skip }, async () => {
  const grant = (fileId, versionId, audience, projectId = ids.projectA) => rows(`insert into public.project_file_audience_grants (project_id, file_id, file_version_id, audience, granted_by)
    values ($1, $2, $3, $4, $5) returning id::int`, [projectId, fileId, versionId, audience, ids.admin]);
  const { fileId, versionIds: [v1, v2] } = ids.multi;
  const [first] = await grant(fileId, v1, "client_owner");
  await assert.rejects(grant(fileId, v2, "client_owner"), { code: "23505", constraint: "uq_project_file_audience_grants_client_active" });
  // Compartir otra versión: la anterior se cierra como sustituida (historial para D4).
  await rows("update public.project_file_audience_grants set ended_at = now(), ended_by = $2, end_reason = 'superseded' where id = $1", [first.id, ids.admin]);
  const [second] = await grant(fileId, v2, "client_owner");
  await rows("update public.project_file_audience_grants set ended_at = now(), end_reason = 'revoked' where id = $1", [second.id]);
  const history = await rows("select file_version_id::int, end_reason from public.project_file_audience_grants where file_id = $1 order by id", [fileId]);
  assert.deepEqual(history, [{ end_reason: "superseded", file_version_id: v1 }, { end_reason: "revoked", file_version_id: v2 }]);

  // Escaparate independiente del cliente: sin autorización del cliente y con varias activas (PR3 y
  // una sola versión en el escaparate siguen pendientes).
  await grant(fileId, v1, "showcase");
  await grant(fileId, v2, "showcase");

  await assert.rejects(grant(fileId, ids.otherProjectFile.versionIds[0], "client_owner"), { code: "23503", constraint: "fk_project_file_audience_grants_version" });
  await assert.rejects(grant(fileId, v1, "client_owner", ids.projectB), { code: "23503", constraint: "fk_project_file_audience_grants_file" });
  await assert.rejects(grant(ids.requestFile.fileId, ids.requestFile.versionIds[0], "client_owner"), { code: "23503", constraint: "fk_project_file_audience_grants_file" });
  const [third] = await grant(ids.single.fileId, ids.single.versionIds[0], "client_owner");
  for (const set of ["ended_at = now()", "end_reason = 'revoked'", "ended_by = $2", "ended_at = granted_at - interval '1 second', end_reason = 'revoked'"]) {
    await assertFails(`update public.project_file_audience_grants set ${set} where id = $1`, set.includes("$2") ? [third.id, ids.admin] : [third.id], "23514", "chk_project_file_audience_grants_end");
  }
  // El archivo de una autorización no puede cambiar de proyecto ni borrarse mientras exista.
  await assertFails("update public.files set project_id = $2 where id = $1", [ids.single.fileId, ids.projectB], "23503");
});

test("garantías: solo documentos y garantías del mismo proyecto; varias garantías por documento", { skip }, async () => {
  const link = (warrantyId, fileId, projectId = ids.projectA) => rows(`insert into public.project_warranty_documents (project_id, warranty_id, file_id, linked_by)
    values ($1, $2, $3, $4) returning id::int`, [projectId, warrantyId, fileId, ids.admin]);
  const fileId = ids.multi.fileId;
  const [first] = await link(ids.warrantyA, fileId);
  await link(ids.warrantyA2, fileId);
  await assert.rejects(link(ids.warrantyA, fileId), { code: "23505", constraint: "uq_project_warranty_documents_active" });
  await assert.rejects(link(ids.warrantyB, fileId), { code: "23503", constraint: "fk_project_warranty_documents_warranty" });
  await assert.rejects(link(ids.warrantyB, fileId, ids.projectB), { code: "23503", constraint: "fk_project_warranty_documents_file" });
  await assert.rejects(link(ids.warrantyA, ids.otherProjectFile.fileId), { code: "23503", constraint: "fk_project_warranty_documents_file" });
  await assertFails("update public.project_warranty_documents set unlinked_by = $2 where id = $1", [first.id, ids.admin], "23514", "chk_project_warranty_documents_unlink");
  // Desvincular conserva la fila y permite volver a vincular.
  await rows("update public.project_warranty_documents set unlinked_at = now(), unlinked_by = $2 where id = $1", [first.id, ids.admin]);
  await link(ids.warrantyA, fileId);
  const [{ total }] = await rows("select count(*)::int as total from public.project_warranty_documents where file_id = $1", [fileId]);
  assert.equal(total, 3);
  // La garantía retirada (borrado lógico actual) conserva sus vínculos.
  await rows("update public.project_warranties set deleted_at = now() where id = $1", [ids.warrantyA2]);
  assert.equal((await rows("select count(*)::int as total from public.project_warranty_documents where warranty_id = $1", [ids.warrantyA2]))[0].total, 1);
});

test("rollback: un fallo a mitad o un bloqueo ocupado revierten la migración entera sin cambios", { skip }, async () => {
  const second = await createIsolatedMigrationDatabase({
    baseUrl: process.env.ARCA_FILE_REVIEW_EXPANSION_TEST_DATABASE_URL,
    prefix: "arca_file_review_rollback",
    stopBefore: MIGRATION,
  });
  const blocker = new pg.Client({ connectionString: second.databaseUrl, ssl: false });
  /**
   * Indica qué objetos de la migración existen en la base de reversión.
   *
   * @returns {Promise<object>} Presencia de columnas, tipos y tablas nuevos.
   */
  const leftovers = async () => (await second.client.query(`select
      exists (select 1 from information_schema.columns where table_name = 'files' and column_name = 'access_policy') as column_present,
      exists (select 1 from pg_type where typname = 'file_version_review_status') as type_present,
      to_regclass('public.project_file_audience_grants') is not null as grants_present,
      to_regclass('public.project_warranty_documents') is not null as links_present`)).rows[0];
  const nothingLeft = { column_present: false, grants_present: false, links_present: false, type_present: false };
  try {
    // 1. Fallo a mitad: un objeto que ya existe hace fallar una sentencia posterior a las primeras.
    await second.client.query("create type public.project_file_grant_end_reason as enum ('otro')");
    await assert.rejects(applyMigration(second.client, MIGRATION), { code: "42710" });
    await second.client.query("rollback");
    assert.deepEqual(await leftovers(), nothingLeft);
    await second.client.query("drop type public.project_file_grant_end_reason");

    // 2. Bloqueo ocupado: una transacción abierta sobre files agota lock_timeout (3 s) y revierte todo.
    await blocker.connect();
    await blocker.query("begin");
    await blocker.query("select count(*) from public.files");
    const startedAt = Date.now();
    await assert.rejects(applyMigration(second.client, MIGRATION), { code: "55P03" });
    assert.ok(Date.now() - startedAt < 15_000, "se detiene por lock_timeout, no espera indefinidamente");
    await second.client.query("rollback");
    await blocker.query("rollback");
    assert.deepEqual(await leftovers(), nothingLeft);

    // 3. Sin bloqueos, la misma migración se aplica completa y el postcheck es correcto.
    await recordPreviousMigrations(second.client);
    const preflight = await runCheck(second.client, "preflight");
    assertAllOk(preflight, "preflight de reversión");
    await applyMigration(second.client, MIGRATION);
    await recordMigration(second.client);
    const postcheck = await runCheck(second.client, "postcheck");
    assertAllOk(postcheck, "postcheck de reversión");
    assert.deepEqual(fingerprints(postcheck), fingerprints(preflight));
  } finally {
    await blocker.end().catch(() => {});
    await second.drop();
  }
});
