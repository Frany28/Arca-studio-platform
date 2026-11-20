import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";
import {
  applyCompatibilityPlan,
  buildCompatibilityPlan,
  readPlan,
  sha256,
  verifyCompatibilityPlan,
} from "../src/services/projectFileCompatibilityService.js";

/*
 * Herramienta de compatibilidad de archivos heredados (Fase 1.2, B9) contra PostgreSQL real.
 * Opcional y local:
 *   ARCA_FILE_COMPATIBILITY_DB_TESTS=1
 *   ARCA_FILE_COMPATIBILITY_TEST_DATABASE_URL=postgres://postgres@localhost:54329/postgres
 * Base propia con todas las migraciones, eliminada al terminar; nunca lee .env. Los planes e informes
 * se guardan en una carpeta temporal del sistema, fuera del repositorio.
 */

const enabled = process.env.ARCA_FILE_COMPATIBILITY_DB_TESTS === "1" && process.env.ARCA_FILE_COMPATIBILITY_TEST_DATABASE_URL;
const skip = !enabled && "Requiere PostgreSQL local, ARCA_FILE_COMPATIBILITY_DB_TESTS=1 y ARCA_FILE_COMPATIBILITY_TEST_DATABASE_URL.";
const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECKS = path.join(BACKEND_ROOT, "scripts", "project-file-compatibility");

let database;
let server;
let base;
let modules;
let workDir;
const seed = {};
const storage = new Map();
const TARGET = "compatibilidad@local";

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
 * Abre un cliente propio, como el del comando.
 *
 * @returns {Promise<pg.Client>} Cliente conectado.
 */
async function toolClient() {
  const client = new pg.Client({ connectionString: database.databaseUrl });
  await client.connect();
  return client;
}

/**
 * Ejecuta un archivo de comprobación (sin metacomandos de psql) y devuelve todas sus filas.
 *
 * @param {"preflight"|"postcheck"} name - Archivo.
 * @returns {Promise<Array<object>>} Filas.
 */
async function runCheck(name) {
  const source = await readFile(path.join(CHECKS, `${name}.sql`), "utf8");
  return (await database.client.query(source.replace(/^\\.*$/gm, ""))).flatMap((result) => result.rows);
}

/**
 * Huellas de las tablas que la conversión no debe cambiar, tal como las calculan los checks.
 *
 * @param {Array<object>} checkRows - Filas de un check.
 * @returns {object} Tabla → [filas, huella].
 */
function fingerprints(checkRows) {
  return Object.fromEntries(checkRows.filter((row) => row.fingerprint).map((row) => [row.table_name, [String(row.row_count), row.fingerprint]]));
}

/**
 * Comprueba que todos los indicadores ok_* de un check sean verdaderos.
 *
 * @param {Array<object>} checkRows - Filas.
 * @param {string} label - Etiqueta.
 * @returns {void}
 */
function assertAllOk(checkRows, label) {
  const indicators = checkRows.flatMap((row) => Object.entries(row).filter(([key]) => key.startsWith("ok_")));
  assert.ok(indicators.length > 0, label);
  for (const [key, value] of indicators) assert.equal(value, true, `${label}.${key}`);
}

/**
 * Prepara un plan con la herramienta y lo guarda como lo haría el comando.
 *
 * @returns {Promise<{ plan: object, planSha256: string, text: string }>} Plan y huella.
 */
async function preparePlan() {
  const client = await toolClient();
  try {
    const plan = await buildCompatibilityPlan(client, { target: TARGET });
    const text = `${JSON.stringify(plan, null, 2)}\n`;
    return { plan: readPlan(text, sha256(text)), planSha256: sha256(text), text };
  } finally {
    await client.end();
  }
}

/**
 * Aplica un plan con un cliente propio.
 *
 * @param {{ plan: object, planSha256: string }} prepared - Plan.
 * @param {object} [options] - Opciones extra (maxFiles, operador).
 * @returns {Promise<object>} Resultado.
 */
async function applyPlan(prepared, options = {}) {
  const client = await toolClient();
  try {
    return await applyCompatibilityPlan(client, { operatorUserId: seed.admin, plan: prepared.plan, planSha256: prepared.planSha256, target: TARGET, ...options });
  } finally {
    await client.end();
  }
}

