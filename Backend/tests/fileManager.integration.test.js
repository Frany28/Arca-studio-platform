import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

/*
 * Administrador de archivos (Fase 1.2, B7) por HTTP contra PostgreSQL real. Opcional y local:
 *   ARCA_FILE_MANAGER_DB_TESTS=1
 *   ARCA_FILE_MANAGER_TEST_DATABASE_URL=postgres://postgres@localhost:54329/postgres
 * Base propia con todas las migraciones, eliminada al terminar; nunca lee .env ni toca el almacenamiento.
 * Cubre métricas (con objetos reutilizados por restauraciones), árbol con nombres legibles, búsqueda de
 * carpetas, pestañas con filtros, orden y cursor, carpetas anidadas fuera de draft y permisos.
 */

const enabled = process.env.ARCA_FILE_MANAGER_DB_TESTS === "1" && process.env.ARCA_FILE_MANAGER_TEST_DATABASE_URL;
const skip = !enabled && "Requiere PostgreSQL local, ARCA_FILE_MANAGER_DB_TESTS=1 y ARCA_FILE_MANAGER_TEST_DATABASE_URL.";

let database;
let server;
let base;
let modules;
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
 * Llama a la API con JSON y devuelve estado y cuerpo.
 *
 * @param {string} path - Ruta relativa a /api.
 * @param {object} [options] - Método, cabeceras y cuerpo.
 * @returns {Promise<{ status: number, body: object|null }>} Respuesta.
 */
