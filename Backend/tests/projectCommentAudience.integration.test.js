import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { after, before, test } from "node:test";

import pg from "pg";

import { createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

/*
 * Comentarios y SSE según la audiencia de cada versión (Fase 1.2, B6), por HTTP contra PostgreSQL
 * real. Opcional y local:
 *   ARCA_COMMENT_AUDIENCE_DB_TESTS=1
 *   ARCA_COMMENT_AUDIENCE_TEST_DATABASE_URL=postgres://postgres@localhost:54329/postgres
 * Base propia con todas las migraciones, eliminada al terminar; nunca lee .env. Cubre actores,
 * versiones compartidas e internas, drafts, comentarios históricos, revocación y sustitución con
 * streams abiertos, cambios de asignación, concurrencia, rollback y fallo de publicación, y compara
 * comentarios, eventos y contadores con la política de las descargas.
 */

const enabled = process.env.ARCA_COMMENT_AUDIENCE_DB_TESTS === "1" && process.env.ARCA_COMMENT_AUDIENCE_TEST_DATABASE_URL;
const skip = !enabled && "Requiere PostgreSQL local, ARCA_COMMENT_AUDIENCE_DB_TESTS=1 y ARCA_COMMENT_AUDIENCE_TEST_DATABASE_URL.";

let database;
let server;
let base;
let modules;
let seed;
const storage = new Map();
const openStreams = [];

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
 * Espera a que se cumpla una condición observada (eventos SSE asíncronos), con límite de tiempo.
 *
 * @param {() => boolean} predicate - Condición.
 * @param {string} message - Mensaje si vence el plazo.
 * @returns {Promise<void>}
 */
async function waitFor(predicate, message) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Tiempo agotado: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * Abre un stream SSE real del proyecto y acumula sus eventos decodificados.
 *
 * @param {number} projectId - Proyecto.
 * @param {object} headers - Autenticación.
 * @returns {Promise<{ status: number, events: Array<{ name: string, data: object|null }>, closed: boolean, close: Function }>} Stream.
 */
async function openStream(projectId, headers) {
  const controller = new AbortController();
  const response = await fetch(`${base}/projects/${projectId}/events`, { headers, signal: controller.signal });
  const stream = { close: () => controller.abort(), closed: false, events: [], status: response.status };
  openStreams.push(stream);
  if (response.status !== 200) return stream;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        for (let index = buffer.indexOf("\n\n"); index >= 0; index = buffer.indexOf("\n\n")) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const name = block.match(/^event: (.+)$/m)?.[1];
          const data = block.match(/^data: (.+)$/m)?.[1];
          if (name) stream.events.push({ data: data ? JSON.parse(data) : null, name });
        }
      }
    } catch {
      // Cierre por la prueba.
    }
    stream.closed = true;
  })();
  await waitFor(() => stream.events.some((event) => event.name === "project.connected"), "conexión SSE");
  return stream;
}

/**
 * Ids de comentarios recibidos por SSE en un stream.
 *
 * @param {object} stream - Stream abierto.
 * @returns {number[]} Ids ordenados.
 */
function receivedCommentIds(stream) {
  return stream.events.filter((event) => event.name === "project.comment.created").map((event) => event.data.comment.id).sort((a, b) => a - b);
}

/**
 * Ids de comentarios que devuelve el listado para un actor.
 *
 * @param {number} projectId - Proyecto.
 * @param {object} headers - Autenticación.
 * @returns {Promise<number[]>} Ids ordenados.
 */
async function listedCommentIds(projectId, headers) {
  const response = await api(`/projects/${projectId}/comments?limit=100`, { headers });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.comments.map((comment) => comment.id).sort((a, b) => a - b);
}

/**
 * Crea un proyecto en curso del cliente de prueba asignado al arquitecto de prueba.
 *
 * @param {string} [status] - Estado del proyecto.
 * @returns {Promise<number>} Id del proyecto.
 */