/**
 * Descarga un archivo de proyecto y devuelve el estado HTTP.
 *
 * @param {number} projectId - Proyecto.
 * @param {number} fileId - Archivo.
 * @param {string} actor - Actor.
 * @returns {Promise<number>} Estado.
 */
async function downloadStatus(projectId, fileId, actor) {
  return (await fetch(`${base}/projects/${projectId}/files/${fileId}/content`, { headers: seed.headers[actor] })).status;
}

/**
 * Crea un proyecto del cliente A con sus carpetas predeterminadas.
 *
 * @param {object} [options] - Estado, publicación y nombre.
 * @returns {Promise<{ id: number, folders: Record<string, number> }>} Proyecto.
 */
async function createProject({ isPublic = false, status = "in_process" } = {}) {
  const [project] = await rows(`insert into public.projects (client_id, created_by, assigned_architect_id, name, status, public_slug, start_date, project_type, location, has_plans, is_public, archived_from_status)
    values ($1, $2, $3, $4, $5, $6, '2026-11-01', 'residential', 'Caracas', false, $7, $8) returning id::int`,
  [seed.clientA, seed.admin, seed.architect, `Compat ${randomUUID().slice(0, 6)}`, status, `c-${randomUUID()}`, isPublic, status === "archived" ? "in_process" : null]);
  const client = await modules.pool.connect();
  try {
    await client.query("begin");
    await modules.ensureProjectSystemFolders(client, { createdBy: seed.admin, projectId: project.id });
    await client.query("commit");
  } finally {
    client.release();
  }
  const folders = Object.fromEntries((await rows("select system_key, id::int from public.project_folders where project_id = $1 and system_key is not null", [project.id]))
    .map((row) => [row.system_key, row.id]));
  return { folders, id: project.id };
}

/**
 * Registra un archivo heredado con sus versiones (la vigente es la última salvo `currentVersion`).
 *
 * @param {object} options - Archivo.
 * @returns {Promise<{ fileId: number, versionIds: number[] }>} Identificadores.
 */
async function insertLegacyFile({ currentVersion, folderId = null, originRequestId = null, projectId, type = "application/pdf", versions = [{}] }) {
  const current = currentVersion === undefined ? versions.length : currentVersion;
  const [file] = await rows(`insert into public.files (project_id, folder_id, uploaded_by, title, file_type, file_category, current_version, origin_project_request_id)
    values ($1, $2, $3, $4, $5, $6, $7, $8) returning id::int`,
  [projectId, folderId, seed.architect, `Título privado ${randomUUID().slice(0, 4)}`, type, type.startsWith("image/") ? "image" : "document", current, originRequestId]);
  const versionIds = [];
  for (const [index, version] of versions.entries()) {
    const key = `projects/${projectId}/files/${file.id}/v${index + 1}/privado.bin`;
    storage.set(key, { body: Buffer.from(`f${file.id}-v${index + 1}`), contentType: type });
    const [stored] = await rows(`insert into public.file_versions (file_id, uploaded_by, version_number, file_name, original_name, file_url, file_extension, file_size, is_current, created_at)
      values ($1, $2, $3, $4, 'privado.bin', 's3://ficticio', 'bin', 10, $5, coalesce($6::timestamptz, now())) returning id::int`,
    [file.id, version.uploadedBy ?? seed.architect, index + 1, key, index + 1 === current, version.createdAt ?? null]);
    versionIds.push(stored.id);
  }
  return { fileId: file.id, versionIds };
}

/**
 * Inserta un comentario histórico (sin versión) de galería o general.
 *
 * @param {object} options - Comentario.
 * @returns {Promise<number>} Id.
 */
