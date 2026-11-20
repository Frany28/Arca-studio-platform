import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { after, before, test } from "node:test";

import { createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

/*
 * Versiones y revisión de archivos de proyecto (Fase 1.2, B4) por HTTP contra PostgreSQL real.
 * Opcional y local:
 *   ARCA_FILE_VERSIONS_DB_TESTS=1
 *   ARCA_FILE_VERSIONS_TEST_DATABASE_URL=postgres://postgres@localhost:54329/postgres
 * Crea una base propia con todas las migraciones y la elimina al terminar; nunca lee .env. El
 * almacenamiento es un mapa en memoria. Cubre la activación apagada (comportamiento anterior), la
 * activación encendida (subida pendiente, reemplazo, restauración, aprobación, rechazo, historial y
 * descarga por versión), permisos, concurrencia, rollback, conservación y compensación.
 */

const enabled = process.env.ARCA_FILE_VERSIONS_DB_TESTS === "1" && process.env.ARCA_FILE_VERSIONS_TEST_DATABASE_URL;
const skip = !enabled && "Requiere PostgreSQL local, ARCA_FILE_VERSIONS_DB_TESTS=1 y ARCA_FILE_VERSIONS_TEST_DATABASE_URL.";

let database;
let server;
let base;
let modules;
let seed;
const storage = new Map();
const putKeys = [];
const deletedKeys = [];

const pdf = (label) => ({ bytes: Buffer.concat([Buffer.from(`%PDF-1.4\n${label}\n`), Buffer.alloc(512, 0x20)]), type: "application/pdf" });
const png = (label) => ({ bytes: Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from(label), Buffer.alloc(512, 1)]), type: "image/png" });

/**
 * Activa o desactiva la revisión de versiones para las peticiones siguientes.
 *
 * @param {boolean} value - Estado de la activación.
 * @returns {void}
 */
function setReview(value) {
  process.env.PROJECT_FILE_REVIEW_ENABLED = value ? "true" : "false";
}

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
 * Emite una sesión real y devuelve su cabecera Authorization.
 *
 * @param {number} userId - Usuario.
 * @returns {Promise<object>} Cabeceras.
 */
async function authAs(userId) {
  const session = await modules.issueUserSession(userId);
  return { Authorization: `Bearer ${session.token}` };
}

/**
 * Llama a la API con JSON y devuelve estado y cuerpo.
 *
 * @param {string} path - Ruta relativa a /api.
 * @param {object} [options] - Método, cabeceras y cuerpo.
 * @returns {Promise<{ status: number, body: object|null }>} Respuesta.
 */