async function createProject(status = "in_process") {
  const [project] = await rows(`insert into public.projects (client_id, created_by, assigned_architect_id, name, status, public_slug, start_date, project_type, location, has_plans)
    values ($1, $2, $3, $4, $5, $6, '2026-11-01', 'residential', 'Caracas', false) returning id::int`, [
    seed.client, seed.admin, seed.architect, `Proyecto ${randomUUID()}`, status, `c-${randomUUID()}`,
  ]);
  return project.id;
}

/**
 * Registra un archivo y sus versiones directamente en PostgreSQL y en el almacenamiento en memoria.
 *
 * @param {object} options - Archivo.
 * @param {number} options.projectId - Proyecto.
 * @param {number|null} [options.policy] - 1 o null (heredado).
 * @param {string} [options.type] - Tipo MIME.
 * @param {number} [options.uploadedBy] - Autor.
 * @param {Array<{ status?: string }>} options.versions - Versiones en orden.
 * @returns {Promise<{ fileId: number, versionIds: number[] }>} Identificadores.
 */
async function insertFile({ policy = 1, projectId, type = "image/png", uploadedBy = seed.architect, versions }) {
  const label = `archivo-${randomUUID().slice(0, 8)}`;
  const approved = versions.map((version, index) => (policy === null || version.status === "approved" ? index + 1 : 0)).filter(Boolean);
  const current = approved.length ? Math.max(...approved) : null;
  const [file] = await rows(`insert into public.files (project_id, uploaded_by, title, file_type, file_category, current_version, access_policy)
    values ($1, $2, $3, $4, $5, $6, $7) returning id::int`, [projectId, uploadedBy, `${label}.bin`, type, type.startsWith("image/") ? "image" : "document", current, policy]);
  const versionIds = [];
  for (const [index, version] of versions.entries()) {
    const number = index + 1;
    const key = `projects/${projectId}/files/${file.id}/v${number}/${label}`;
    storage.set(key, { body: Buffer.from(`${label}-v${number}`), contentType: type });
    const status = policy === null ? null : version.status;
    const reviewed = status === "approved";
    const [stored] = await rows(`insert into public.file_versions (file_id, uploaded_by, version_number, file_name, original_name, file_url, file_extension, file_size,
        is_current, content_type, review_status, reviewed_by, reviewed_at)
      values ($1, $2, $3, $4, $5, 's3://ficticio', 'png', 10, $6, $7, $8::public.file_version_review_status, $9, $10) returning id::int`, [
      file.id, uploadedBy, number, key, `${label}.png`, number === current, policy === null ? null : type, status, reviewed ? seed.admin : null, reviewed ? new Date() : null,
    ]);
    versionIds.push(stored.id);
  }
  return { fileId: file.id, versionIds };
}

/**
 * Autoriza una versión para el cliente como administrador.
 *
 * @param {number} projectId - Proyecto.
 * @param {number} fileId - Archivo.
 * @param {number} versionId - Versión.
 * @returns {Promise<void>}
 */
async function shareWithClient(projectId, fileId, versionId) {
  const response = await api(`/projects/${projectId}/files/${fileId}/audiences/client`, { body: { versionId }, headers: seed.headers.admin, method: "PUT" });
  assert.equal(response.status, 200, JSON.stringify(response.body));
}

/**
 * Crea un comentario por HTTP y devuelve estado y comentario.
 *
 * @param {number} projectId - Proyecto.
 * @param {object} headers - Autenticación.
 * @param {object} body - Cuerpo del comentario.
 * @returns {Promise<{ status: number, comment: object|null, body: object|null }>} Resultado.
 */
async function comment(projectId, headers, body) {
  const response = await api(`/projects/${projectId}/comments`, { body: { content: `Obs ${randomUUID().slice(0, 6)}`, ...body }, headers, method: "POST" });
  return { body: response.body, comment: response.body?.comment ?? null, status: response.status };
}