async function insertHistoricalComment({ commentType = "image", createdAt = null, parentId = null, point = null, projectId, targetId, userId }) {
  const [row] = await rows(`insert into public.project_comments (project_id, user_id, parent_comment_id, comment_type, content, target_id, target_metadata, status, created_at)
    values ($1, $2, $3, $4::comment_type, 'Histórico', $5, $6::jsonb, 'active', coalesce($7::timestamptz, now())) returning id::int`,
  [projectId, userId, parentId, commentType, targetId, point === null ? "{}" : JSON.stringify({ pointNumber: point }), createdAt]);
  return row.id;
}

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({ recordMigrations: true, baseUrl: process.env.ARCA_FILE_COMPATIBILITY_TEST_DATABASE_URL, prefix: "arca_file_compatibility" });
  workDir = await mkdtemp(path.join(tmpdir(), "arca-file-compatibility-it-"));
  // El helper registra el historial terminado con los checksums reales que verifica la activación.
  Object.assign(process.env, {
    AUTH_TOKEN_SECRET: "file-compatibility-test-secret-0123456789abcdef0123456789abcdef",
    DATABASE_POOL_MAX: "8",
    DATABASE_URL: database.databaseUrl,
    NODE_ENV: "test",
    PROJECT_FILE_REVIEW_ENABLED: "true",
    SUPABASE_STORAGE_BUCKET: "test-bucket",
    SUPABASE_STORAGE_S3_ACCESS_KEY_ID: "test-access-key",
    SUPABASE_STORAGE_S3_ENDPOINT: "https://storage.test.local/s3",
    SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY: "test-secret-key",
  });
  modules = {
    ...(await import("../src/config/db.js")),
    ...(await import("../src/services/objectStorage.js")),
    ...(await import("../src/services/sessionService.js")),
    ...(await import("../src/repositories/projectSystemFolderRepository.js")),
    app: (await import("../src/app.js")).default,
  };
  modules.objectStorage.get = async (key) => {
    const stored = storage.get(key);
    if (!stored) throw Object.assign(new Error("NoSuchKey"), { $metadata: { httpStatusCode: 404 }, name: "NoSuchKey" });
    return { Body: Readable.from([stored.body]), ContentLength: stored.body.length, ContentType: stored.contentType };
  };
  const roleId = async (code) => Number((await rows("insert into public.roles (code, name) values ($1, $1) returning id", [code]))[0].id);
  const roles = { admin: await roleId("admin"), architect: await roleId("architect"), client: await roleId("client") };
  const [permission] = await rows("insert into public.permissions (code, name, description, module) values ('projects.read', 'projects.read', null, 'projects') returning id");
  for (const id of Object.values(roles)) await rows("insert into public.role_permissions (role_id, permission_id, is_active) values ($1, $2, true)", [id, permission.id]);
  const insertClient = async (email) => Number((await rows("insert into public.clients (name, email) values ('Cliente Privado', $1) returning id", [email]))[0].id);
  const insertUser = async (role, email, clientId = null) => Number((await rows(`insert into public.users (role_id, client_id, email, first_name, last_name, password_hash)
    values ($1, $2, $3, 'Nombre', 'Privado', '!disabled!') returning id`, [roles[role], clientId, email]))[0].id);
  seed.clientA = await insertClient("a@compat.test");
  seed.clientB = await insertClient("b@compat.test");
  seed.admin = await insertUser("admin", "admin@compat.test");
  seed.architect = await insertUser("architect", "arq@compat.test");
  seed.owner = await insertUser("client", "owner@compat.test", seed.clientA);
  seed.coOwner = await insertUser("client", "socio@compat.test", seed.clientA);
  seed.stranger = await insertUser("client", "ajeno@compat.test", seed.clientB);
  const session = async (userId) => ({ Authorization: `Bearer ${(await modules.issueUserSession(userId)).token}` });
  seed.headers = {};
  for (const actor of ["admin", "architect", "owner", "coOwner", "stranger"]) seed.headers[actor] = await session(seed[actor]);
  server = modules.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;

  // Escenario heredado.
  const p1 = await createProject();
  const p2 = await createProject({ isPublic: true, status: "finished" });
  const p3 = await createProject({ isPublic: true });
  const p4 = await createProject({ status: "draft" });
  const p5 = await createProject({ status: "archived" });
  Object.assign(seed, { p1, p2, p3, p4, p5 });
  seed.f = {
    document: await insertLegacyFile({ projectId: p1.id }),
    image: await insertLegacyFile({ projectId: p1.id, type: "image/png" }),
    previous: await insertLegacyFile({ projectId: p1.id, type: "image/png", versions: [{ createdAt: "2026-01-01T00:00:00Z" }, { createdAt: "2026-02-01T00:00:00Z" }] }),
    ownerVersion: await insertLegacyFile({ projectId: p1.id, versions: [{ uploadedBy: seed.owner }, {}] }),
    warranty: await insertLegacyFile({ folderId: p1.folders["documents.warranties"], projectId: p1.id }),
    noCurrent: await insertLegacyFile({ currentVersion: null, projectId: p1.id }),
    showcase: await insertLegacyFile({ projectId: p2.id, type: "image/png" }),
    publicUnfinished: await insertLegacyFile({ projectId: p3.id, type: "image/png" }),
    archived: await insertLegacyFile({ projectId: p5.id }),
  };
  // Adjunto transferido: procedencia y fecha de aprobación de la solicitud.
  const [request] = await rows(`insert into public.project_requests (client_id, requested_by, project_name, project_type, location, description, status, converted_project_id, reviewed_at)
    values ($1, $2, 'Solicitud', 'residential', 'Caracas', 'Descripción', 'converted', $3, '2026-03-01T10:00:00Z') returning id::int`, [seed.clientA, seed.owner, p4.id]);
  seed.request = request.id;
  seed.f.transferred = await insertLegacyFile({ folderId: p4.folders.client_files, originRequestId: request.id, projectId: p4.id, type: "image/png", versions: [{ createdAt: "2026-02-20T00:00:00Z", uploadedBy: seed.owner }] });
  // Comentarios históricos: del equipo con respuesta del cliente y un punto de panorámica; uno sobre una versión anterior.
  seed.comments = {
    staff: await insertHistoricalComment({ projectId: p1.id, targetId: String(seed.f.image.fileId), userId: seed.architect }),
    point: await insertHistoricalComment({ commentType: "panorama", point: 1, projectId: p1.id, targetId: `project-file-${seed.f.image.fileId}`, userId: seed.architect }),
    previous: await insertHistoricalComment({ createdAt: "2026-01-15T00:00:00Z", projectId: p1.id, targetId: String(seed.f.previous.fileId), userId: seed.architect }),
  };
  seed.comments.reply = await insertHistoricalComment({ parentId: seed.comments.staff, projectId: p1.id, targetId: String(seed.f.image.fileId), userId: seed.owner });
  // Garantía con su documento vinculado.
  const [warranty] = await rows(`insert into public.project_warranties (project_id, product, model, code, start_date, service_date, end_date, created_by)
    values ($1, 'Calentador', 'X', 'C', '2026-01-01', '2026-06-01', '2027-01-01', $2) returning id::int`, [p1.id, seed.admin]);
  await rows("insert into public.project_warranty_documents (project_id, warranty_id, file_id, linked_by) values ($1, $2, $3, $4)", [p1.id, warranty.id, seed.f.warranty.fileId, seed.admin]);
});

