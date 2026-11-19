import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { after, before, test } from "node:test";

import { createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

/*
 * Audiencias de archivos de proyecto (Fase 1.2, B5) por HTTP contra PostgreSQL real. Opcional y local:
 *   ARCA_FILE_AUDIENCES_DB_TESTS=1
 *   ARCA_FILE_AUDIENCES_TEST_DATABASE_URL=postgres://postgres@localhost:54329/postgres
 * Base propia con todas las migraciones, eliminada al terminar; nunca lee .env; almacenamiento en
 * memoria que cuenta las lecturas. Cubre la matriz de actores, proyectos, audiencias y versiones
 * en listados, detalle, galerías, documentos recientes, miniaturas, historial, descargas y rutas de
 * solicitudes, además de revocación, ETag y 304, paginación, concurrencia y conservación.
 */

const enabled = process.env.ARCA_FILE_AUDIENCES_DB_TESTS === "1" && process.env.ARCA_FILE_AUDIENCES_TEST_DATABASE_URL;
const skip = !enabled && "Requiere PostgreSQL local, ARCA_FILE_AUDIENCES_DB_TESTS=1 y ARCA_FILE_AUDIENCES_TEST_DATABASE_URL.";

let database;
let server;
let base;
let modules;
let seed;
const storage = new Map();
const storageReads = [];
const deletedKeys = [];

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
 * Llama a la API con JSON y devuelve estado, cuerpo y cabeceras.
 *
 * @param {string} path - Ruta relativa a /api.
 * @param {object} [options] - Método, cabeceras y cuerpo.
 * @returns {Promise<{ status: number, body: object|null, headers: Headers }>} Respuesta.
 */
async function api(path, { body, headers = {}, method = "GET" } = {}) {
  const response = await fetch(`${base}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
    method,
  });
  const text = await response.text();
  return { body: text ? JSON.parse(text) : null, headers: response.headers, status: response.status };
}

/**
 * Descarga un archivo de proyecto, opcionalmente con versión e If-None-Match.
 *
 * @param {number} projectId - Proyecto.
 * @param {number} fileId - Archivo.
 * @param {object} headers - Autenticación y cabeceras extra.
 * @param {number} [versionId] - Versión pedida.
 * @returns {Promise<{ status: number, text: string, etag: string|null, cacheControl: string|null, disposition: string|null }>} Respuesta.
 */
async function download(projectId, fileId, headers, versionId) {
  const query = versionId ? `?versionId=${versionId}` : "";
  const response = await fetch(`${base}/projects/${projectId}/files/${fileId}/content${query}`, { headers });
  return {
    cacheControl: response.headers.get("cache-control"),
    disposition: response.headers.get("content-disposition"),
    etag: response.headers.get("etag"),
    status: response.status,
    text: Buffer.from(await response.arrayBuffer()).toString("utf8"),
  };
}

/**
 * Sustituye el almacenamiento por un mapa en memoria que registra lecturas y borrados.
 *
 * @param {object} objectStorage - Adaptador compartido.
 * @returns {void}
 */
function installMemoryStorage(objectStorage) {
  objectStorage.put = async ({ body, contentType, key }) => {
    const chunks = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    storage.set(key, { body: Buffer.concat(chunks), contentType });
    return {};
  };
  objectStorage.delete = async (key) => {
    deletedKeys.push(key);
    storage.delete(key);
    return {};
  };
  objectStorage.get = async (key) => {
    storageReads.push(key);
    const stored = storage.get(key);
    if (!stored) throw Object.assign(new Error("NoSuchKey"), { $metadata: { httpStatusCode: 404 }, name: "NoSuchKey" });
    return { Body: Readable.from([stored.body]), ContentLength: stored.body.length, ContentType: stored.contentType };
  };
}

/**
 * Crea un proyecto del cliente de prueba asignado al arquitecto de prueba.
 *
 * @param {object} [options] - Estado y publicación.
 * @param {string} [options.status] - Estado del proyecto.
 * @param {boolean} [options.isPublic] - Proyecto público.
 * @returns {Promise<number>} Id del proyecto.
 */
async function createProject({ isPublic = false, status = "in_process" } = {}) {
  const [project] = await rows(`insert into public.projects (client_id, created_by, assigned_architect_id, name, status, public_slug, start_date, project_type, location, has_plans, is_public)
    values ($1, $2, $3, $4, $5, $6, '2026-11-01', 'residential', 'Caracas', false, $7) returning id::int`, [
    seed.client, seed.admin, seed.architect, `Proyecto ${randomUUID()}`, status, `p-${randomUUID()}`, isPublic,
  ]);
  return project.id;
}

/**
 * Registra un archivo con sus versiones directamente en PostgreSQL y en el almacenamiento.
 * Con `policy` 1 la vigente es la aprobada de mayor número; sin política, la última (heredado).
 *
 * @param {object} options - Archivo.
 * @param {number} options.projectId - Proyecto.
 * @param {number} [options.uploadedBy] - Autor.
 * @param {number|null} [options.policy] - 1 o null (heredado).
 * @param {string} [options.type] - Tipo MIME del archivo.
 * @param {Array<{ status?: string|null, contentType?: string }>} options.versions - Versiones en orden.
 * @param {number|null} [options.originRequestId] - Solicitud de origen.
 * @returns {Promise<{ fileId: number, versionIds: number[], label: string }>} Identificadores.
 */
async function insertFile({ originRequestId = null, policy = 1, projectId, type = "application/pdf", uploadedBy = seed.architect, versions }) {
  const label = `archivo-${randomUUID().slice(0, 8)}`;
  const approvedNumbers = versions.map((version, index) => (policy === null || version.status === "approved" ? index + 1 : 0)).filter(Boolean);
  const currentNumber = approvedNumbers.length ? Math.max(...approvedNumbers) : null;
  const [file] = await rows(`insert into public.files (project_id, uploaded_by, title, file_type, file_category, current_version, access_policy, origin_project_request_id)
    values ($1, $2, $3, $4, $5, $6, $7, $8) returning id::int`,
  [projectId, uploadedBy, `${label}.bin`, type, type.startsWith("image/") ? "image" : "document", currentNumber, policy, originRequestId]);
  const versionIds = [];
  for (const [index, version] of versions.entries()) {
    const number = index + 1;
    const key = `projects/${projectId}/files/${file.id}/v${number}/${label}`;
    storage.set(key, { body: Buffer.from(`${label}-v${number}`), contentType: version.contentType ?? type });
    const status = policy === null ? null : version.status;
    const [stored] = await rows(`insert into public.file_versions (file_id, uploaded_by, version_number, file_name, original_name, file_url, file_extension, file_size,
        is_current, content_type, review_status, reviewed_by, reviewed_at, review_reason)
      values ($1, $2, $3, $4, $5, 's3://ficticio', 'bin', 10, $6, $7, $8::public.file_version_review_status, $9, $10, $11) returning id::int`, [
      file.id, uploadedBy, number, key, `${label}.bin`, number === currentNumber, policy === null ? null : version.contentType ?? type,
      status, status === "approved" || status === "rejected" ? seed.admin : null, status === "approved" || status === "rejected" ? new Date() : null,
      status === "rejected" ? "Motivo de prueba" : null,
    ]);
    versionIds.push(stored.id);
  }
  return { fileId: file.id, label, versionIds };
}

/**
 * Comparte o autoriza una versión como administrador y comprueba el resultado.
 *
 * @param {number} projectId - Proyecto.
 * @param {number} fileId - Archivo.
 * @param {"client"|"showcase"} audience - Audiencia.
 * @param {number} versionId - Versión.
 * @returns {Promise<object>} Estado de audiencias.
 */
async function grant(projectId, fileId, audience, versionId) {
  const response = await api(`/projects/${projectId}/files/${fileId}/audiences/${audience}`, { body: { versionId }, headers: seed.headers.admin, method: "PUT" });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body;
}

/**
 * Devuelve los archivos visibles del detalle de un proyecto como `id:vVersión`.
 *
 * @param {number} projectId - Proyecto.
 * @param {object} headers - Autenticación.
 * @returns {Promise<{ status: number, files: string[], project: object|null }>} Archivos visibles.
 */
async function detailFiles(projectId, headers) {
  const response = await api(`/projects/${projectId}?filesLimit=100`, { headers });
  const files = (response.body?.project?.files ?? []).map((file) => `${file.id}:${file.currentVersionId}`).sort();
  return { files, project: response.body?.project ?? null, status: response.status };
}

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({ baseUrl: process.env.ARCA_FILE_AUDIENCES_TEST_DATABASE_URL, prefix: "arca_file_audiences" });
  Object.assign(process.env, {
    AUTH_TOKEN_SECRET: "file-audiences-test-secret-0123456789abcdef0123456789abcdef",
    DATABASE_POOL_MAX: "8",
    DATABASE_URL: database.databaseUrl,
    NODE_ENV: "test",
    PROJECT_FILE_REVIEW_ENABLED: "true",
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
  for (const code of ["projects.read", "projects.files.upload"]) {
    const [permission] = await rows("insert into public.permissions (code, name, description, module) values ($1, $1, null, 'projects') returning id", [code]);
    for (const id of Object.values(roles)) await rows("insert into public.role_permissions (role_id, permission_id, is_active) values ($1, $2, true)", [id, permission.id]);
  }
  const insertClient = async (email) => Number((await rows("insert into public.clients (name, email) values ('Cliente', $1) returning id", [email]))[0].id);
  const insertUser = async (role, email, clientId = null) => Number((await rows(`insert into public.users (role_id, client_id, email, first_name, last_name, password_hash)
    values ($1, $2, $3, 'Prueba', 'Audiencias', '!disabled!') returning id`, [roles[role], clientId, email]))[0].id);
  const client = await insertClient("cliente@audiencias.test");
  const strangerClient = await insertClient("ajeno@audiencias.test");
  seed = {
    admin: await insertUser("admin", "admin@audiencias.test"),
    architect: await insertUser("architect", "arquitecto@audiencias.test"),
    client,
    otherArchitect: await insertUser("architect", "otro@audiencias.test"),
    owner: await insertUser("client", "propietario@audiencias.test", client),
    stranger: await insertUser("client", "extrano@audiencias.test", strangerClient),
  };
  const session = async (userId) => ({ Authorization: `Bearer ${(await modules.issueUserSession(userId)).token}` });
  seed.headers = {
    admin: await session(seed.admin),
    architect: await session(seed.architect),
    otherArchitect: await session(seed.otherArchitect),
    owner: await session(seed.owner),
    stranger: await session(seed.stranger),
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

test("matriz: detalle, galería, documentos recientes, historial y descarga según actor, audiencia y versión", { skip }, async () => {
  setReview(true);
  const { headers } = seed;
  const projectId = await createProject();
  const shared = await insertFile({ projectId, versions: [{ status: "approved" }, { status: "approved" }] });
  const unshared = await insertFile({ projectId, versions: [{ status: "approved" }] });
  const pendingOnly = await insertFile({ projectId, versions: [{ status: "pending" }] });
  const legacy = await insertFile({ policy: null, projectId, versions: [{}] });
  const ownUpload = await insertFile({ projectId, uploadedBy: seed.owner, versions: [{ status: "pending" }] });
  const rejectedOnly = await insertFile({ projectId, versions: [{ status: "rejected" }] });
  await grant(projectId, shared.fileId, "client", shared.versionIds[0]);

  const [v1, v2] = shared.versionIds;
  const staffView = [`${shared.fileId}:${v2}`, `${unshared.fileId}:${unshared.versionIds[0]}`, `${legacy.fileId}:${legacy.versionIds[0]}`].sort();
  for (const actor of ["admin", "architect"]) {
    const view = await detailFiles(projectId, headers[actor]);
    assert.deepEqual(view.files, staffView, `${actor}: la vigente aprobada; sin pendientes ni rechazadas`);
    assert.deepEqual(view.project.recentDocuments.map((file) => file.id).sort(), [shared.fileId, unshared.fileId, legacy.fileId].sort(), `${actor}: documentos recientes`);
  }
  const ownerView = await detailFiles(projectId, headers.owner);
  assert.deepEqual(ownerView.files, [`${shared.fileId}:${v1}`, `${legacy.fileId}:${legacy.versionIds[0]}`, `${ownUpload.fileId}:${ownUpload.versionIds[0]}`].sort(),
    "propietario: la versión compartida (no la vigente), el heredado y su propia versión");
  const ownerShared = ownerView.project.files.find((file) => file.id === shared.fileId);
  assert.equal(ownerShared.currentVersion, 1, "el número es el de la versión compartida");
  for (const actor of ["otherArchitect", "stranger"]) assert.equal((await detailFiles(projectId, headers[actor])).status, 404, `${actor}: proyecto privado`);

  // Descarga e historial con la misma política.
  assert.equal((await download(projectId, shared.fileId, headers.owner)).text, `${shared.label}-v1`);
  assert.equal((await download(projectId, shared.fileId, headers.owner, v2)).status, 404, "la vigente no compartida");
  assert.equal((await download(projectId, unshared.fileId, headers.owner)).status, 404);
  assert.equal((await download(projectId, pendingOnly.fileId, headers.owner, pendingOnly.versionIds[0])).status, 404);
  assert.equal((await download(projectId, rejectedOnly.fileId, headers.owner, rejectedOnly.versionIds[0])).status, 404);
  assert.equal((await download(projectId, ownUpload.fileId, headers.owner, ownUpload.versionIds[0])).status, 200, "su propia versión pendiente");
  assert.equal((await download(projectId, shared.fileId, headers.architect)).text, `${shared.label}-v2`);
  assert.equal((await download(projectId, legacy.fileId, headers.owner)).status, 200, "heredado: regla de siempre");
  const ownerHistory = await api(`/projects/${projectId}/files/${shared.fileId}/versions`, { headers: headers.owner });
  assert.deepEqual(ownerHistory.body.versions.map((version) => version.id), [v1]);
  const staffHistory = await api(`/projects/${projectId}/files/${shared.fileId}/versions`, { headers: headers.architect });
  assert.deepEqual(staffHistory.body.versions.map((version) => version.id), [v2, v1]);

  // Borrador: una autorización activa no abre al cliente un proyecto que todavía no puede ver.
  const [draft] = await rows(`insert into public.projects (client_id, created_by, assigned_architect_id, name, status, public_slug)
    values ($1, $2, $3, 'Borrador', 'draft', $4) returning id::int`, [seed.client, seed.admin, seed.architect, `d-${randomUUID()}`]);
  const draftFile = await insertFile({ projectId: draft.id, versions: [{ status: "approved" }] });
  await grant(draft.id, draftFile.fileId, "client", draftFile.versionIds[0]);
  assert.equal((await detailFiles(draft.id, headers.owner)).status, 404);
  assert.equal((await download(draft.id, draftFile.fileId, headers.owner)).status, 404);
  assert.equal((await download(draft.id, draftFile.fileId, headers.architect)).status, 404, "un draft solo existe para el administrador");
  assert.equal((await download(draft.id, draftFile.fileId, headers.admin)).status, 200);
});

test("revocación: ETag y 304 solo tras autorizar; sustituir o revocar corta el acceso en la siguiente petición", { skip }, async () => {
  setReview(true);
  const { headers } = seed;
  const projectId = await createProject();
  const file = await insertFile({ projectId, versions: [{ status: "approved" }, { status: "approved" }] });
  const [v1, v2] = file.versionIds;
  await grant(projectId, file.fileId, "client", v1);

  const first = await download(projectId, file.fileId, headers.owner);
  assert.equal(first.status, 200);
  assert.equal(first.cacheControl, "private, no-cache", "siempre revalida: compatible con la revocación");
  assert.equal(first.etag, `"project-file-${file.fileId}-version-${v1}-direct"`);
  const readsBefore = storageReads.length;
  const notModified = await download(projectId, file.fileId, { ...headers.owner, "If-None-Match": first.etag });
  assert.equal(notModified.status, 304);
  assert.equal(storageReads.length, readsBefore, "un 304 no consulta el almacenamiento");

  // Sustituir la versión compartida: la anterior queda como historial sin acceso.
  await grant(projectId, file.fileId, "client", v2);
  const afterSwap = await download(projectId, file.fileId, { ...headers.owner, "If-None-Match": first.etag });
  assert.deepEqual([afterSwap.status, afterSwap.text, afterSwap.etag], [200, `${file.label}-v2`, `"project-file-${file.fileId}-version-${v2}-direct"`]);
  assert.equal((await download(projectId, file.fileId, headers.owner, v1)).status, 404, "la sustituida no da acceso");

  // Revocar: con la ETag anterior responde 404, nunca 304, y sin leer el almacenamiento.
  const revoked = await api(`/projects/${projectId}/files/${file.fileId}/audiences/client`, { headers: headers.admin, method: "DELETE" });
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  assert.equal(revoked.body.client, null);
  const readsBeforeRevoked = storageReads.length;
  const denied = await download(projectId, file.fileId, { ...headers.owner, "If-None-Match": afterSwap.etag });
  assert.equal(denied.status, 404);
  assert.equal(storageReads.length, readsBeforeRevoked, "sin autorización no se consulta el almacenamiento");
  assert.deepEqual((await detailFiles(projectId, headers.owner)).files, [], "desaparece de la galería");
  const history = await api(`/projects/${projectId}/files/${file.fileId}/audiences`, { headers: headers.admin });
  assert.deepEqual(history.body.history.map((entry) => [entry.versionId, entry.endReason]), [[v2, "revoked"], [v1, "superseded"]]);
  assert.equal((await api(`/projects/${projectId}/files/${file.fileId}/audiences/client`, { headers: headers.admin, method: "DELETE" })).status, 404);
});

test("escaparate: autorización independiente del cliente, solo en proyectos públicos finalizados y anonimizada", { skip }, async () => {
  setReview(true);
  const { headers } = seed;
  const projectId = await createProject({ isPublic: true, status: "finished" });
  const image = await insertFile({ projectId, type: "image/png", versions: [{ status: "approved" }] });
  const legacyImage = await insertFile({ policy: null, projectId, type: "image/png", versions: [{}] });
  const pdf = await insertFile({ projectId, versions: [{ status: "approved" }] });

  assert.deepEqual((await detailFiles(projectId, headers.stranger)).files, [`${legacyImage.fileId}:${legacyImage.versionIds[0]}`], "sin autorización solo el heredado");
  const state = await grant(projectId, image.fileId, "showcase", image.versionIds[0]);
  assert.equal(state.client, null, "el escaparate no exige ni crea autorización del cliente");
  for (const actor of ["stranger", "otherArchitect"]) {
    const view = await detailFiles(projectId, headers[actor]);
    assert.deepEqual(view.files, [`${image.fileId}:${image.versionIds[0]}`, `${legacyImage.fileId}:${legacyImage.versionIds[0]}`].sort(), actor);
    assert.equal(view.project.files.find((file) => file.id === image.fileId).uploadedBy, null, "vista pública");
  }
  const showcaseDownload = await download(projectId, image.fileId, headers.stranger);
  assert.equal(showcaseDownload.status, 200);
  assert.match(showcaseDownload.etag, /-showcase"$/);
  assert.doesNotMatch(showcaseDownload.disposition, new RegExp(image.label), "nombre anonimizado");
  assert.deepEqual((await detailFiles(projectId, headers.owner)).files, [`${legacyImage.fileId}:${legacyImage.versionIds[0]}`], "el propietario no la recibe por el escaparate");
  const thumbnail = (await api("/projects?limit=100", { headers: headers.stranger })).body.projects.find((project) => project.id === projectId);
  assert.ok([image.fileId, legacyImage.fileId].includes(thumbnail.imageFileId));

  const notMedia = await api(`/projects/${projectId}/files/${pdf.fileId}/audiences/showcase`, { body: { versionId: pdf.versionIds[0] }, headers: headers.admin, method: "PUT" });
  assert.deepEqual([notMedia.status, notMedia.body.code], [409, "SHOWCASE_MEDIA_ONLY"]);
  const privateProject = await createProject();
  const privateImage = await insertFile({ projectId: privateProject, type: "image/png", versions: [{ status: "approved" }] });
  const notPublic = await api(`/projects/${privateProject}/files/${privateImage.fileId}/audiences/showcase`, { body: { versionId: privateImage.versionIds[0] }, headers: headers.admin, method: "PUT" });
  assert.deepEqual([notPublic.status, notPublic.body.code], [409, "SHOWCASE_REQUIRES_PUBLIC_FINISHED_PROJECT"]);

  // Propuesta PR6 (sin aprobar): autorizar otra versión en el escaparate sustituye la activa, y la
  // auditoría registra qué regla lo justificó. En el cliente la misma sustitución es D4.
  const second = await insertFile({ projectId, type: "image/png", versions: [{ status: "approved" }, { status: "approved" }] });
  await grant(projectId, second.fileId, "showcase", second.versionIds[0]);
  const replaced = await grant(projectId, second.fileId, "showcase", second.versionIds[1]);
  assert.equal(replaced.showcase.versionId, second.versionIds[1]);
  assert.deepEqual(replaced.history.map((entry) => [entry.versionId, entry.endReason]), [[second.versionIds[1], null], [second.versionIds[0], "superseded"]]);
  const [audit] = await rows(`select old_values->>'rule' as rule from public.audit_logs
    where action = 'project_file.audience_granted' and (new_values->>'fileId')::int = $1 and old_values is not null`, [second.fileId]);
  assert.equal(audit.rule, "PR6");
});

test("gestión de audiencias: solo el administrador, versión aprobada del mismo archivo y archivos 1.2", { skip }, async () => {
  setReview(true);
  const { headers } = seed;
  const projectId = await createProject();
  const file = await insertFile({ projectId, versions: [{ status: "approved" }, { status: "pending" }, { status: "rejected" }] });
  const other = await insertFile({ projectId, versions: [{ status: "approved" }] });
  const legacy = await insertFile({ policy: null, projectId, versions: [{}] });
  const path = `/projects/${projectId}/files/${file.fileId}/audiences/client`;
  assert.equal((await api(path, { body: { versionId: file.versionIds[0] }, method: "PUT" })).status, 401);
  for (const actor of ["architect", "owner"]) {
    assert.equal((await api(path, { body: { versionId: file.versionIds[0] }, headers: headers[actor], method: "PUT" })).status, 403, actor);
  }
  for (const versionId of [file.versionIds[1], file.versionIds[2]]) {
    const response = await api(path, { body: { versionId }, headers: headers.admin, method: "PUT" });
    assert.deepEqual([response.status, response.body.code], [409, "FILE_VERSION_NOT_APPROVED"]);
  }
  const foreign = await api(path, { body: { versionId: other.versionIds[0] }, headers: headers.admin, method: "PUT" });
  assert.deepEqual([foreign.status, foreign.body.code], [404, "FILE_VERSION_NOT_FOUND"]);
  const legacyShare = await api(`/projects/${projectId}/files/${legacy.fileId}/audiences/client`, { body: { versionId: legacy.versionIds[0] }, headers: headers.admin, method: "PUT" });
  assert.deepEqual([legacyShare.status, legacyShare.body.code], [409, "FILE_AUDIENCE_UNAVAILABLE"]);
  assert.equal((await api(`/projects/${projectId}/files/${file.fileId}/audiences/otra`, { body: { versionId: 1 }, headers: headers.admin, method: "PUT" })).status, 400);
  const first = await api(path, { body: { versionId: file.versionIds[0] }, headers: headers.admin, method: "PUT" });
  const again = await api(path, { body: { versionId: file.versionIds[0] }, headers: headers.admin, method: "PUT" });
  assert.deepEqual([first.body.changed, again.body.changed, again.body.history.length], [true, false, 1], "idempotente");
  const audit = await rows("select count(*)::int as total from public.audit_logs where action = 'project_file.audience_granted' and (new_values->>'fileId')::int = $1", [file.fileId]);
  assert.equal(audit[0].total, 1);
  await rows("update public.projects set status = 'archived', archived_from_status = 'in_process' where id = $1", [projectId]);
  const archived = await api(path, { headers: headers.admin, method: "DELETE" });
  assert.deepEqual([archived.status, archived.body.code], [409, "PROJECT_ARCHIVED"]);
});

test("paginación: el filtro de audiencia se aplica antes del límite y del cursor; miniatura y portada respetan la política", { skip }, async () => {
  setReview(true);
  const { headers } = seed;
  const projectId = await createProject();
  const files = [];
  for (let index = 0; index < 6; index += 1) {
    files.push(await insertFile({ projectId, type: "image/png", versions: [{ status: "approved" }] }));
  }
  for (const index of [0, 2, 4]) await grant(projectId, files[index].fileId, "client", files[index].versionIds[0]);
  const expected = [files[4], files[2], files[0]].map((file) => file.fileId);
  const page1 = await api(`/projects/${projectId}?filesLimit=2`, { headers: headers.owner });
  assert.deepEqual(page1.body.project.files.map((file) => file.id), expected.slice(0, 2), "página completa con solo archivos compartidos");
  assert.ok(page1.body.project.filesNextCursor);
  const page2 = await api(`/projects/${projectId}?filesLimit=2&filesCursor=${page1.body.project.filesNextCursor}`, { headers: headers.owner });
  assert.deepEqual([page2.body.project.files.map((file) => file.id), page2.body.project.filesNextCursor], [expected.slice(2), null]);

  // Miniatura del listado: la imagen visible más reciente para cada actor.
  const listed = async (actor) => (await api("/projects?limit=100", { headers: headers[actor] })).body.projects.find((project) => project.id === projectId);
  assert.equal((await listed("owner")).imageFileId, files[4].fileId, "el cliente no ve la imagen más reciente sin compartir");
  assert.equal((await listed("architect")).imageFileId, files[5].fileId);

  // Rutas de solicitudes: portada del cliente y descarga de un archivo transferido.
  const [request] = await rows(`insert into public.project_requests (client_id, requested_by, project_name, project_type, location, description, status, converted_project_id)
    values ($1, $2, 'Solicitud convertida', 'residential', 'Caracas', 'Descripción', 'converted', $3) returning id::int`, [seed.client, seed.owner, projectId]);
  const covers = (await api("/project-requests?limit=100", { headers: headers.owner })).body.projectRequests;
  assert.equal(covers.find((item) => item.id === request.id).imageFileId, files[4].fileId, "la portada usa la imagen compartida, no la más reciente");
  // Archivo 1.2 transferido con una versión posterior del equipo: la ruta de la solicitud sirve solo
  // la versión aportada (v1, porque esta solicitud no registra fecha de aprobación), nunca la interna.
  const transferred = await insertFile({ originRequestId: request.id, projectId, type: "image/png", versions: [{ status: "approved" }, { status: "approved" }] });
  const viaRequest = await fetch(`${base}/project-requests/${request.id}/files/${transferred.fileId}/content`, { headers: headers.owner });
  assert.deepEqual([viaRequest.status, await viaRequest.text()], [200, `${transferred.label}-v1`]);
  assert.equal((await download(projectId, transferred.fileId, headers.owner)).status, 404, "por el proyecto, sin autorización ni autoría");
  const legacyTransferred = await insertFile({ originRequestId: request.id, policy: null, projectId, versions: [{}] });
  assert.equal((await fetch(`${base}/project-requests/${request.id}/files/${legacyTransferred.fileId}/content`, { headers: headers.owner })).status, 200, "heredado: regla de siempre");
});

test("concurrencia: autorizaciones simultáneas dejan una sola activa y todo el historial conservado", { skip }, async () => {
  setReview(true);
  const { headers } = seed;
  const projectId = await createProject();
  const file = await insertFile({ projectId, versions: [{ status: "approved" }, { status: "approved" }, { status: "approved" }] });
  const results = await Promise.all(file.versionIds.flatMap((versionId) => [1, 2].map(() => api(
    `/projects/${projectId}/files/${file.fileId}/audiences/client`, { body: { versionId }, headers: headers.admin, method: "PUT" },
  ))));
  assert.ok(results.every((result) => result.status === 200), JSON.stringify(results.map((result) => result.body)));
  const grants = await rows("select ended_at is null as active, end_reason::text from public.project_file_audience_grants where file_id = $1", [file.fileId]);
  assert.equal(grants.filter((row) => row.active).length, 1, "una sola autorización activa del cliente");
  assert.ok(grants.filter((row) => !row.active).every((row) => row.end_reason === "superseded"));
  const rules = await rows(`select distinct old_values->>'rule' as rule from public.audit_logs
    where action = 'project_file.audience_granted' and (new_values->>'fileId')::int = $1 and old_values is not null`, [file.fileId]);
  assert.deepEqual(rules.map((row) => row.rule), ["D4"]);
  const versions = await rows("select count(*)::int as total from public.file_versions where file_id = $1 and deleted_at is null", [file.fileId]);
  assert.equal(versions[0].total, 3, "conservación: ninguna versión se retira");
  assert.deepEqual(deletedKeys, [], "conservación: no se borró ningún objeto");
});

test("activación apagada: rutas de audiencias inexistentes y descarga con la caché anterior", { skip }, async () => {
  setReview(false);
  const { headers } = seed;
  const projectId = await createProject();
  const legacy = await insertFile({ policy: null, projectId, versions: [{}] });
  const response = await api(`/projects/${projectId}/files/${legacy.fileId}/audiences`, { headers: headers.admin });
  assert.deepEqual([response.status, response.body.code], [404, "API_ROUTE_NOT_FOUND"]);
  const current = await download(projectId, legacy.fileId, headers.owner, legacy.versionIds[0]);
  assert.equal(current.status, 200);
  assert.match(current.cacheControl, /immutable/, "con la activación apagada la caché no cambia");
  setReview(true);
});
