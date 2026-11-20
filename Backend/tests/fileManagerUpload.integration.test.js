import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

/*
 * Subida desde el administrador de archivos (Fase 1.2, U3) por HTTP contra PostgreSQL real.
 * Opcional y local:
 *   ARCA_FILE_MANAGER_DB_TESTS=1
 *   ARCA_FILE_MANAGER_TEST_DATABASE_URL=postgres://postgres@localhost:54329/postgres
 * Base propia con todas las migraciones, eliminada al terminar; nunca lee .env. El almacenamiento es
 * un mapa en memoria que registra escrituras y borrados para comprobar la compensación.
 */

const enabled = process.env.ARCA_FILE_MANAGER_DB_TESTS === "1" && process.env.ARCA_FILE_MANAGER_TEST_DATABASE_URL;
const skip = !enabled && "Requiere PostgreSQL local, ARCA_FILE_MANAGER_DB_TESTS=1 y ARCA_FILE_MANAGER_TEST_DATABASE_URL.";

let database;
let server;
let base;
let modules;
const seed = {};
const storage = new Map();
const putKeys = [];
const deletedKeys = [];
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fe0dc4cf9a0000000049454e44ae426082", "hex");
const PDF = Buffer.from("%PDF-1.4\n%prueba\n");

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
 * Sube un binario a la ruta del administrador, como lo envía el navegador.
 *
 * @param {number} projectId - Proyecto.
 * @param {number|string|null} folderId - Carpeta (null omite el parámetro).
 * @param {Buffer} body - Contenido.
 * @param {string} name - Nombre del archivo.
 * @param {string} type - Tipo MIME.
 * @param {object} [headers] - Autenticación.
 * @returns {Promise<{ status: number, body: object|null }>} Respuesta.
 */
async function upload(projectId, folderId, body, name, type, headers = seed.headers.admin) {
  const query = folderId === null ? "" : `?folderId=${folderId}`;
  const response = await fetch(`${base}/admin/files/projects/${projectId}/files${query}`, {
    body,
    headers: { "Content-Type": type, "X-File-Name": encodeURIComponent(name), ...headers },
    method: "POST",
  });
  const text = await response.text();
  return { body: text ? JSON.parse(text) : null, status: response.status };
}

/**
 * Crea un proyecto con sus carpetas predeterminadas del catálogo.
 *
 * @param {string} name - Nombre.
 * @param {string} [status] - Estado.
 * @returns {Promise<{ id: number, folders: Record<string, number> }>} Proyecto y carpetas por clave.
 */
async function createProject(name, status = "in_process") {
  const [project] = await rows(`insert into public.projects (client_id, created_by, assigned_architect_id, name, status, public_slug, start_date, project_type, location, has_plans)
    values ($1, $2, $3, $4, $5, $6, '2026-11-01', 'residential', 'Caracas', false) returning id::int`, [seed.client, seed.admin, seed.architect, name, status, `fu-${randomUUID()}`]);
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

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({ baseUrl: process.env.ARCA_FILE_MANAGER_TEST_DATABASE_URL, prefix: "arca_file_upload" });
  Object.assign(process.env, {
    AUTH_TOKEN_SECRET: "file-upload-test-secret-0123456789abcdef0123456789abcdef",
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
    ...(await import("../src/repositories/projectSystemFolderRepository.js")),
    app: (await import("../src/app.js")).default,
  };
  modules.objectStorage.put = async ({ body, key }) => {
    const chunks = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    storage.set(key, Buffer.concat(chunks));
    putKeys.push(key);
    return {};
  };
  modules.objectStorage.delete = async (key) => {
    deletedKeys.push(key);
    storage.delete(key);
    return {};
  };
  const roleId = async (code) => Number((await rows("insert into public.roles (code, name) values ($1, $1) returning id", [code]))[0].id);
  const roles = { admin: await roleId("admin"), architect: await roleId("architect") };
  const permission = Number((await rows("insert into public.permissions (code, name, description, module) values ('projects.files.upload', 'x', null, 'projects') returning id"))[0].id);
  for (const id of Object.values(roles)) await rows("insert into public.role_permissions (role_id, permission_id, is_active) values ($1, $2, true)", [id, permission]);
  const insertUser = async (role, email) => Number((await rows(`insert into public.users (role_id, email, first_name, last_name, password_hash)
    values ($1, $2, 'Ana', 'Admin', '!disabled!') returning id`, [roles[role], email]))[0].id);
  seed.client = Number((await rows("insert into public.clients (name, email) values ('Cliente', 'cliente@subida.test') returning id"))[0].id);
  seed.admin = await insertUser("admin", "admin@subida.test");
  seed.architect = await insertUser("architect", "arq@subida.test");
  const session = async (userId) => ({ Authorization: `Bearer ${(await modules.issueUserSession(userId)).token}` });
  seed.headers = { admin: await session(seed.admin), architect: await session(seed.architect) };
  server = modules.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
  seed.project = await createProject("Quinta Subidas");
});