async function api(path, { body, headers = seed.headers?.admin ?? {}, method = "GET" } = {}) {
  const response = await fetch(`${base}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
    method,
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
    values ($1, $2, $3, $4, $5, $6, '2026-11-01', 'residential', 'Caracas', false) returning id::int`, [seed.client, seed.admin, seed.architect, name, status, `fm-${randomUUID()}`]);
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
 * Registra un archivo y sus versiones. Las restauraciones reutilizan la clave de su origen.
 *
 * @param {object} options - Archivo.
 * @param {number} options.projectId - Proyecto.
 * @param {number|null} [options.folderId] - Carpeta.
 * @param {string} options.name - Nombre original.
 * @param {number|null} [options.policy] - 1 o null (heredado).
 * @param {Array<{ status?: string, size: number, restoreOf?: number, at?: string }>} options.versions - Versiones.
 * @returns {Promise<{ fileId: number, versionIds: number[] }>} Identificadores.
 */
async function insertFile({ folderId = null, name, policy = 1, projectId, versions }) {
  const extension = name.split(".").pop();
  const type = extension === "pdf" ? "application/pdf" : "image/png";
  const approved = versions.map((version, index) => (policy === null || version.status === "approved" ? index + 1 : 0)).filter(Boolean);
  const current = approved.length ? Math.max(...approved) : null;
  const [file] = await rows(`insert into public.files (project_id, folder_id, uploaded_by, title, file_type, file_category, current_version, access_policy)
    values ($1, $2, $3, $4, $5, $6, $7, $8) returning id::int`, [projectId, folderId, seed.architect, name, type, extension === "pdf" ? "document" : "image", current, policy]);
  const versionIds = [];
  const keys = [];
  for (const [index, version] of versions.entries()) {
    const number = index + 1;
    const key = version.restoreOf === undefined ? `projects/${projectId}/files/${file.id}/v${number}-${randomUUID().slice(0, 6)}/${name}` : keys[version.restoreOf];
    keys.push(key);
    const status = policy === null ? null : version.status;
    const reviewed = status === "approved" || status === "rejected";
    const [stored] = await rows(`insert into public.file_versions (file_id, uploaded_by, version_number, file_name, original_name, file_url, file_extension, file_size,
        is_current, content_type, review_status, reviewed_by, reviewed_at, review_reason, restored_from_version_id, created_at)
      values ($1, $2, $3, $4, $5, 's3://ficticio', $6, $7, $8, $9, $10::public.file_version_review_status, $11, $12, $13, $14, coalesce($15::timestamptz, now())) returning id::int`, [
      file.id, seed.architect, number, key, name, extension, version.size, number === current, policy === null ? null : type, status,
      reviewed ? seed.admin : null, reviewed ? new Date() : null, status === "rejected" ? "No cumple" : null,
      version.restoreOf === undefined ? null : versionIds[version.restoreOf], version.at ?? null,
    ]);
    versionIds.push(stored.id);
  }
  return { fileId: file.id, versionIds };
}

/**
 * Recorre todas las páginas de una pestaña siguiendo `nextCursor`.
 *
 * @param {string} query - Consulta sin cursor.
 * @returns {Promise<Array<object>>} Elementos de todas las páginas.
 */
async function allPages(query) {
  const items = [];
  let cursor = null;
  do {
    const response = await api(`/admin/files/items?${query}${cursor ? `&cursor=${cursor}` : ""}`);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    items.push(...response.body.items);
    cursor = response.body.nextCursor;
  } while (cursor);
  return items;
}

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({ baseUrl: process.env.ARCA_FILE_MANAGER_TEST_DATABASE_URL, prefix: "arca_file_manager" });
  Object.assign(process.env, {
    AUTH_TOKEN_SECRET: "file-manager-test-secret-0123456789abcdef0123456789abcdef",
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
    ...(await import("../src/services/sessionService.js")),
    ...(await import("../src/repositories/projectSystemFolderRepository.js")),
    app: (await import("../src/app.js")).default,
  };
  const roleId = async (code) => Number((await rows("insert into public.roles (code, name) values ($1, $1) returning id", [code]))[0].id);
  const roles = { admin: await roleId("admin"), architect: await roleId("architect"), client: await roleId("client") };
  const insertUser = async (role, email, clientId = null) => Number((await rows(`insert into public.users (role_id, client_id, email, first_name, last_name, password_hash)
    values ($1, $2, $3, 'Arq.', 'Armando', '!disabled!') returning id`, [roles[role], clientId, email]))[0].id);
  seed.client = Number((await rows("insert into public.clients (name, email) values ('Cliente Norte', 'norte@gestor.test') returning id"))[0].id);
  seed.admin = await insertUser("admin", "admin@gestor.test");
  seed.architect = await insertUser("architect", "arquitecto@gestor.test");
  seed.owner = await insertUser("client", "cliente@gestor.test", seed.client);
  const session = async (userId) => ({ Authorization: `Bearer ${(await modules.issueUserSession(userId)).token}` });
  seed.headers = { admin: await session(seed.admin), architect: await session(seed.architect), owner: await session(seed.owner) };
  server = modules.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;

  // Datos: dos proyectos con archivos en varias carpetas, un borrador y un proyecto eliminado.
  seed.quinta = await createProject("Quinta Bella Vista");
  seed.apartamento = await createProject("Apartamento JC");
  seed.draft = await createProject("Borrador Sur", "draft");
  const deleted = await createProject("Proyecto eliminado");
  await rows("update public.projects set deleted_at = now() where id = $1", [deleted.id]);
  // Un proyecto guardó el nombre anterior de «Panorámicas»: el árbol debe mostrar el vigente.
  await rows("update public.project_folders set name = 'Modelos 3D' where id = $1", [seed.quinta.folders["renders.models"]]);
  const docs = seed.quinta.folders["documents.initial_proposal"];
  seed.files = {
    // v1 aprobada, v2 aprobada vigente, v3 restaura v1 (mismo objeto) y queda pendiente.
    acta: await insertFile({ folderId: docs, name: "Acta de inicio.pdf", projectId: seed.quinta.id, versions: [
      { at: "2026-03-01T10:00:00Z", size: 1000, status: "approved" },
      { at: "2026-03-02T10:00:00Z", size: 2000, status: "approved" },
      { at: "2026-03-05T10:00:00Z", restoreOf: 0, size: 1000, status: "pending" },
    ] }),
    contrato: await insertFile({ folderId: docs, name: "Contrato inicial.pdf", projectId: seed.quinta.id, versions: [{ at: "2026-03-03T10:00:00Z", size: 3000, status: "approved" }] }),
    plano: await insertFile({ folderId: docs, name: "Plano_100%.pdf", projectId: seed.quinta.id, versions: [{ at: "2026-03-04T10:00:00Z", size: 500, status: "rejected" }] }),
    render: await insertFile({ folderId: seed.quinta.folders["renders.images.execution"], name: "Render cocina.png", projectId: seed.quinta.id, versions: [{ at: "2026-02-01T10:00:00Z", size: 4000, status: "approved" }] }),
    legacy: await insertFile({ folderId: seed.apartamento.folders.documents, name: "Escritura.pdf", policy: null, projectId: seed.apartamento.id, versions: [{ at: "2026-01-15T10:00:00Z", size: 700 }] }),
    draftFile: await insertFile({ name: "Borrador.pdf", projectId: seed.draft.id, versions: [{ at: "2026-01-10T10:00:00Z", size: 100, status: "pending" }] }),
    gone: await insertFile({ name: "Eliminado.pdf", projectId: deleted.id, versions: [{ size: 99999, status: "approved" }] }),
  };
  // Un adjunto que sigue en su solicitud no pertenece al administrador.
  const [request] = await rows(`insert into public.project_requests (client_id, requested_by, project_name, project_type, location, description, status)
    values ($1, $2, 'Solicitud', 'residential', 'Caracas', 'Descripción', 'pending_review') returning id::int`, [seed.client, seed.owner]);
  const [attachment] = await rows(`insert into public.files (project_request_id, uploaded_by, title, file_type, file_category, current_version)
    values ($1, $2, 'adjunto.pdf', 'application/pdf', 'document', 1) returning id::int`, [request.id, seed.owner]);
  await rows(`insert into public.file_versions (file_id, uploaded_by, version_number, file_name, original_name, file_url, file_extension, file_size, is_current)
    values ($1, $2, 1, 'project-requests/x/adjunto.pdf', 'adjunto.pdf', 's3://ficticio', 'pdf', 88888, true)`, [attachment.id, seed.owner]);
});