/**
 * Cuerpo de un comentario de galería sobre un archivo.
 *
 * @param {string} commentType - image, video o panorama.
 * @param {number} fileId - Archivo.
 * @param {object} [extra] - Campos adicionales.
 * @returns {object} Cuerpo.
 */
function galleryComment(commentType, fileId, extra = {}) {
  const selection = commentType === "panorama" ? { kind: "panorama-point", pitch: 5, yaw: 30 } : { x: 0.4, y: 0.6 };
  return { commentType, image: { id: String(fileId), title: "Imagen" }, selection, targetId: String(fileId), ...extra };
}

/**
 * Cuerpo de un comentario de documento en una versión.
 *
 * @param {number} fileId - Archivo.
 * @param {number} fileVersionId - Versión.
 * @returns {object} Cuerpo.
 */
function documentComment(fileId, fileVersionId) {
  return { commentType: "document", fileId, fileVersionId, selection: { kind: "document-point", normalizedX: 0.2, normalizedY: 0.3, pageCount: 2, pageNumber: 1 } };
}

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({ recordMigrations: true, baseUrl: process.env.ARCA_COMMENT_AUDIENCE_TEST_DATABASE_URL, prefix: "arca_comment_audience" });
  Object.assign(process.env, {
    AUTH_TOKEN_SECRET: "comment-audience-test-secret-0123456789abcdef0123456789abcdef",
    COMMENT_RATE_LIMIT_MAX: "1000",
    DATABASE_POOL_MAX: "10",
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
    ...(await import("../src/services/projectEvents.js")),
    ...(await import("../src/repositories/projectCommentRepository.js")),
    ...(await import("../src/config/projectFileReview.js")),
    ...(await import("../src/services/projectFileReviewActivationService.js")),
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
  const insertClient = async (email) => Number((await rows("insert into public.clients (name, email) values ('Cliente', $1) returning id", [email]))[0].id);
  const insertUser = async (role, email, clientId = null, photo = null) => Number((await rows(`insert into public.users (role_id, client_id, email, first_name, last_name, password_hash, profile_photo_url)
    values ($1, $2, $3, 'Prueba', 'Comentarios', '!disabled!', $4) returning id`, [roles[role], clientId, email, photo]))[0].id);
  const client = await insertClient("cliente@comentarios.test");
  seed = {
    admin: await insertUser("admin", "admin@comentarios.test", null, "users/admin/profile-photo"),
    architect: await insertUser("architect", "arquitecto@comentarios.test"),
    client,
    coOwner: await insertUser("client", "socio@comentarios.test", client),
    otherArchitect: await insertUser("architect", "otro@comentarios.test"),
    owner: await insertUser("client", "propietario@comentarios.test", client),
  };
  const session = async (userId) => ({ Authorization: `Bearer ${(await modules.issueUserSession(userId)).token}` });
  seed.headers = {};
  for (const actor of ["admin", "architect", "coOwner", "otherArchitect", "owner"]) seed.headers[actor] = await session(seed[actor]);
  server = modules.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (!enabled) return;
  openStreams.forEach((stream) => stream.close());
  modules?.closeAllProjectEventConnections?.();
  if (server) await new Promise((resolve) => server.close(resolve));
  await modules?.pool?.end().catch(() => {});
  await database?.drop();
});

/**
 * Proyecto con una imagen y un PDF de la política 1.2 (v1 compartida con el cliente, v2 interna
 * vigente), una imagen heredada y una imagen pendiente subida por el propietario.
 *
 * @returns {Promise<object>} Proyecto y archivos.
 */