after(async () => {
  if (!enabled) return;
  if (server) await new Promise((resolve) => server.close(resolve));
  await modules?.pool?.end().catch(() => {});
  await database?.drop();
});

/**
 * Comprueba que todo objeto escrito quedó registrado o se eliminó (compensación).
 *
 * @returns {Promise<void>}
 */
async function assertNoOrphanObjects() {
  const recorded = new Set((await rows("select file_name from public.file_versions")).map((row) => row.file_name));
  const orphans = [...storage.keys()].filter((key) => !recorded.has(key));
  assert.deepEqual(orphans, [], "ningún objeto queda sin registrar");
}

test("sube a la carpeta elegida con la v1 pendiente y aparece en Pendientes", { skip }, async () => {
  const folderId = seed.project.folders["documents.initial_proposal"];
  const created = await upload(seed.project.id, folderId, PDF, "Acta de inicio.pdf", "application/pdf");
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.file.reviewStatus, "pending");
  const [file] = await rows("select folder_id::int, file_category::text, current_version, access_policy from public.files where id = $1", [created.body.file.id]);
  assert.deepEqual(file, { access_policy: 1, current_version: null, file_category: "document", folder_id: folderId });
  const pending = await fetch(`${base}/admin/files/items?tab=pending&projectId=${seed.project.id}`, { headers: seed.headers.admin }).then((response) => response.json());
  assert.deepEqual(pending.items.map((item) => [item.name, item.versionNumber, item.folder.id]), [["Acta de inicio.pdf", 1, folderId]]);
});

test("Panorámicas: una imagen se registra como panorámica (visor 360); otros formatos conservan su categoría", { skip }, async () => {
  const folderId = seed.project.folders["renders.models.initial_proposal"];
  const image = await upload(seed.project.id, folderId, PNG, "Sala 360.png", "image/png");
  assert.equal(image.status, 201, JSON.stringify(image.body));
  const pdf = await upload(seed.project.id, folderId, PDF, "Ficha panorámica.pdf", "application/pdf");
  const categories = await rows("select title, file_category::text from public.files where id = any($1::bigint[]) order by title", [[image.body.file.id, pdf.body.file.id]]);
  assert.deepEqual(categories.map((row) => [row.title, row.file_category]), [["Ficha panorámica.pdf", "document"], ["Sala 360.png", "panorama"]]);
  const item = (await fetch(`${base}/admin/files/items?tab=pending&search=Sala`, { headers: seed.headers.admin }).then((response) => response.json())).items[0];
  assert.deepEqual([item.fileCategory, item.folder.section], ["panorama", "models_3d"]);
});

test("portada: solo JPG o PNG y una sola imagen, también con cargas simultáneas; sin objetos huérfanos", { skip }, async () => {
  const cover = seed.project.folders.cover;
  const putsBefore = putKeys.length;
  const rejected = await upload(seed.project.id, cover, PDF, "Portada.pdf", "application/pdf");
  assert.deepEqual([rejected.status, rejected.body.code], [409, "PROJECT_FOLDER_FILE_TYPE_NOT_ACCEPTED"]);
  assert.equal(putKeys.length, putsBefore, "se rechaza antes de transferir");

  const results = await Promise.all(["Portada A.png", "Portada B.png", "Portada C.png"].map((name) => upload(seed.project.id, cover, PNG, name, "image/png")));
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409, 409]);
  assert.ok(results.filter((result) => result.status === 409).every((result) => result.body.code === "PROJECT_FOLDER_FULL"));
  assert.equal((await rows("select count(*)::int as total from public.files where folder_id = $1", [cover]))[0].total, 1);
  const again = await upload(seed.project.id, cover, PNG, "Portada D.png", "image/png");
  assert.deepEqual([again.status, again.body.code], [409, "PROJECT_FOLDER_FULL"]);
  assert.match(again.body.message, /reemplaza la existente/);
  await assertNoOrphanObjects();
});