after(async () => {
  if (!enabled) return;
  if (server) await new Promise((resolve) => server.close(resolve));
  await modules?.pool?.end().catch(() => {});
  await database?.drop();
  if (workDir) await rm(workDir, { force: true, recursive: true });
});

test("plan de solo lectura: clasificación con motivos, huella verificable y sin escrituras", { skip }, async () => {
  const preflight = await runCheck("preflight");
  assertAllOk(preflight, "preflight");
  seed.preflight = fingerprints(preflight);
  const prepared = await preparePlan();
  assert.deepEqual(fingerprints(await runCheck("preflight")), seed.preflight, "planificar no escribe");
  const decisions = Object.fromEntries(prepared.plan.entries.map((entry) => [entry.fileId, entry.decision === "convert" ? "convert" : entry.reasons.join(",")]));
  const expected = {
    [seed.f.document.fileId]: "convert",
    [seed.f.image.fileId]: "convert",
    [seed.f.ownerVersion.fileId]: "convert",
    [seed.f.warranty.fileId]: "convert",
    [seed.f.showcase.fileId]: "convert",
    [seed.f.transferred.fileId]: "convert",
    // El comentario sobre la versión anterior, sin asignar, dejaría de verlo el cliente: ambos motivos.
    [seed.f.previous.fileId]: "COMMENT_ACCESS_LOSS,COMMENT_ON_PREVIOUS_VERSION",
    [seed.f.noCurrent.fileId]: "NO_CURRENT_VERSION",
    [seed.f.publicUnfinished.fileId]: "ACCESS_LOSS",
    [seed.f.archived.fileId]: "PROJECT_ARCHIVED_DA1",
  };
  assert.deepEqual(decisions, expected);
  assert.deepEqual([prepared.plan.summary.convert, prepared.plan.summary.review], [6, 4]);
  assert.ok(prepared.plan.summary.expectedGains.AUTHOR_OWN_VERSION > 0, "el autor ve su versión anterior");
  assert.throws(() => readPlan(prepared.text, "0".repeat(64)), { code: "PLAN_SHA256_MISMATCH" });
  assert.throws(() => readPlan(prepared.text.replace(PLAN_KIND_TEXT, "otro"), sha256(prepared.text.replace(PLAN_KIND_TEXT, "otro"))), { code: "PLAN_FORMAT_INVALID" });
  seed.prepared = prepared;
});