async function scenario() {
  const projectId = await createProject();
  const image = await insertFile({ projectId, versions: [{ status: "approved" }, { status: "approved" }] });
  const pdf = await insertFile({ projectId, type: "application/pdf", versions: [{ status: "approved" }, { status: "approved" }] });
  const legacy = await insertFile({ policy: null, projectId, versions: [{}] });
  const ownUpload = await insertFile({ projectId, uploadedBy: seed.owner, versions: [{ status: "pending" }] });
  await shareWithClient(projectId, image.fileId, image.versionIds[0]);
  await shareWithClient(projectId, pdf.fileId, pdf.versionIds[0]);
  return { image, legacy, ownUpload, pdf, projectId };
}

test("matriz: listados, creación, documentos, puntos, respuestas, autores e históricos según la versión comentada", { skip }, async () => {
  setReview(true);
  const { headers } = seed;
  const { image, legacy, ownUpload, pdf, projectId } = await scenario();
  const [imageV1, imageV2] = image.versionIds;
  const [pdfV1, pdfV2] = pdf.versionIds;

  // Creación: la versión comentada es la que cada uno ve (equipo: vigente; cliente: compartida).
  const internalImage = await comment(projectId, headers.architect, galleryComment("image", image.fileId));
  assert.equal(internalImage.status, 201, JSON.stringify(internalImage.body));
  assert.deepEqual([internalImage.comment.fileId, internalImage.comment.fileVersionId], [image.fileId, imageV2]);
  const sharedImage = await comment(projectId, headers.owner, galleryComment("image", image.fileId));
  assert.equal(sharedImage.comment.fileVersionId, imageV1);
  const explicitV1 = await comment(projectId, headers.admin, galleryComment("image", image.fileId, { fileVersionId: imageV1 }));
  assert.equal(explicitV1.comment.fileVersionId, imageV1);
  assert.equal((await comment(projectId, headers.owner, galleryComment("image", image.fileId, { fileVersionId: imageV2 }))).status, 404, "versión interna pedida");
  const ownComment = await comment(projectId, headers.owner, galleryComment("image", ownUpload.fileId));
  assert.equal(ownComment.comment.fileVersionId, ownUpload.versionIds[0], "su propia versión pendiente");
  assert.equal((await comment(projectId, headers.coOwner, galleryComment("image", ownUpload.fileId))).status, 404, "otro usuario del cliente (B9)");
  const legacyImage = await comment(projectId, headers.architect, galleryComment("image", legacy.fileId));
  assert.equal(legacyImage.comment.fileVersionId, undefined, "heredado: sin versión, como siempre");
  const general = await comment(projectId, headers.architect, { commentType: "general" });

  // Documentos: acceso a la versión concreta para comentar y para leer.
  const internalDoc = await comment(projectId, headers.architect, documentComment(pdf.fileId, pdfV2));
  assert.equal(internalDoc.status, 201, JSON.stringify(internalDoc.body));
  assert.equal((await comment(projectId, headers.owner, documentComment(pdf.fileId, pdfV2))).status, 404);
  const sharedDoc = await comment(projectId, headers.owner, documentComment(pdf.fileId, pdfV1));
  assert.equal(sharedDoc.status, 201);
  assert.equal((await api(`/projects/${projectId}/files/${pdf.fileId}/comments?fileVersionId=${pdfV2}`, { headers: headers.owner })).status, 404);
  assert.deepEqual((await api(`/projects/${projectId}/files/${pdf.fileId}/comments?fileVersionId=${pdfV1}`, { headers: headers.owner })).body.comments.map((row) => row.id), [sharedDoc.comment.id]);
  assert.deepEqual((await api(`/projects/${projectId}/files/${pdf.fileId}/comments?fileVersionId=${pdfV2}`, { headers: headers.architect })).body.comments.map((row) => row.id), [internalDoc.comment.id]);

  // Comentarios históricos (anteriores a B6): target_id sin versión.
  const historical = async (userId, targetId) => (await rows(`insert into public.project_comments (project_id, user_id, comment_type, content, target_id, target_metadata, status)
    values ($1, $2, 'image', 'Histórico', $3, '{}'::jsonb, 'active') returning id::int`, [projectId, userId, targetId]))[0].id;
  const ambiguousStaff = await historical(seed.architect, String(image.fileId));
  const ambiguousOwner = await historical(seed.owner, `project-file-${image.fileId}`);
  const historicalLegacy = await historical(seed.architect, `project-file-${legacy.fileId}`);
  const historicalNonFile = await historical(seed.architect, "render-portada");

  const all = [internalImage, sharedImage, explicitV1, ownComment, legacyImage, general, internalDoc, sharedDoc].map((row) => row.comment.id)
    .concat([ambiguousStaff, ambiguousOwner, historicalLegacy, historicalNonFile]).sort((a, b) => a - b);
  for (const actor of ["admin", "architect"]) assert.deepEqual(await listedCommentIds(projectId, headers[actor]), all, actor);
  assert.deepEqual(await listedCommentIds(projectId, headers.owner),
    [sharedImage, explicitV1, ownComment, legacyImage, general, sharedDoc].map((row) => row.comment.id).concat([ambiguousOwner, historicalLegacy, historicalNonFile]).sort((a, b) => a - b),
    "propietario: versiones compartidas, las suyas, heredados, generales y su histórico ambiguo");
  assert.deepEqual(await listedCommentIds(projectId, headers.coOwner),
    [sharedImage, explicitV1, legacyImage, general, sharedDoc].map((row) => row.comment.id).concat([historicalLegacy, historicalNonFile]).sort((a, b) => a - b),
    "otro usuario del cliente: sin las versiones ni los históricos ambiguos de otro (B9)");
  assert.equal((await api(`/projects/${projectId}/comments`, { headers: headers.otherArchitect })).status, 404);

  // Misma política que las descargas.
  const download = async (actor, fileId, versionId) => (await fetch(`${base}/projects/${projectId}/files/${fileId}/content?versionId=${versionId}`, { headers: headers[actor] })).status;
  assert.deepEqual([await download("owner", image.fileId, imageV1), await download("owner", image.fileId, imageV2)], [200, 404]);

  // Contadores: los puntos de panorámica se numeran por versión, sin huecos de versiones ocultas.
  const firstInternal = await comment(projectId, headers.architect, galleryComment("panorama", image.fileId));
  const secondInternal = await comment(projectId, headers.architect, galleryComment("panorama", image.fileId));
  const ownerPoint = await comment(projectId, headers.owner, galleryComment("panorama", image.fileId));
  assert.deepEqual([firstInternal.comment.pointNumber, secondInternal.comment.pointNumber, ownerPoint.comment.pointNumber], [1, 2, 1]);

  // Respuestas: solo a comentarios visibles; heredan archivo y versión de la raíz.
  assert.equal((await comment(projectId, headers.owner, { parentCommentId: internalImage.comment.id })).status, 404);
  const reply = await comment(projectId, headers.architect, { parentCommentId: sharedImage.comment.id });
  assert.deepEqual([reply.status, reply.comment.fileVersionId, reply.comment.targetId], [201, imageV1, String(image.fileId)]);

  // Autores: no revela quién comentó solo versiones internas (el administrador comentó v1 y v2).
  const adminOnlyInternal = await createProject();
  const hidden = await insertFile({ projectId: adminOnlyInternal, versions: [{ status: "approved" }] });
  await comment(adminOnlyInternal, headers.admin, galleryComment("image", hidden.fileId));
  const ownerUser = { clientId: seed.client, id: seed.owner, role: { code: "client" } };
  // La consulta directa comparte el mismo estado verificado que obtendría dentro de HTTP.
  await modules.withProjectFileReviewState(await modules.resolveProjectFileReviewActivation(), async () => {
    assert.equal(await modules.findProjectCommentAuthorProfilePhoto(adminOnlyInternal, seed.admin, ownerUser), null);
    assert.equal(await modules.findProjectCommentAuthorProfilePhoto(projectId, seed.admin, ownerUser), "users/admin/profile-photo");
  });

  // Draft: el cliente y el arquitecto no comentan ni leen; el administrador sí lee.
  const draft = await createProject("draft");
  for (const actor of ["owner", "architect"]) assert.equal((await api(`/projects/${draft}/comments`, { headers: headers[actor] })).status, 404, actor);
  assert.equal((await api(`/projects/${draft}/comments`, { headers: headers.admin })).status, 200);
});