test("nombre repetido, formato no admitido, carpeta ajena o retirada y estados de solo lectura", { skip }, async () => {
  const folderId = seed.project.folders["documents.initial_proposal"];
  const duplicate = await upload(seed.project.id, folderId, PDF, "Acta de inicio.pdf", "application/pdf");
  assert.deepEqual([duplicate.status, duplicate.body.code], [409, "DUPLICATE_PROJECT_FILE"]);
  const text = await upload(seed.project.id, folderId, Buffer.from("hola"), "notas.txt", "text/plain");
  assert.equal(text.status, 415);
  const other = await createProject("Otro proyecto");
  const foreign = await upload(seed.project.id, other.folders.documents, PDF, "Ajeno.pdf", "application/pdf");
  assert.deepEqual([foreign.status, foreign.body.code], [404, "PROJECT_FOLDER_NOT_FOUND"]);
  const missing = await upload(seed.project.id, null, PDF, "Sin carpeta.pdf", "application/pdf");
  assert.equal(missing.status, 400, "la carpeta destino es obligatoria");
  await rows("update public.projects set status = 'archived', archived_from_status = 'in_process' where id = $1", [other.id]);
  const archived = await upload(other.id, other.folders.documents, PDF, "Archivado.pdf", "application/pdf");
  assert.deepEqual([archived.status, archived.body.code], [409, "PROJECT_ARCHIVED"]);
  const draft = await createProject("Borrador", "draft");
  assert.equal((await upload(draft.id, draft.folders.documents, PDF, "Borrador.pdf", "application/pdf")).status, 201, "el administrador prepara borradores");
  await assertNoOrphanObjects();
});

test("reemplazo (B4) sobre un archivo subido: con su v1 pendiente responde 409; tras aprobarla crea la v2 pendiente y conserva la v1", { skip }, async () => {
  const folderId = seed.project.folders["documents.initial_proposal"];
  const created = await upload(seed.project.id, folderId, PDF, "Contrato.pdf", "application/pdf");
  const replace = (note) => fetch(`${base}/projects/${seed.project.id}/files/${created.body.file.id}/versions`, {
    body: PDF,
    headers: { "Content-Type": "application/pdf", "X-Change-Note": encodeURIComponent(note), "X-File-Name": encodeURIComponent("Contrato v2.pdf"), ...seed.headers.admin },
    method: "POST",
  }).then(async (response) => ({ body: await response.json(), status: response.status }));
  const blocked = await replace("Firma añadida");
  assert.deepEqual([blocked.status, blocked.body.code], [409, "FILE_VERSION_PENDING_REVIEW"]);
  const approve = await fetch(`${base}/projects/${seed.project.id}/files/${created.body.file.id}/versions/${created.body.file.versionId}/approve`, { headers: seed.headers.admin, method: "POST" });
  assert.equal(approve.status, 200);
  const noNote = await replace("");
  assert.equal(noNote.status, 400);
  const replaced = await replace("Firma añadida");
  assert.equal(replaced.status, 201);
  assert.deepEqual([replaced.body.version.versionNumber, replaced.body.version.review.status, replaced.body.version.changeNote], [2, "pending", "Firma añadida"]);
  assert.equal((await rows("select count(*)::int as total from public.file_versions where file_id = $1", [created.body.file.id]))[0].total, 2, "la v1 se conserva");
  await assertNoOrphanObjects();
});

test("permisos y activación: solo el administrador; apagada, 404 antes de autenticar", { skip }, async () => {
  const folderId = seed.project.folders.documents;
  const architect = await upload(seed.project.id, folderId, PDF, "Arquitecto.pdf", "application/pdf", seed.headers.architect);
  assert.equal(architect.status, 403);
  process.env.PROJECT_FILE_REVIEW_ENABLED = "false";
  try {
    const off = await upload(seed.project.id, folderId, PDF, "Apagada.pdf", "application/pdf", {});
    assert.deepEqual([off.status, off.body.code], [404, "API_ROUTE_NOT_FOUND"]);
  } finally {
    process.env.PROJECT_FILE_REVIEW_ENABLED = "true";
  }
});