async function api(path, { body, headers = {}, method = "GET" } = {}) {
  const response = await fetch(`${base}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
    method,
  });
  const text = await response.text();
  return { body: text ? JSON.parse(text) : null, status: response.status };
}

/**
 * Envía un cuerpo binario como lo hace uploadRawFile (subida o reemplazo).
 *
 * @param {string} path - Ruta relativa a /api.
 * @param {{ bytes: Buffer, type: string }} file - Contenido.
 * @param {string} name - Nombre del archivo.
 * @param {object} headers - Autenticación y cabeceras extra.
 * @returns {Promise<{ status: number, body: object|null }>} Respuesta.
 */
async function sendBinary(path, { bytes, type }, name, headers) {
  const response = await fetch(`${base}${path}`, {
    body: bytes,
    headers: { ...headers, "Content-Type": type, "X-File-Name": encodeURIComponent(name) },
    method: "POST",
  });
  const text = await response.text();
  return { body: text ? JSON.parse(text) : null, status: response.status };
}

/**
 * Descarga el contenido de un archivo de proyecto.
 *
 * @param {number} projectId - Proyecto.
 * @param {number} fileId - Archivo.
 * @param {object} headers - Autenticación.
 * @param {number} [versionId] - Versión pedida.
 * @returns {Promise<{ status: number, bytes: Buffer, type: string|null }>} Respuesta.
 */
async function download(projectId, fileId, headers, versionId) {
  const query = versionId ? `?versionId=${versionId}` : "";
  const response = await fetch(`${base}/projects/${projectId}/files/${fileId}/content${query}`, { headers });
  return { bytes: Buffer.from(await response.arrayBuffer()), status: response.status, type: response.headers.get("content-type") };
}

/**
 * Sustituye el almacenamiento por un mapa en memoria que registra escrituras y borrados.
 *
 * @param {object} objectStorage - Adaptador compartido.
 * @returns {void}
 */
function installMemoryStorage(objectStorage) {
  objectStorage.put = async ({ body, contentType, key }) => {
    const chunks = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    storage.set(key, { body: Buffer.concat(chunks), contentType });
    putKeys.push(key);
    return {};
  };
  objectStorage.delete = async (key) => {
    deletedKeys.push(key);
    storage.delete(key);
    return {};
  };
  objectStorage.get = async (key) => {
    const stored = storage.get(key);
    if (!stored) throw Object.assign(new Error("NoSuchKey"), { $metadata: { httpStatusCode: 404 }, name: "NoSuchKey" });
    return { Body: Readable.from([stored.body]), ContentLength: stored.body.length, ContentType: stored.contentType };
  };
}

/**
 * Crea un proyecto en curso (o en el estado indicado) asignado al arquitecto de prueba.
 *
 * @param {string} [status] - Estado del proyecto.
 * @returns {Promise<number>} Id del proyecto.
 */
async function createProject(status = "in_process") {
  const draft = status === "draft";
  const [project] = await rows(`insert into public.projects (client_id, created_by, assigned_architect_id, name, status, public_slug, start_date, project_type, location, has_plans)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id::int`, [
    seed.client, seed.admin, seed.architect, `Proyecto ${randomUUID()}`, status, `p-${randomUUID()}`,
    draft ? null : "2026-11-01", draft ? null : "residential", draft ? null : "Caracas", draft ? null : false,
  ]);
  return project.id;
}

/**
 * Comprueba que el almacenamiento solo borró objetos sin versión registrada.
 *
 * @returns {Promise<void>}
 */
async function assertNoRecordedObjectDeleted() {
  if (!deletedKeys.length) return;
  const recorded = await rows("select file_name from public.file_versions where file_name = any($1::text[])", [deletedKeys]);
  assert.deepEqual(recorded, [], "ningún objeto registrado se borró");
}

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({ recordMigrations: true, baseUrl: process.env.ARCA_FILE_VERSIONS_TEST_DATABASE_URL, prefix: "arca_file_versions" });
  Object.assign(process.env, {
    AUTH_TOKEN_SECRET: "file-versions-test-secret-0123456789abcdef0123456789abcdef",
    DATABASE_POOL_MAX: "8",
    DATABASE_URL: database.databaseUrl,
    NODE_ENV: "test",
    PROJECT_FILE_REVIEW_ENABLED: "false",
    SUPABASE_STORAGE_BUCKET: "test-bucket",
    SUPABASE_STORAGE_S3_ACCESS_KEY_ID: "test-access-key",
    SUPABASE_STORAGE_S3_ENDPOINT: "https://storage.test.local/s3",
    SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY: "test-secret-key",
    UPLOAD_RATE_LIMIT_MAX: "1000",
  });
  modules = {
    ...(await import("../src/config/db.js")),
    ...(await import("../src/services/objectStorage.js")),
    ...(await import("../src/services/sessionService.js")),
    app: (await import("../src/app.js")).default,
  };
  installMemoryStorage(modules.objectStorage);

  const roleId = async (code) => Number((await rows("insert into public.roles (code, name) values ($1, $1) returning id", [code]))[0].id);
  const roles = { admin: await roleId("admin"), architect: await roleId("architect"), client: await roleId("client") };
  for (const code of ["projects.read", "projects.files.upload", "projects.files.delete"]) {
    const [permission] = await rows("insert into public.permissions (code, name, description, module) values ($1, $1, null, 'projects') returning id", [code]);
    for (const roleIdValue of Object.values(roles)) {
      await rows("insert into public.role_permissions (role_id, permission_id, is_active) values ($1, $2, true)", [roleIdValue, permission.id]);
    }
  }
  const insertClient = async (email) => Number((await rows("insert into public.clients (name, email) values ('Cliente', $1) returning id", [email]))[0].id);
  const insertUser = async (role, email, clientId = null) => Number((await rows(`insert into public.users (role_id, client_id, email, first_name, last_name, password_hash)
    values ($1, $2, $3, 'Prueba', 'Versiones', '!disabled!') returning id`, [roles[role], clientId, email]))[0].id);
  const client = await insertClient("cliente@versiones.test");
  const strangerClient = await insertClient("ajeno@versiones.test");
  seed = {
    admin: await insertUser("admin", "admin@versiones.test"),
    architect: await insertUser("architect", "arquitecto@versiones.test"),
    client,
    otherArchitect: await insertUser("architect", "otro@versiones.test"),
    owner: await insertUser("client", "propietario@versiones.test", client),
    stranger: await insertUser("client", "extrano@versiones.test", strangerClient),
  };
  seed.headers = {
    admin: await authAs(seed.admin),
    architect: await authAs(seed.architect),
    otherArchitect: await authAs(seed.otherArchitect),
    owner: await authAs(seed.owner),
    stranger: await authAs(seed.stranger),
  };
  server = modules.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (!enabled) return;
  if (server) await new Promise((resolve) => server.close(resolve));
  await modules?.pool?.end().catch(() => {});
  await database?.drop();
});

test("activación apagada: subida, descarga y rutas se comportan como antes", { skip }, async () => {
  setReview(false);
  const { headers } = seed;
  const projectId = await createProject();
  const content = pdf("legacy");
  const uploaded = await sendBinary(`/projects/${projectId}/files`, content, "memoria.pdf", headers.architect);
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  assert.equal("reviewStatus" in uploaded.body.file, false, "la respuesta no cambia");
  const fileId = uploaded.body.file.id;
  const [stored] = await rows(`select f.access_policy, f.current_version, v.is_current, v.review_status, v.content_type
    from public.files f join public.file_versions v on v.file_id = f.id where f.id = $1`, [fileId]);
  assert.deepEqual(stored, { access_policy: null, content_type: null, current_version: 1, is_current: true, review_status: null });

  // Las rutas nuevas no existen: 404 de ruta, antes de autenticar.
  for (const [path, method] of [[`/projects/${projectId}/files/${fileId}/versions`, "GET"], [`/projects/${projectId}/files/${fileId}/versions/1/approve`, "POST"]]) {
    for (const auth of [headers.admin, {}]) {
      const response = await api(path, { headers: auth, method });
      assert.deepEqual([response.status, response.body.code], [404, "API_ROUTE_NOT_FOUND"], `${method} ${path}`);
    }
  }
  assert.equal((await sendBinary(`/projects/${projectId}/files/${fileId}/versions`, pdf("x"), "x.pdf", { ...headers.admin, "X-Change-Note": "x" })).status, 404);
  // La descarga ignora versionId, como siempre, y el cliente propietario recibe la vigente.
  const legacyDownload = await download(projectId, fileId, headers.owner, 999999);
  assert.equal(legacyDownload.status, 200);
  assert.ok(legacyDownload.bytes.equals(content.bytes));
  assert.equal((await api(`/projects/${projectId}/files/${fileId}`, { headers: headers.architect, method: "DELETE" })).status, 409);
});

test("activación encendida: la subida nace pendiente, solo el administrador aprueba y aprobar no comparte", { skip }, async () => {
  setReview(true);
  const { headers } = seed;
  const projectId = await createProject();
  const content = pdf("v1");
  const uploaded = await sendBinary(`/projects/${projectId}/files`, content, "plano.pdf", headers.architect);
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  assert.equal(uploaded.body.file.reviewStatus, "pending");
  const fileId = uploaded.body.file.id;
  const versionId = uploaded.body.file.versionId;
  const [stored] = await rows(`select f.access_policy, f.current_version, v.is_current, v.review_status::text, v.content_type
    from public.files f join public.file_versions v on v.file_id = f.id where f.id = $1`, [fileId]);
  assert.deepEqual(stored, { access_policy: 1, content_type: "application/pdf", current_version: null, is_current: false, review_status: "pending" });

  // Pendiente: la ven el equipo y el autor; el cliente propietario no.
  assert.equal((await download(projectId, fileId, headers.owner)).status, 404);
  assert.equal((await download(projectId, fileId, headers.owner, versionId)).status, 404);
  assert.equal((await download(projectId, fileId, headers.architect)).status, 404, "sin versión vigente");
  assert.equal((await download(projectId, fileId, headers.architect, versionId)).status, 200);
  assert.equal((await download(projectId, fileId, headers.admin, versionId)).status, 200);
  assert.equal((await download(projectId, fileId, headers.otherArchitect, versionId)).status, 404);
  assert.equal((await api(`/projects/${projectId}/files/${fileId}/versions`, { headers: headers.owner })).status, 404);
  const history = await api(`/projects/${projectId}/files/${fileId}/versions`, { headers: headers.architect });
  assert.equal(history.status, 200, JSON.stringify(history.body));
  assert.deepEqual(history.body.versions.map((version) => [version.versionNumber, version.review.status]), [[1, "pending"]]);
  assert.equal(history.body.currentVersionId, null);

  // Revisar: solo el administrador.
  const approvePath = `/projects/${projectId}/files/${fileId}/versions/${versionId}/approve`;
  assert.equal((await api(approvePath, { method: "POST" })).status, 401);
  assert.equal((await api(approvePath, { headers: headers.architect, method: "POST" })).status, 403);
  assert.equal((await api(approvePath, { headers: headers.owner, method: "POST" })).status, 403);
  const rejectPath = `/projects/${projectId}/files/${fileId}/versions/${versionId}/reject`;
  assert.equal((await api(rejectPath, { body: {}, headers: headers.admin, method: "POST" })).status, 400);
  const blank = await api(rejectPath, { body: { reason: "   " }, headers: headers.admin, method: "POST" });
  assert.deepEqual([blank.status, Object.keys(blank.body.fields)], [400, ["body.reason"]]);
  assert.equal((await api(rejectPath, { body: { reason: "x".repeat(501) }, headers: headers.admin, method: "POST" })).status, 400);

  const approved = await api(approvePath, { headers: headers.admin, method: "POST" });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.deepEqual([approved.body.currentVersionId, approved.body.sharedWithClient, approved.body.version.review.status], [versionId, false, "approved"]);
  const [afterApproval] = await rows(`select f.current_version, v.is_current, v.reviewed_by::int, v.reviewed_at is not null as reviewed
    from public.files f join public.file_versions v on v.file_id = f.id where f.id = $1`, [fileId]);
  assert.deepEqual(afterApproval, { current_version: 1, is_current: true, reviewed: true, reviewed_by: seed.admin });
  assert.equal((await rows("select count(*)::int as total from public.project_file_audience_grants where file_id = $1", [fileId]))[0].total, 0, "aprobar no crea autorizaciones");
  assert.equal((await download(projectId, fileId, headers.owner)).status, 404, "aprobar no comparte con el cliente");
  const current = await download(projectId, fileId, headers.architect);
  assert.equal(current.status, 200);
  assert.ok(current.bytes.equals(content.bytes));
  const [audit] = await rows("select user_id::int, new_values from public.audit_logs where action = 'project_file.version_approved' and entity_id = $1", [versionId]);
  assert.equal(audit.user_id, seed.admin);
  assert.equal(audit.new_values.sharedWithClient, false);
  const again = await api(approvePath, { headers: headers.admin, method: "POST" });
  assert.deepEqual([again.status, again.body.code], [409, "FILE_VERSION_NOT_PENDING"]);
});

test("reemplazar, rechazar y restaurar conservan todas las versiones y reutilizan el objeto", { skip }, async () => {
  setReview(true);
  const { headers } = seed;
  const projectId = await createProject();
  const original = pdf("original");
  const uploaded = await sendBinary(`/projects/${projectId}/files`, original, "fachada.pdf", headers.architect);
  const fileId = uploaded.body.file.id;
  const v1 = uploaded.body.file.versionId;
  await api(`/projects/${projectId}/files/${fileId}/versions/${v1}/approve`, { headers: headers.admin, method: "POST" });
  const versionsPath = `/projects/${projectId}/files/${fileId}/versions`;

  const missingNote = await sendBinary(versionsPath, png("sin motivo"), "fachada.png", headers.architect);
  assert.deepEqual([missingNote.status, Object.keys(missingNote.body.fields ?? {})], [400, ["headers.x-change-note"]]);
  assert.equal((await sendBinary(versionsPath, png("ajeno"), "fachada.png", { ...headers.owner, "X-Change-Note": "x" })).status, 404, "el cliente no reemplaza archivos ajenos");
  assert.equal((await sendBinary(versionsPath, png("extraño"), "fachada.png", { ...headers.stranger, "X-Change-Note": "x" })).status, 404);

  const replacement = png("segunda");
  const replaced = await sendBinary(versionsPath, replacement, "fachada.png", { ...headers.architect, "X-Change-Note": encodeURIComponent("Fachada con iluminación") });
  assert.equal(replaced.status, 201, JSON.stringify(replaced.body));
  const v2 = replaced.body.version.id;
  assert.deepEqual([replaced.body.version.versionNumber, replaced.body.version.review.status, replaced.body.version.changeNote, replaced.body.version.contentType],
    [2, "pending", "Fachada con iluminación", "image/png"]);
  const busy = await sendBinary(versionsPath, png("tercera"), "fachada.png", { ...headers.architect, "X-Change-Note": "Otra" });
  assert.deepEqual([busy.status, busy.body.code], [409, "FILE_VERSION_PENDING_REVIEW"]);

  // Cada versión se sirve con su propio formato; la vigente sigue siendo la v1.
  const pendingContent = await download(projectId, fileId, headers.architect, v2);
  assert.deepEqual([pendingContent.status, pendingContent.type], [200, "image/png"]);
  assert.ok(pendingContent.bytes.equals(replacement.bytes));
  assert.ok((await download(projectId, fileId, headers.architect)).bytes.equals(original.bytes));

  const rejected = await api(`${versionsPath}/${v2}/reject`, { body: { reason: "  La iluminación no es la acordada " }, headers: headers.admin, method: "POST" });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assert.deepEqual([rejected.body.currentVersionId, rejected.body.version.review.reason], [v1, "La iluminación no es la acordada"]);
  const notApproved = await api(`${versionsPath}/${v2}/restore`, { body: { changeNote: "Volver a la v2" }, headers: headers.architect, method: "POST" });
  assert.deepEqual([notApproved.status, notApproved.body.code], [409, "FILE_VERSION_NOT_APPROVED"]);
  assert.equal((await api(`${versionsPath}/${v1}/restore`, { body: { changeNote: " " }, headers: headers.architect, method: "POST" })).status, 400);

  const putsBefore = putKeys.length;
  const restored = await api(`${versionsPath}/${v1}/restore`, { body: { changeNote: "Volver al diseño original" }, headers: headers.architect, method: "POST" });
  assert.equal(restored.status, 201, JSON.stringify(restored.body));
  const v3 = restored.body.version.id;
  assert.deepEqual([restored.body.version.versionNumber, restored.body.version.restoredFromVersionId, restored.body.version.review.status], [3, v1, "pending"]);
  assert.equal(putKeys.length, putsBefore, "restaurar no transfiere ni copia objetos");
  const keys = await rows("select id::int, file_name from public.file_versions where file_id = $1 order by version_number", [fileId]);
  assert.equal(keys[2].file_name, keys[0].file_name, "la v3 reutiliza la clave de la v1");
  assert.equal((await api(`${versionsPath}/${v1}/restore`, { body: { changeNote: "Otra" }, headers: headers.architect, method: "POST" })).status, 409);

  assert.equal((await api(`${versionsPath}/${v3}/approve`, { headers: headers.admin, method: "POST" })).status, 200);
  const currentAfterRestore = await download(projectId, fileId, headers.admin);
  assert.ok(currentAfterRestore.bytes.equals(original.bytes), "la versión restaurada sirve el objeto de la v1");

  // Historial completo para el equipo, con cursor; nada se retiró.
  const firstPage = await api(`${versionsPath}?limit=2`, { headers: headers.admin });
  assert.deepEqual(firstPage.body.versions.map((version) => [version.versionNumber, version.review.status, version.isCurrent]), [[3, "approved", true], [2, "rejected", false]]);
  assert.equal(firstPage.body.versions[1].review.reason, "La iluminación no es la acordada");
  const secondPage = await api(`${versionsPath}?limit=2&cursor=${firstPage.body.nextCursor}`, { headers: headers.admin });
  assert.deepEqual([secondPage.body.versions.map((version) => version.versionNumber), secondPage.body.nextCursor], [[1], null]);
  assert.equal((await rows("select count(*)::int as total from public.file_versions where file_id = $1 and deleted_at is null", [fileId]))[0].total, 3);
  for (const key of new Set(keys.map((row) => row.file_name))) assert.ok(storage.has(key), "cada objeto se conserva");
  await assertNoRecordedObjectDeleted();
});

test("el cliente propietario reemplaza y ve solo sus propias versiones; los heredados no admiten versiones", { skip }, async () => {
  const { headers } = seed;
  setReview(false);
  const projectId = await createProject();
  const legacy = await sendBinary(`/projects/${projectId}/files`, pdf("heredado"), "heredado.pdf", headers.architect);
  setReview(true);
  const legacyReplace = await sendBinary(`/projects/${projectId}/files/${legacy.body.file.id}/versions`, pdf("x"), "heredado.pdf", { ...headers.admin, "X-Change-Note": "x" });
  assert.deepEqual([legacyReplace.status, legacyReplace.body.code], [409, "FILE_VERSIONING_UNAVAILABLE"]);
  // Heredado con la activación encendida: la regla de siempre (el propietario recibe la vigente).
  assert.equal((await download(projectId, legacy.body.file.id, headers.owner)).status, 200);

  const own = await sendBinary(`/projects/${projectId}/files`, png("cliente"), "referencia.png", headers.owner);
  assert.equal(own.status, 201, JSON.stringify(own.body));
  const ownId = own.body.file.id;
  assert.equal((await download(projectId, ownId, headers.owner, own.body.file.versionId)).status, 200, "el autor ve su versión pendiente");
  const ownReplace = await sendBinary(`/projects/${projectId}/files/${ownId}/versions`, png("cliente 2"), "referencia.png", { ...headers.owner, "X-Change-Note": "x" });
  assert.deepEqual([ownReplace.status, ownReplace.body.code], [409, "FILE_VERSION_PENDING_REVIEW"]);
  await api(`/projects/${projectId}/files/${ownId}/versions/${own.body.file.versionId}/approve`, { headers: headers.admin, method: "POST" });
  const replaced = await sendBinary(`/projects/${projectId}/files/${ownId}/versions`, png("cliente 2"), "referencia.png", { ...headers.owner, "X-Change-Note": "Nueva foto" });
  assert.equal(replaced.status, 201, JSON.stringify(replaced.body));
  const ownHistory = await api(`/projects/${projectId}/files/${ownId}/versions`, { headers: headers.owner });
  assert.deepEqual(ownHistory.body.versions.map((version) => version.versionNumber), [2, 1]);
  assert.equal((await api(`/projects/${projectId}/files/${ownId}/versions`, { headers: headers.stranger })).status, 404);
});

test("drafts y proyectos de solo lectura conservan sus restricciones", { skip }, async () => {
  setReview(true);
  const { headers } = seed;
  const draftId = await createProject("draft");
  const draftUpload = await sendBinary(`/projects/${draftId}/files`, pdf("draft"), "draft.pdf", headers.admin);
  assert.equal(draftUpload.status, 201, JSON.stringify(draftUpload.body));
  assert.equal(draftUpload.body.file.reviewStatus, "pending", "también la subida del administrador pasa por revisión");
  const draftFile = draftUpload.body.file.id;
  assert.equal((await api(`/projects/${draftId}/files/${draftFile}/versions`, { headers: headers.architect })).status, 404, "un draft no existe para el arquitecto");
  assert.equal((await api(`/projects/${draftId}/files/${draftFile}/versions/${draftUpload.body.file.versionId}/approve`, { headers: headers.admin, method: "POST" })).status, 200);

  const projectId = await createProject();
  const uploaded = await sendBinary(`/projects/${projectId}/files`, pdf("archivado"), "archivado.pdf", headers.architect);
  await rows("update public.projects set status = 'archived', archived_from_status = 'in_process' where id = $1", [projectId]);
  const archivedReplace = await sendBinary(`/projects/${projectId}/files/${uploaded.body.file.id}/versions`, pdf("x"), "x.pdf", { ...headers.architect, "X-Change-Note": "x" });
  assert.deepEqual([archivedReplace.status, archivedReplace.body.code], [409, "PROJECT_ARCHIVED"]);
  const archivedApprove = await api(`/projects/${projectId}/files/${uploaded.body.file.id}/versions/${uploaded.body.file.versionId}/approve`, { headers: headers.admin, method: "POST" });
  assert.deepEqual([archivedApprove.status, archivedApprove.body.code], [409, "PROJECT_ARCHIVED"]);
});

test("concurrencia: un solo reemplazo y una sola aprobación ganan; el objeto perdedor se compensa", { skip }, async () => {
  setReview(true);
  const { headers } = seed;
  const projectId = await createProject();
  const uploaded = await sendBinary(`/projects/${projectId}/files`, pdf("base"), "base.pdf", headers.architect);
  const fileId = uploaded.body.file.id;
  await api(`/projects/${projectId}/files/${fileId}/versions/${uploaded.body.file.versionId}/approve`, { headers: headers.admin, method: "POST" });
  const deletedBefore = deletedKeys.length;
  // Barrera: ninguna transferencia termina hasta que las tres empezaron, así las tres superan la
  // comprobación previa, transfieren su objeto y compiten al registrar con el archivo bloqueado.
  const memoryPut = modules.objectStorage.put;
  let started = 0;
  let release;
  const allStarted = new Promise((resolve) => { release = resolve; });
  modules.objectStorage.put = async (options) => {
    started += 1;
    if (started === 3) release();
    await allStarted;
    return memoryPut(options);
  };
  let results;
  try {
    results = await Promise.all([1, 2, 3].map((index) => sendBinary(
      `/projects/${projectId}/files/${fileId}/versions`, pdf(`carrera ${index}`), "base.pdf", { ...headers.architect, "X-Change-Note": `Carrera ${index}` },
    )));
  } finally {
    modules.objectStorage.put = memoryPut;
  }
  assert.equal(started, 3, "las tres cargas transfirieron su objeto");
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409, 409], JSON.stringify(results.map((result) => result.body)));
  const pending = await rows("select id::int, file_name from public.file_versions where file_id = $1 and review_status = 'pending'", [fileId]);
  assert.equal(pending.length, 1, "una sola versión pendiente");
  assert.ok(storage.has(pending[0].file_name), "el objeto ganador se conserva");
  assert.equal(deletedKeys.length - deletedBefore, 2, "los dos objetos sin registro se compensan");
  await assertNoRecordedObjectDeleted();

  const approvals = await Promise.all([1, 2].map(() => api(`/projects/${projectId}/files/${fileId}/versions/${pending[0].id}/approve`, { headers: headers.admin, method: "POST" })));
  assert.deepEqual(approvals.map((approval) => approval.status).sort(), [200, 409]);
  const current = await rows("select count(*)::int as total from public.file_versions where file_id = $1 and is_current", [fileId]);
  assert.equal(current[0].total, 1);
});

test("rollback: un fallo al auditar o al registrar revierte la operación y compensa el objeto", { skip }, async () => {
  setReview(true);
  const { headers } = seed;
  const projectId = await createProject();
  const uploaded = await sendBinary(`/projects/${projectId}/files`, pdf("rollback"), "rollback.pdf", headers.architect);
  const fileId = uploaded.body.file.id;
  const versionId = uploaded.body.file.versionId;
  await database.client.query(`create function public.test_fail_version_audit() returns trigger language plpgsql as $$
    begin
      if new.action in ('project_file.version_approved', 'project_file.version_submitted') then
        raise exception 'fallo simulado de auditoría' using errcode = 'P0001';
      end if;
      return new;
    end $$`);
  await database.client.query("create trigger test_fail_version_audit before insert on public.audit_logs for each row execute function public.test_fail_version_audit()");
  try {
    const approval = await api(`/projects/${projectId}/files/${fileId}/versions/${versionId}/approve`, { headers: headers.admin, method: "POST" });
    assert.equal(approval.status, 500);
    const [state] = await rows(`select f.current_version, v.review_status::text, v.is_current, v.reviewed_at
      from public.files f join public.file_versions v on v.file_id = f.id where f.id = $1`, [fileId]);
    assert.deepEqual(state, { current_version: null, is_current: false, review_status: "pending", reviewed_at: null });
  } finally {
    await database.client.query("drop trigger test_fail_version_audit on public.audit_logs");
  }
  await api(`/projects/${projectId}/files/${fileId}/versions/${versionId}/approve`, { headers: headers.admin, method: "POST" });

  await database.client.query("create trigger test_fail_version_audit before insert on public.audit_logs for each row execute function public.test_fail_version_audit()");
  try {
    const putsBefore = putKeys.length;
    const replace = await sendBinary(`/projects/${projectId}/files/${fileId}/versions`, pdf("fallo"), "rollback.pdf", { ...headers.architect, "X-Change-Note": "Fallo" });
    assert.equal(replace.status, 500);
    const failedKey = putKeys[putsBefore];
    assert.ok(failedKey, "el objeto llegó a transferirse");
    assert.ok(deletedKeys.includes(failedKey), "el objeto sin registro se compensa");
    assert.equal((await rows("select count(*)::int as total from public.file_versions where file_id = $1", [fileId]))[0].total, 1);
  } finally {
    await database.client.query("drop trigger test_fail_version_audit on public.audit_logs");
    await database.client.query("drop function public.test_fail_version_audit()");
  }
  await assertNoRecordedObjectDeleted();
});