test("SSE: cada stream recibe los comentarios que su usuario puede listar y descargar", { skip }, async () => {
  setReview(true);
  const { headers } = seed;
  const { image, legacy, projectId } = await scenario();
  const streams = {};
  for (const actor of ["admin", "architect", "owner", "coOwner"]) streams[actor] = await openStream(projectId, headers[actor]);
  assert.equal((await openStream(projectId, headers.otherArchitect)).status, 404);

  const created = [
    await comment(projectId, headers.architect, galleryComment("image", image.fileId)),
    await comment(projectId, headers.owner, galleryComment("image", image.fileId)),
    await comment(projectId, headers.architect, galleryComment("video", legacy.fileId)),
    await comment(projectId, headers.admin, { commentType: "general" }),
  ].map((row) => row.comment.id);
  await waitFor(() => receivedCommentIds(streams.admin).length === 4, "eventos del administrador");
  for (const actor of ["admin", "architect", "owner", "coOwner"]) {
    const listed = (await listedCommentIds(projectId, headers[actor])).filter((id) => created.includes(id));
    await waitFor(() => receivedCommentIds(streams[actor]).length === listed.length, `eventos de ${actor}`);
    assert.deepEqual(receivedCommentIds(streams[actor]), listed, `${actor}: eventos = listado`);
  }
  assert.equal(receivedCommentIds(streams.owner).includes(created[0]), false, "el comentario de la versión interna no llega al cliente");
  const ownerComments = streams.owner.events.filter((event) => event.name === "project.comment.created").map((event) => event.data.comment);
  assert.equal(ownerComments.some((row) => row.fileVersionId === image.versionIds[1]), false, "ningún comentario de la versión interna");
});