const PLAN_KIND_TEXT = "arca-project-file-compatibility-plan";

test("aplicación: acceso equivalente para cada usuario del cliente, adjuntos, garantías y comentarios", { skip }, async () => {
  const { f, p1, p2, p3, p4 } = seed;
  // Antes: ambos usuarios del cliente ven los heredados; el ajeno, solo el escaparate.
  for (const actor of ["owner", "coOwner"]) assert.equal(await downloadStatus(p1.id, f.document.fileId, actor), 200);
  assert.equal(await downloadStatus(p2.id, f.showcase.fileId, "stranger"), 200);
  assert.equal((await fetch(`${base}/project-requests/${seed.request}/files/${f.transferred.fileId}/content`, { headers: seed.headers.coOwner })).status, 200, "draft: por la solicitud");

  const result = await applyPlan(seed.prepared);
  assert.deepEqual(result.summary, { converted: 6 });
  const postcheck = await runCheck("postcheck");
  assertAllOk(postcheck, "postcheck");
  assert.deepEqual(fingerprints(postcheck), seed.preflight, "versiones, objetos, vínculos, carpetas, procedencia y contenido de comentarios intactos");
  const verify = await verifyCompatibilityPlan(database.client, { plan: seed.prepared.plan, planSha256: seed.prepared.planSha256 });
  assert.deepEqual(verify.summary, { review_unchanged: 4, verified: 6 });

  // Después: el mismo acceso por HTTP, también para el segundo usuario del cliente.
  for (const actor of ["owner", "coOwner"]) {
    for (const file of [f.document, f.image, f.ownerVersion, f.warranty]) assert.equal(await downloadStatus(p1.id, file.fileId, actor), 200, `${actor} ${file.fileId}`);
  }
  assert.equal(await downloadStatus(p1.id, f.document.fileId, "stranger"), 404);
  assert.equal(await downloadStatus(p2.id, f.showcase.fileId, "stranger"), 200, "escaparate conservado");
  assert.equal(await downloadStatus(p3.id, f.publicUnfinished.fileId, "stranger"), 200, "en revisión: sigue con su política");
  const versionOf = async (fileId, actor) => (await fetch(`${base}/projects/${p1.id}/files/${fileId}/content?versionId=${f.ownerVersion.versionIds[0]}`, { headers: seed.headers[actor] })).status;
  assert.deepEqual([await versionOf(f.ownerVersion.fileId, "owner"), await versionOf(f.ownerVersion.fileId, "coOwner")], [200, 404], "el autor ve su versión; ganancia esperada");

  // Adjunto transferido: procedencia y fecha intactas; en draft por la solicitud y, al finalizar, por el proyecto.
  const [origin] = await rows("select f.origin_project_request_id::int, r.reviewed_at from public.files f join public.project_requests r on r.id = f.origin_project_request_id where f.id = $1", [f.transferred.fileId]);
  assert.deepEqual([origin.origin_project_request_id, origin.reviewed_at.toISOString()], [seed.request, "2026-03-01T10:00:00.000Z"]);
  for (const actor of ["owner", "coOwner"]) {
    assert.equal((await fetch(`${base}/project-requests/${seed.request}/files/${f.transferred.fileId}/content`, { headers: seed.headers[actor] })).status, 200, `draft ${actor}`);
    assert.equal(await downloadStatus(p4.id, f.transferred.fileId, actor), 404, "draft: el proyecto no existe para el cliente");
  }
  await rows("update public.projects set status = 'pending' where id = $1", [p4.id]);
  for (const actor of ["owner", "coOwner"]) assert.equal(await downloadStatus(p4.id, f.transferred.fileId, actor), 200, `tras finalizar ${actor}`);

  // Garantías: el documento llega a los dos usuarios del cliente.
  for (const actor of ["owner", "coOwner"]) {
    const warranties = (await (await fetch(`${base}/projects/${p1.id}/warranties`, { headers: seed.headers[actor] })).json()).warranties;
    assert.deepEqual(warranties[0].documents.map((document) => document.fileId), [f.warranty.fileId], actor);
  }

  // Comentarios: los históricos pasan a la vigente y siguen visibles para ambos; el del archivo en revisión, también.
  const commentRows = await rows("select id::int, file_id::int, file_version_id::int from public.project_comments where id = any($1) order by id", [[seed.comments.staff, seed.comments.point, seed.comments.reply, seed.comments.previous]]);
  assert.deepEqual(commentRows.map((row) => [row.id, row.file_version_id]), [
    [seed.comments.staff, f.image.versionIds[0]], [seed.comments.point, f.image.versionIds[0]], [seed.comments.previous, null], [seed.comments.reply, f.image.versionIds[0]],
  ].sort((a, b) => a[0] - b[0]));
  for (const actor of ["owner", "coOwner"]) {
    const listed = (await (await fetch(`${base}/projects/${p1.id}/comments?limit=100`, { headers: seed.headers[actor] })).json()).comments.map((comment) => comment.id);
    for (const id of Object.values(seed.comments)) assert.ok(listed.includes(id), `${actor} ${id}`);
  }
  const audit = await rows("select count(*)::int as total, min(user_agent) as agent from public.audit_logs where action = 'project_file.compatibility_converted'");
  assert.deepEqual([audit[0].total, audit[0].agent], [6, "maintenance:project-file-compatibility"]);
});