after(async () => {
  if (!enabled) return;
  if (server) await new Promise((resolve) => server.close(resolve));
  await modules?.pool?.end().catch(() => {});
  await database?.drop();
});

test("métricas: archivos, espacio con objetos reutilizados contados una vez y última carga sin restauraciones", { skip }, async () => {
  const global = (await api("/admin/files/metrics")).body.metrics;
  // 6 archivos vigentes (sin el del proyecto eliminado ni el adjunto de solicitud).
  // Objetos: acta v1 (1000, reutilizado por v3) + v2 (2000) + contrato 3000 + plano 500 + render 4000 + escritura 700 + borrador 100.
  assert.deepEqual([global.totalFiles, global.usedBytes, global.objectCount], [6, 11300, 7]);
  assert.equal(new Date(global.lastUploadAt).toISOString(), "2026-03-04T10:00:00.000Z", "la restauración del 5 de marzo no es una carga");
  const project = (await api(`/admin/files/metrics?projectId=${seed.quinta.id}`)).body.metrics;
  assert.deepEqual([project.totalFiles, project.usedBytes], [4, 10500]);
  const documents = (await api(`/admin/files/metrics?projectId=${seed.quinta.id}&folderId=${seed.quinta.folders.documents}`)).body.metrics;
  assert.deepEqual([documents.totalFiles, documents.usedBytes], [3, 6500], "la carpeta incluye sus subcarpetas");
  const renders = (await api(`/admin/files/metrics?projectId=${seed.quinta.id}&folderId=${seed.quinta.folders.renders}`)).body.metrics;
  assert.deepEqual([renders.totalFiles, renders.usedBytes], [1, 4000]);
  const empty = (await api(`/admin/files/metrics?projectId=${seed.quinta.id}&folderId=${seed.quinta.folders.cover}`)).body.metrics;
  assert.deepEqual([empty.totalFiles, empty.usedBytes, empty.lastUploadAt], [0, 0, null]);
  assert.equal((await api(`/admin/files/metrics?projectId=${seed.apartamento.id}&folderId=${seed.quinta.folders.cover}`)).status, 404, "carpeta de otro proyecto");
  assert.equal((await api(`/admin/files/metrics?folderId=${seed.quinta.folders.cover}`)).status, 400, "la carpeta exige su proyecto");
});