test("SSE: revocar, sustituir y desasignar con la conexión abierta", { skip }, async () => {
  setReview(true);
  const { headers } = seed;
  const { image, projectId } = await scenario();
  const [imageV1, imageV2] = image.versionIds;
  const onV1 = (await comment(projectId, headers.architect, galleryComment("image", image.fileId, { fileVersionId: imageV1 }))).comment.id;
  const onV2 = (await comment(projectId, headers.architect, galleryComment("image", image.fileId))).comment.id;
  const streams = { architect: await openStream(projectId, headers.architect), owner: await openStream(projectId, headers.owner) };
  assert.ok((await listedCommentIds(projectId, headers.owner)).includes(onV1));

  // Revocar: aviso sin datos y el listado completo ya no lo devuelve; nuevos comentarios de v1 no llegan.
  assert.equal((await api(`/projects/${projectId}/files/${image.fileId}/audiences/client`, { headers: headers.admin, method: "DELETE" })).status, 200);
  await waitFor(() => streams.owner.events.some((event) => event.name === "project.access.changed"), "aviso de revocación");
  const notice = streams.owner.events.find((event) => event.name === "project.access.changed");
  assert.deepEqual(Object.keys(notice.data).sort(), ["projectId", "timestamp"], "el aviso no revela archivos, versiones ni contadores");
  assert.equal((await listedCommentIds(projectId, headers.owner)).includes(onV1), false);
  const afterRevoke = (await comment(projectId, headers.architect, galleryComment("image", image.fileId, { fileVersionId: imageV1 }))).comment.id;
  await waitFor(() => receivedCommentIds(streams.architect).includes(afterRevoke), "evento al equipo");
  assert.equal(receivedCommentIds(streams.owner).includes(afterRevoke), false);

  // Sustituir por v2: nuevo aviso; ahora recibe v2 y no v1.
  await shareWithClient(projectId, image.fileId, imageV2);
  await waitFor(() => streams.owner.events.filter((event) => event.name === "project.access.changed").length === 2, "aviso de sustitución");
  const ownerList = await listedCommentIds(projectId, headers.owner);
  assert.deepEqual([ownerList.includes(onV2), ownerList.includes(onV1)], [true, false]);
  const onV2Later = (await comment(projectId, headers.admin, galleryComment("image", image.fileId, { fileVersionId: imageV2 }))).comment.id;
  await waitFor(() => receivedCommentIds(streams.owner).includes(onV2Later), "evento de la versión compartida");

  // Desasignar al arquitecto: al publicar se revalida y su stream se cierra sin recibir el evento.
  await rows("update public.projects set assigned_architect_id = $2 where id = $1", [projectId, seed.otherArchitect]);
  const afterUnassign = (await comment(projectId, headers.admin, { commentType: "general" })).comment.id;
  await waitFor(() => streams.architect.closed, "cierre del stream desasignado");
  assert.equal(receivedCommentIds(streams.architect).includes(afterUnassign), false);
  await waitFor(() => receivedCommentIds(streams.owner).includes(afterUnassign), "el propietario sigue recibiendo");
});