test("repetición, plan obsoleto, interrupción y concurrencia: idempotente y sin dobles conversiones", { skip }, async () => {
  const again = await applyPlan(seed.prepared);
  assert.deepEqual(again.summary, { already_applied: 6 }, "repetir el mismo plan no hace nada");

  // Nuevos heredados: uno cambia después del plan (obsoleto), otros se aplican por tandas y en paralelo.
  const fresh = await Promise.all([1, 2, 3, 4].map(() => insertLegacyFile({ projectId: seed.p1.id })));
  const prepared = await preparePlan();
  const freshIds = new Set(fresh.map((file) => file.fileId));
  assert.equal(prepared.plan.entries.filter((entry) => freshIds.has(entry.fileId) && entry.decision === "convert").length, 4);
  await insertHistoricalComment({ commentType: "general", projectId: seed.p1.id, targetId: null, userId: seed.architect });
  await rows("update public.file_versions set file_size = 11 where file_id = $1", [fresh[0].fileId]);

  const interrupted = await applyPlan(prepared, { maxFiles: 1 });
  assert.equal(Object.values(interrupted.summary).reduce((total, count) => total + count, 0), 1, "una sola entrada antes de la interrupción");
  const [first, second] = await Promise.all([applyPlan(prepared), applyPlan(prepared)]);
  const outcomes = [...first.results, ...second.results, ...interrupted.results].filter((result) => freshIds.has(result.fileId));
  assert.equal(outcomes.filter((result) => result.outcome === "converted").length, 3, "cada archivo se convierte una vez");
  assert.ok(outcomes.filter((result) => result.fileId === fresh[0].fileId).every((result) => result.outcome === "stale"), "el que cambió desde el plan");
  assert.ok(outcomes.every((result) => ["converted", "already_applied", "stale"].includes(result.outcome)), JSON.stringify(outcomes));
  const grants = await rows(`select file_id::int, count(*)::int as total from public.project_file_audience_grants
    where file_id = any($1) and audience = 'client_owner' and ended_at is null group by file_id`, [[...freshIds]]);
  assert.ok(grants.every((row) => row.total === 1));
  assert.equal(grants.length, 3);
  assertAllOk(await runCheck("postcheck"), "postcheck tras la concurrencia");
});