test("árbol: proyectos paginados con cliente y carpetas en preorden con nombres legibles", { skip }, async () => {
  const first = await api("/admin/files/tree?limit=2");
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.projects.map((project) => project.name), ["Apartamento JC", "Borrador Sur"]);
  const second = await api(`/admin/files/tree?limit=2&cursor=${first.body.nextCursor}`);
  assert.deepEqual([second.body.projects.map((project) => project.name), second.body.nextCursor], [["Quinta Bella Vista"], null], "sin el eliminado");
  const quinta = second.body.projects[0];
  assert.deepEqual([quinta.client.name, quinta.fileCount, quinta.status], ["Cliente Norte", 4, "in_process"]);
  const names = quinta.folders.map((folder) => folder.name);
  assert.equal(names[0], "Portada del proyecto");
  assert.ok(names.includes("Panorámicas") && !names.includes("Modelos 3D"), "nombre vigente del catálogo");
  const documents = quinta.folders.find((folder) => folder.systemKey === "documents.initial_proposal");
  assert.equal(documents.fileCount, 3);
  assert.ok(quinta.folders.indexOf(documents) > quinta.folders.findIndex((folder) => folder.systemKey === "documents"), "preorden");
  assert.deepEqual((await api("/admin/files/tree?search=norte")).body.projects.length, 3, "búsqueda por cliente");
  assert.equal((await api("/admin/files/tree?cursor=no-valido")).status, 400);
});

test("búsqueda de carpetas: por nombre visible, literal y con ruta legible", { skip }, async () => {
  const panoramic = await api(`/admin/files/folders?search=${encodeURIComponent("panorám")}`);
  assert.equal(panoramic.status, 200);
  assert.equal(panoramic.body.folders.length, 3, "una por proyecto vigente");
  const quinta = panoramic.body.folders.find((folder) => folder.project.id === seed.quinta.id);
  assert.deepEqual(quinta.path.map((segment) => segment.name), ["Renders e imágenes", "Panorámicas"]);
  assert.equal(quinta.client.name, "Cliente Norte");
  const inProject = await api(`/admin/files/folders?search=propuesta&projectId=${seed.quinta.id}&limit=2`);
  assert.equal(inProject.body.folders.length, 2);
  const rest = await api(`/admin/files/folders?search=propuesta&projectId=${seed.quinta.id}&limit=50&cursor=${inProject.body.nextCursor}`);
  const all = (await api(`/admin/files/folders?search=propuesta&projectId=${seed.quinta.id}&limit=50`)).body.folders.map((folder) => folder.id);
  assert.deepEqual([...inProject.body.folders, ...rest.body.folders].map((folder) => folder.id), all, "el cursor no pierde ni repite");
  assert.equal((await api("/admin/files/folders?search=%25")).body.folders.length, 0, "% se busca literal");
});