test("concurrencia: un comentario que espera a una revocación en curso se rechaza; simultáneos no dejan errores", { skip }, async () => {
  setReview(true);
  const { headers } = seed;
  const { image, projectId } = await scenario();
  const [imageV1] = image.versionIds;

  // Revocación en curso (bloquea el proyecto FOR SHARE como el servicio) y aún sin confirmar.
  const revoker = new pg.Client({ connectionString: database.databaseUrl });
  await revoker.connect();
  try {
    await revoker.query("begin");
    await revoker.query("select id from public.projects where id = $1 for share", [projectId]);
    await revoker.query(`update public.project_file_audience_grants set ended_at = clock_timestamp(), ended_by = $2, end_reason = 'revoked'
      where file_id = $1 and audience = 'client_owner' and ended_at is null`, [image.fileId, seed.admin]);
    const pending = comment(projectId, headers.owner, galleryComment("image", image.fileId, { fileVersionId: imageV1 }));
    // Da tiempo a que la petición llegue al bloqueo del proyecto antes de confirmar la revocación.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await revoker.query("commit");
    assert.equal((await pending).status, 404, "tras el bloqueo ve la revocación confirmada");
  } finally {
    await revoker.end();
  }

  // Comentarios del cliente simultáneos a compartir y revocar: solo 201 o 404, y lo creado es coherente.
  const attempts = [];
  for (let round = 0; round < 3; round += 1) {
    attempts.push(api(`/projects/${projectId}/files/${image.fileId}/audiences/client`, { body: { versionId: imageV1 }, headers: headers.admin, method: "PUT" }));
    for (let index = 0; index < 4; index += 1) attempts.push(comment(projectId, headers.owner, galleryComment("image", image.fileId, { fileVersionId: imageV1 })));
    attempts.push(api(`/projects/${projectId}/files/${image.fileId}/audiences/client`, { headers: headers.admin, method: "DELETE" }));
  }
  const results = await Promise.all(attempts);
  assert.ok(results.every((result) => [200, 201, 404].includes(result.status)), JSON.stringify(results.map((result) => result.status)));
  const created = results.filter((result) => result.status === 201).map((result) => result.comment.id);
  const stored = await rows("select id::int, file_version_id::int from public.project_comments where id = any($1)", [created]);
  assert.ok(stored.every((row) => row.file_version_id === imageV1));
  assert.equal(stored.length, created.length);
});