test("rollback: un fallo durante la conversión deja el archivo intacto y un reintento lo completa", { skip }, async () => {
  const target = await insertLegacyFile({ projectId: seed.p1.id, type: "image/png" });
  const comment = await insertHistoricalComment({ projectId: seed.p1.id, targetId: String(target.fileId), userId: seed.architect });
  const prepared = await preparePlan();
  await rows(`create function test_fail_compatibility() returns trigger language plpgsql as $$
    begin if new.action = 'project_file.compatibility_converted' and new.entity_id = ${target.fileId} then raise exception 'fallo simulado'; end if; return new; end $$`);
  await rows("create trigger test_fail_compatibility before insert on public.audit_logs for each row execute function test_fail_compatibility()");
  try {
    const failed = await applyPlan(prepared);
    assert.deepEqual(failed.results.find((result) => result.fileId === target.fileId), { code: "P0001", fileId: target.fileId, outcome: "error" });
  } finally {
    await rows("drop trigger test_fail_compatibility on public.audit_logs; drop function test_fail_compatibility()");
  }
  const [file] = await rows("select access_policy from public.files where id = $1", [target.fileId]);
  assert.equal(file.access_policy, null);
  assert.equal((await rows("select count(*)::int as total from public.project_file_audience_grants where file_id = $1", [target.fileId]))[0].total, 0);
  assert.equal((await rows("select file_version_id from public.project_comments where id = $1", [comment]))[0].file_version_id, null);
  const retry = await applyPlan(prepared);
  assert.equal(retry.results.find((result) => result.fileId === target.fileId).outcome, "converted");

  // Validaciones de la aplicación.
  const client = await toolClient();
  try {
    await assert.rejects(applyCompatibilityPlan(client, { operatorUserId: seed.admin, plan: prepared.plan, planSha256: prepared.planSha256, target: "otra@base" }), { code: "PLAN_TARGET_MISMATCH" });
    await assert.rejects(applyCompatibilityPlan(client, { operatorUserId: seed.owner, plan: prepared.plan, planSha256: prepared.planSha256, target: TARGET }), { code: "OPERATOR_NOT_ADMIN" });
  } finally {
    await client.end();
  }
});

test("comando: destino confirmado, plan e informe fuera del repositorio y sin datos sensibles", { skip }, async () => {
  const envFile = path.join(workDir, "compat.env");
  await writeFile(envFile, `DATABASE_URL=${database.databaseUrl}\n`, "utf8");
  const run = (args) => spawnSync(process.execPath, [path.join(BACKEND_ROOT, "scripts", "project-file-compatibility.mjs"), "--env-file", envFile, ...args], { cwd: BACKEND_ROOT, encoding: "utf8" });
  const described = run(["--describe-target"]);
  assert.equal(described.status, 0, described.stderr);
  const target = described.stdout.match(/--confirm-database (\S+)/)[1];
  const wrong = run(["--confirm-database", "otra@base", "--plan", "--out", path.join(workDir, "plan.json")]);
  assert.equal(wrong.status, 1);
  const inside = run(["--confirm-database", target, "--plan", "--out", path.join(BACKEND_ROOT, "plan.json")]);
  assert.equal(inside.status, 1, "el plan no puede quedar dentro del repositorio");

  await insertLegacyFile({ projectId: seed.p1.id });
  const planFile = path.join(workDir, "plan.json");
  const reportFile = path.join(workDir, "plan-report.json");
  const planned = run(["--confirm-database", target, "--plan", "--out", planFile, "--report", reportFile]);
  assert.equal(planned.status, 0, planned.stderr);
  const planSha256 = planned.stdout.match(/SHA-256: ([0-9a-f]{64})/)[1];
  assert.equal(sha256(await readFile(planFile)), planSha256);
  const applied = run(["--confirm-database", target, "--apply", "--plan-file", planFile, "--plan-sha256", planSha256, "--operator-user-id", String(seed.admin), "--report", path.join(workDir, "apply-report.json")]);
  assert.equal(applied.status, 0, applied.stdout + applied.stderr);
  const verified = run(["--confirm-database", target, "--verify", "--plan-file", planFile, "--plan-sha256", planSha256, "--report", path.join(workDir, "verify-report.json")]);
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
  const report = await readFile(reportFile, "utf8");
  for (const sensitive of ["Título privado", "privado.bin", "@compat.test", "Nombre", "Cliente Privado", "projects/"]) assert.equal(report.includes(sensitive), false, sensitive);
  assert.ok(JSON.parse(report).reviewList.every((entry) => entry.reasons.length > 0), "lista revisable con motivo");
});