test("pestañas: aprobados (incluye heredados), pendientes y rechazados por versión", { skip }, async () => {
  const approved = await allPages("tab=approved&limit=100");
  assert.deepEqual(approved.map((item) => item.name).sort(), ["Acta de inicio.pdf", "Contrato inicial.pdf", "Escritura.pdf", "Render cocina.png"]);
  const acta = approved.find((item) => item.fileId === seed.files.acta.fileId);
  assert.deepEqual([acta.versionNumber, acta.isCurrent, acta.review.status], [2, true, "approved"], "la vigente, no la pendiente");
  assert.equal(approved.find((item) => item.name === "Escritura.pdf").review.status, "legacy");
  const pending = await allPages("tab=pending");
  assert.deepEqual(pending.map((item) => [item.name, item.versionNumber]).sort(), [["Acta de inicio.pdf", 3], ["Borrador.pdf", 1]]);
  assert.equal(pending.find((item) => item.versionNumber === 3).restoredFromVersionId, seed.files.acta.versionIds[0]);
  const rejected = await allPages("tab=rejected");
  assert.deepEqual(rejected.map((item) => [item.name, item.review.reason]), [["Plano_100%.pdf", "No cumple"]]);
  assert.deepEqual(rejected[0].folder, { id: seed.quinta.folders["documents.initial_proposal"], name: "Propuesta inicial", section: "documents" });
  assert.equal(rejected[0].fileCategory, "document");
  const render = approved.find((item) => item.name === "Render cocina.png");
  assert.deepEqual([render.fileCategory, render.folder.section], ["image", "images"]);
});

test("filtros, ordenación y cursor: ámbito, búsqueda, extensiones y los tres órdenes en ambos sentidos", { skip }, async () => {
  const docs = seed.quinta.folders["documents.initial_proposal"];
  assert.deepEqual((await allPages(`tab=approved&projectId=${seed.quinta.id}&folderId=${docs}`)).map((item) => item.name).sort(), ["Acta de inicio.pdf", "Contrato inicial.pdf"]);
  assert.deepEqual((await allPages(`tab=approved&projectId=${seed.quinta.id}&folderId=${seed.quinta.folders.documents}`)).length, 0, "solo la carpeta");
  assert.equal((await allPages(`tab=approved&projectId=${seed.quinta.id}&folderId=${seed.quinta.folders.documents}&includeSubfolders=true`)).length, 2);
  assert.deepEqual((await allPages("tab=approved&search=contrato")).map((item) => item.name), ["Contrato inicial.pdf"]);
  assert.deepEqual((await allPages("tab=rejected&search=_100%25")).length, 1, "% y _ literales");
  assert.deepEqual((await allPages("tab=approved&extensions=png")).map((item) => item.name), ["Render cocina.png"]);
  assert.equal((await allPages("tab=approved&extensions=pdf,.PNG")).length, 4);

  const expected = {
    date: ["Escritura.pdf", "Render cocina.png", "Acta de inicio.pdf", "Contrato inicial.pdf"],
    name: ["acta de inicio.pdf", "contrato inicial.pdf", "escritura.pdf", "render cocina.png"],
    size: ["Escritura.pdf", "Acta de inicio.pdf", "Contrato inicial.pdf", "Render cocina.png"],
  };
  for (const sort of ["date", "name", "size"]) {
    for (const order of ["asc", "desc"]) {
      const paged = (await allPages(`tab=approved&sort=${sort}&order=${order}&limit=1`)).map((item) => (sort === "name" ? item.name.toLowerCase() : item.name));
      assert.deepEqual(paged, order === "asc" ? expected[sort] : [...expected[sort]].reverse(), `${sort} ${order}`);
    }
  }
  const page = await api("/admin/files/items?tab=approved&sort=name&order=asc&limit=1");
  assert.equal((await api(`/admin/files/items?tab=approved&sort=size&order=asc&limit=1&cursor=${page.body.nextCursor}`)).status, 400, "cursor de otra ordenación");
  assert.equal((await api(`/admin/files/items?tab=pending&sort=name&order=asc&limit=1&cursor=${page.body.nextCursor}`)).status, 400, "cursor de otra pestaña");
  assert.equal((await api("/admin/files/items?tab=todos")).status, 400);
  assert.equal((await api("/admin/files/items?extensions=p%20df")).status, 400);
});