test("rollback y fallo de publicación: sin eventos de lo no confirmado; la respuesta confirmada no cambia", { skip }, async (context) => {
  setReview(true);
  const { headers } = seed;
  const { image, projectId } = await scenario();
  const stream = await openStream(projectId, headers.admin);

  // Rollback de un comentario (fallo en PostgreSQL al insertar): ni fila ni evento.
  await rows(`create function test_fail_comment() returns trigger language plpgsql as $$
    begin if new.content = 'FALLA' then raise exception 'fallo simulado'; end if; return new; end $$`);
  await rows("create trigger test_fail_comment before insert on public.project_comments for each row execute function test_fail_comment()");
  // Rollback de una autorización (fallo de auditoría): sin aviso de acceso.
  await rows(`create function test_fail_audit() returns trigger language plpgsql as $$
    begin if new.action = 'project_file.audience_revoked' then raise exception 'fallo simulado'; end if; return new; end $$`);
  await rows("create trigger test_fail_audit before insert on public.audit_logs for each row execute function test_fail_audit()");
  try {
    assert.equal((await comment(projectId, headers.admin, { commentType: "general", content: "FALLA" })).status, 500);
    assert.equal((await api(`/projects/${projectId}/files/${image.fileId}/audiences/client`, { headers: headers.admin, method: "DELETE" })).status, 500);
  } finally {
    await rows("drop trigger test_fail_comment on public.project_comments; drop function test_fail_comment()");
    await rows("drop trigger test_fail_audit on public.audit_logs; drop function test_fail_audit()");
  }
  assert.equal((await rows("select count(*)::int as total from public.project_comments where content = 'FALLA'"))[0].total, 0);
  assert.equal((await rows("select count(*)::int as total from public.project_file_audience_grants where file_id = $1 and ended_at is null", [image.fileId]))[0].total, 1);

  // Fallo al publicar tras confirmar: 201, comentario guardado y fallo registrado sin datos sensibles.
  const errors = context.mock.method(console, "error", () => {});
  await rows("alter table public.project_file_audience_grants rename to project_file_audience_grants_hidden");
  let published;
  try {
    published = await comment(projectId, headers.admin, { commentType: "general" });
    await waitFor(() => errors.mock.calls.some((call) => String(call.arguments[0]).includes("project_event_publish_failed")), "registro del fallo");
  } finally {
    await rows("alter table public.project_file_audience_grants_hidden rename to project_file_audience_grants");
  }
  assert.equal(published.status, 201);
  assert.equal((await rows("select count(*)::int as total from public.project_comments where id = $1", [published.comment.id]))[0].total, 1);
  const logged = JSON.parse(errors.mock.calls.find((call) => String(call.arguments[0]).includes("project_event_publish_failed")).arguments[0]);
  assert.deepEqual(Object.keys(logged).sort(), ["code", "eventName", "projectId", "type"]);
  assert.equal(receivedCommentIds(stream).includes(published.comment.id), false);
  assert.equal(stream.events.some((event) => event.name === "project.access.changed"), false, "ningún aviso de lo revertido");
});

test("activación apagada: todos los comentarios del proyecto y difusión a todos, como antes", { skip }, async () => {
  setReview(true);
  const { headers } = seed;
  const { image, projectId } = await scenario();
  const internal = (await comment(projectId, headers.architect, galleryComment("image", image.fileId))).comment.id;
  setReview(false);
  try {
    const stream = await openStream(projectId, headers.owner);
    assert.ok((await listedCommentIds(projectId, headers.owner)).includes(internal), "regla anterior: acceso al proyecto");
    const created = (await comment(projectId, headers.architect, galleryComment("image", image.fileId))).comment;
    assert.equal(created.fileVersionId, undefined, "sin versión: SQL anterior");
    await waitFor(() => receivedCommentIds(stream).includes(created.id), "difusión anterior");
  } finally {
    setReview(true);
  }
});