test("carpetas fuera de draft: anidadas, reglas confirmadas, decisiones pendientes, nombres repetidos y auditoría", { skip }, async () => {
  const path = `/admin/files/projects/${seed.quinta.id}/folders`;
  const level1 = await api(path, { body: { name: "Cocina", parentId: seed.quinta.folders["renders.images.execution"] }, method: "POST" });
  assert.equal(level1.status, 201, JSON.stringify(level1.body));
  const level2 = await api(path, { body: { name: "Detalles", parentId: level1.body.folder.id }, method: "POST" });
  const level3 = await api(path, { body: { name: "Encimera", parentId: level2.body.folder.id }, method: "POST" });
  assert.equal(level3.status, 201);
  const tree = level3.body.folders.map((folder) => folder.name);
  assert.ok(tree.indexOf("Cocina") < tree.indexOf("Detalles") && tree.indexOf("Detalles") < tree.indexOf("Encimera"));
  const search = await api("/admin/files/folders?search=encimera");
  assert.deepEqual(search.body.folders[0].path.map((segment) => segment.name), ["Renders e imágenes", "Imágenes", "Ejecución", "Cocina", "Detalles", "Encimera"]);

  const root = await api(path, { body: { name: "Raíz", parentId: null }, method: "POST" });
  assert.deepEqual([root.status, root.body.code], [409, "PROJECT_FOLDER_DECISION_PENDING"], "D7");
  assert.match(root.body.message, /D7/);
  const cover = await api(path, { body: { name: "Extra", parentId: seed.quinta.folders.cover }, method: "POST" });
  assert.deepEqual([cover.status, cover.body.code], [409, "PROJECT_FOLDER_SUBFOLDERS_NOT_ALLOWED"]);
  const repeated = await api(path, { body: { name: " cocina ", parentId: seed.quinta.folders["renders.images.execution"] }, method: "POST" });
  assert.equal(repeated.status, 400, "nombre repetido entre hermanas");
  assert.equal((await api(path, { body: { name: "X", parentId: seed.apartamento.folders.documents }, method: "POST" })).status, 404, "madre de otro proyecto");

  assert.equal((await api(`${path}/${level3.body.folder.id}`, { body: { name: "Encimera de granito" }, method: "PATCH" })).status, 200);
  const renameSystem = await api(`${path}/${seed.quinta.folders.documents}`, { body: { name: "Docs" }, method: "PATCH" });
  assert.deepEqual([renameSystem.status, renameSystem.body.code], [409, "PROJECT_FOLDER_PROTECTED"]);
  const notEmpty = await api(`${path}/${level1.body.folder.id}`, { method: "DELETE" });
  assert.deepEqual([notEmpty.status, notEmpty.body.code], [409, "PROJECT_FOLDER_NOT_EMPTY"]);
  assert.equal((await api(`${path}/${level3.body.folder.id}`, { method: "DELETE" })).status, 200);
  const deleteSystem = await api(`${path}/${seed.quinta.folders.cover}`, { method: "DELETE" });
  assert.deepEqual([deleteSystem.status, deleteSystem.body.code], [409, "PROJECT_FOLDER_PROTECTED"]);
  const audit = await rows("select action from public.audit_logs where entity_type = 'project_folder' order by id");
  assert.deepEqual(audit.map((row) => row.action), ["project_folder.created", "project_folder.created", "project_folder.created", "project_folder.renamed", "project_folder.deleted"]);

  // Estados: draft admitido (lo prepara el administrador); archivado y finalizado, de solo lectura.
  assert.equal((await api(`/admin/files/projects/${seed.draft.id}/folders`, { body: { name: "Notas", parentId: seed.draft.folders.documents }, method: "POST" })).status, 201);
  const archived = await createProject("Archivado");
  await rows("update public.projects set status = 'archived', archived_from_status = 'in_process' where id = $1", [archived.id]);
  assert.equal((await api(`/admin/files/projects/${archived.id}/folders`, { body: { name: "X", parentId: archived.folders.documents }, method: "POST" })).body.code, "PROJECT_ARCHIVED");
  const finished = await createProject("Finalizado", "finished");
  assert.equal((await api(`/admin/files/projects/${finished.id}/folders`, { body: { name: "X", parentId: finished.folders.documents }, method: "POST" })).body.code, "PROJECT_FINALIZED");
});

test("concurrencia: dos altas simultáneas con el mismo nombre dejan una sola carpeta", { skip }, async () => {
  const path = `/admin/files/projects/${seed.apartamento.id}/folders`;
  const parentId = seed.apartamento.folders.documents;
  const results = await Promise.all([1, 2, 3].map(() => api(path, { body: { name: "Permisos", parentId }, method: "POST" })));
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 400, 400]);
  assert.equal((await rows("select count(*)::int as total from public.project_folders where parent_id = $1 and name = 'Permisos'", [parentId]))[0].total, 1);
});

test("permisos y activación: solo el administrador; apagada, 404 antes de autenticar", { skip }, async () => {
  for (const actor of ["architect", "owner"]) assert.equal((await api("/admin/files/metrics", { headers: seed.headers[actor] })).status, 403, actor);
  assert.equal((await api("/admin/files/items", { headers: {} })).status, 401);
  process.env.PROJECT_FILE_REVIEW_ENABLED = "false";
  try {
    const off = await api("/admin/files/metrics", { headers: {} });
    assert.deepEqual([off.status, off.body.code], [404, "API_ROUTE_NOT_FOUND"]);
    assert.equal((await api(`/admin/projects/${seed.quinta.id}/configuration/files`)).status, 200, "el resto de /admin no cambia");
  } finally {
    process.env.PROJECT_FILE_REVIEW_ENABLED = "true";
  }
});

test("elementos: categoría del archivo y sección heredada de la carpeta predeterminada más cercana (visor y garantías, U2)", { skip }, async () => {
  const project = await createProject("Garantías Norte");
  const custom = await api(`/admin/files/projects/${project.id}/folders`, { body: { name: "Impermeabilización", parentId: project.folders["documents.warranties"] }, method: "POST" });
  assert.equal(custom.status, 201);
  const nested = await api(`/admin/files/projects/${project.id}/folders`, { body: { name: "2026", parentId: custom.body.folder.id }, method: "POST" });
  await insertFile({ folderId: nested.body.folder.id, name: "Certificado.pdf", projectId: project.id, versions: [{ size: 10, status: "approved" }] });
  const panorama = await insertFile({ folderId: project.folders["renders.models"], name: "Sala 360.png", projectId: project.id, versions: [{ size: 20, status: "approved" }] });
  await rows("update public.files set file_category = 'panorama' where id = $1", [panorama.fileId]);
  await insertFile({ name: "Sin carpeta.pdf", projectId: project.id, versions: [{ size: 30, status: "approved" }] });

  const items = await allPages(`tab=approved&projectId=${project.id}`);
  const byName = Object.fromEntries(items.map((item) => [item.name, item]));
  assert.deepEqual(byName["Certificado.pdf"].folder, { id: nested.body.folder.id, name: "2026", section: "warranties" }, "subcarpeta de Garantías");
  assert.equal(byName["Certificado.pdf"].fileCategory, "document");
  assert.deepEqual([byName["Sala 360.png"].fileCategory, byName["Sala 360.png"].folder.section], ["panorama", "models_3d"]);
  assert.deepEqual([byName["Sin carpeta.pdf"].folder, byName["Sin carpeta.pdf"].fileCategory], [null, "document"]);
});
