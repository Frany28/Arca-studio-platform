import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

/*
 * Garantías con ids estables y documentos vinculados (Fase 1.2, B8) por HTTP contra PostgreSQL real.
 * Opcional y local:
 *   ARCA_WARRANTIES_DB_TESTS=1
 *   ARCA_WARRANTIES_TEST_DATABASE_URL=postgres://postgres@localhost:54329/postgres
 * Base propia con todas las migraciones, eliminada al terminar; nunca lee .env ni toca el almacenamiento.
 */

const enabled = process.env.ARCA_WARRANTIES_DB_TESTS === "1" && process.env.ARCA_WARRANTIES_TEST_DATABASE_URL;
const skip = !enabled && "Requiere PostgreSQL local, ARCA_WARRANTIES_DB_TESTS=1 y ARCA_WARRANTIES_TEST_DATABASE_URL.";

let database;
let server;
let base;
let modules;
const seed = {};

/**
 * Activa o desactiva la revisión para las peticiones siguientes.
 *
 * @param {boolean} value - Estado.
 * @returns {void}
 */
function setReview(value) {
  process.env.PROJECT_FILE_REVIEW_ENABLED = value ? "true" : "false";
}

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
 * Llama a la API con JSON (por defecto como administrador).
 *
 * @param {string} path - Ruta relativa a /api.
 * @param {object} [options] - Método, cabeceras y cuerpo.
 * @returns {Promise<{ status: number, body: object|null }>} Respuesta.
 */
async function api(path, { body, headers = seed.headers.admin, method = "GET" } = {}) {
  const response = await fetch(`${base}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
    method,
  });
  const text = await response.text();
  return { body: text ? JSON.parse(text) : null, status: response.status };
}

/**
 * Garantía válida con campos opcionales sustituidos.
 *
 * @param {object} [overrides] - Campos.
 * @returns {object} Garantía.
 */
function warranty(overrides = {}) {
  return { code: "C-1", endDate: "2027-12-01", model: "X1", product: "Calentador", serviceDate: "2027-06-01", startDate: "2027-01-01", ...overrides };
}

/**
 * Guarda las garantías de un borrador por la configuración.
 *
 * @param {number} projectId - Proyecto.
 * @param {object[]} warranties - Garantías.
 * @returns {Promise<{ status: number, body: object|null }>} Respuesta.
 */
function saveWarranties(projectId, warranties) {
  return api(`/admin/projects/${projectId}/configuration/warranties`, { body: { warranties }, method: "PUT" });
}

/**
 * Crea un proyecto con su árbol predeterminado.
 *
 * @param {string} [status] - Estado.
 * @returns {Promise<{ id: number, folders: Record<string, number> }>} Proyecto y carpetas por clave.
 */
async function createProject(status = "draft") {
  const [project] = await rows(`insert into public.projects (client_id, created_by, assigned_architect_id, name, status, public_slug, start_date, project_type, location, has_plans)
    values ($1, $2, $3, $4, $5, $6, '2026-11-01', 'residential', 'Caracas', false) returning id::int`,
  [seed.client, seed.admin, seed.architect, `Garantías ${randomUUID().slice(0, 6)}`, status, `g-${randomUUID()}`]);
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
 * Registra un documento con sus versiones (política 1.2 por defecto).
 *
 * @param {object} options - Documento.
 * @param {number} options.projectId - Proyecto.
 * @param {number|null} options.folderId - Carpeta.
 * @param {number|null} [options.policy] - 1 o null.
 * @param {string[]} [options.statuses] - Estado de cada versión.
 * @returns {Promise<{ fileId: number, versionIds: number[] }>} Identificadores.
 */
async function insertDocument({ folderId, policy = 1, projectId, statuses = ["approved"] }) {
  const approved = statuses.map((status, index) => (policy === null || status === "approved" ? index + 1 : 0)).filter(Boolean);
  const current = approved.length ? Math.max(...approved) : null;
  const [file] = await rows(`insert into public.files (project_id, folder_id, uploaded_by, title, file_type, file_category, current_version, access_policy)
    values ($1, $2, $3, $4, 'application/pdf', 'document', $5, $6) returning id::int`, [projectId, folderId, seed.admin, `garantia-${randomUUID().slice(0, 6)}.pdf`, current, policy]);
  const versionIds = [];
  for (const [index, status] of statuses.entries()) {
    const reviewed = policy !== null && status === "approved";
    const [version] = await rows(`insert into public.file_versions (file_id, uploaded_by, version_number, file_name, original_name, file_url, file_extension, file_size,
        is_current, content_type, review_status, reviewed_by, reviewed_at)
      values ($1, $2, $3, $4, 'garantia.pdf', 's3://ficticio', 'pdf', 10, $5, $6, $7::public.file_version_review_status, $8, $9) returning id::int`, [
      file.id, seed.admin, index + 1, `projects/${projectId}/files/${file.id}/v${index + 1}/garantia.pdf`, index + 1 === current,
      policy === null ? null : "application/pdf", policy === null ? null : status, reviewed ? seed.admin : null, reviewed ? new Date() : null,
    ]);
    versionIds.push(version.id);
  }
  return { fileId: file.id, versionIds };
}

/**
 * Vincula o desvincula un documento de una garantía como administrador.
 *
 * @param {"PUT"|"DELETE"} method - Operación.
 * @param {number} projectId - Proyecto.
 * @param {number} warrantyId - Garantía.
 * @param {number} fileId - Documento.
 * @param {object} [headers] - Autenticación.
 * @returns {Promise<{ status: number, body: object|null }>} Respuesta.
 */
function link(method, projectId, warrantyId, fileId, headers = seed.headers.admin) {
  return api(`/admin/files/projects/${projectId}/warranties/${warrantyId}/documents/${fileId}`, { headers, method });
}

/**
 * Huella de archivos, versiones y vínculos de un proyecto, para comprobar la conservación.
 *
 * @param {number} projectId - Proyecto.
 * @returns {Promise<object>} Recuentos.
 */
async function conservation(projectId) {
  const [row] = await rows(`select
      (select count(*)::int from public.files where project_id = $1 and deleted_at is null) as files,
      (select count(*)::int from public.file_versions v join public.files f on f.id = v.file_id where f.project_id = $1 and v.deleted_at is null) as versions,
      (select count(*)::int from public.project_warranty_documents where project_id = $1) as link_rows,
      (select count(*)::int from public.project_warranties where project_id = $1) as warranty_rows`, [projectId]);
  return row;
}

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({ recordMigrations: true, baseUrl: process.env.ARCA_WARRANTIES_TEST_DATABASE_URL, prefix: "arca_warranties" });
  Object.assign(process.env, {
    AUTH_TOKEN_SECRET: "warranties-test-secret-0123456789abcdef0123456789abcdef",
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
    ...(await import("../src/services/sessionService.js")),
    ...(await import("../src/repositories/projectSystemFolderRepository.js")),
    app: (await import("../src/app.js")).default,
  };
  const roleId = async (code) => Number((await rows("insert into public.roles (code, name) values ($1, $1) returning id", [code]))[0].id);
  const roles = { admin: await roleId("admin"), architect: await roleId("architect"), client: await roleId("client") };
  const [permission] = await rows("insert into public.permissions (code, name, description, module) values ('projects.read', 'projects.read', null, 'projects') returning id");
  for (const id of Object.values(roles)) await rows("insert into public.role_permissions (role_id, permission_id, is_active) values ($1, $2, true)", [id, permission.id]);
  const insertClient = async (email) => Number((await rows("insert into public.clients (name, email) values ('Cliente', $1) returning id", [email]))[0].id);
  const insertUser = async (role, email, clientId = null) => Number((await rows(`insert into public.users (role_id, client_id, email, first_name, last_name, password_hash)
    values ($1, $2, $3, 'Prueba', 'Garantías', '!disabled!') returning id`, [roles[role], clientId, email]))[0].id);
  seed.client = await insertClient("cliente@garantias.test");
  const stranger = await insertClient("ajeno@garantias.test");
  seed.admin = await insertUser("admin", "admin@garantias.test");
  seed.architect = await insertUser("architect", "arquitecto@garantias.test");
  seed.owner = await insertUser("client", "propietario@garantias.test", seed.client);
  seed.stranger = await insertUser("client", "ajeno@garantias.test", stranger);
  const session = async (userId) => ({ Authorization: `Bearer ${(await modules.issueUserSession(userId)).token}` });
  seed.headers = {};
  for (const actor of ["admin", "architect", "owner", "stranger"]) seed.headers[actor] = await session(seed[actor]);
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

test("ids estables: actualiza por id, guardados repetidos no cambian nada, retira conservando la fila", { skip }, async () => {
  setReview(true);
  const project = await createProject();
  const first = await saveWarranties(project.id, [warranty({ code: "A" }), warranty({ code: "B" })]);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const [a, b] = first.body.configuration.warranties.map((item) => item.id);

  const reordered = await saveWarranties(project.id, [warranty({ code: "B2", id: b }), warranty({ code: "A", id: a })]);
  assert.deepEqual(reordered.body.configuration.warranties.map((item) => [item.id, item.code]), [[b, "B2"], [a, "A"]], "mismos ids, nuevo orden");
  const before = await rows("select id::int, updated_at from public.project_warranties where project_id = $1 order by id", [project.id]);
  const repeated = await saveWarranties(project.id, [warranty({ code: "B2", id: b }), warranty({ code: "A", id: a })]);
  assert.equal(repeated.status, 200);
  assert.deepEqual(await rows("select id::int, updated_at from public.project_warranties where project_id = $1 order by id", [project.id]), before, "sin cambios, sin escrituras");

  const twins = await saveWarranties(project.id, [warranty({ code: "A", id: a }), warranty({ code: "Gemela" }), warranty({ code: "Gemela" })]);
  const ids = twins.body.configuration.warranties.map((item) => item.id);
  assert.equal(new Set(ids).size, 3, "dos garantías iguales sin id son dos registros");
  assert.equal(ids[0], a);
  const retired = await rows("select deleted_at is not null as retired from public.project_warranties where id = $1", [b]);
  assert.deepEqual(retired, [{ retired: true }], "B omitida: retirada y conservada");

  const other = await createProject();
  const [foreign] = (await saveWarranties(other.id, [warranty()])).body.configuration.warranties;
  for (const [id, label] of [[foreign.id, "de otro proyecto"], [b, "retirada"], [999999, "inexistente"]]) {
    const response = await saveWarranties(project.id, [warranty({ id })]);
    assert.equal(response.status, 400, label);
    assert.ok(response.body.fields["body.warranties.0.id"], label);
  }
  const duplicated = await saveWarranties(project.id, [warranty({ id: a }), warranty({ id: a })]);
  assert.ok(duplicated.body.fields["body.warranties.1.id"]);
  assert.equal((await rows("select count(*)::int as total from public.project_warranties where project_id = $1 and deleted_at is null", [project.id]))[0].total, 3, "los rechazos no cambian nada");
});

test("compatibilidad: sin ids y sin vínculos se comporta como antes; sin ids con vínculos responde 409", { skip }, async () => {
  setReview(true);
  const project = await createProject();
  const [first] = (await saveWarranties(project.id, [warranty()])).body.configuration.warranties;
  const [second] = (await saveWarranties(project.id, [warranty()])).body.configuration.warranties;
  assert.notEqual(second.id, first.id, "envío anterior sin ids: retira y crea, como siempre");

  const document = await insertDocument({ folderId: project.folders["documents.warranties"], projectId: project.id });
  assert.equal((await link("PUT", project.id, second.id, document.fileId)).status, 200);
  const snapshot = await conservation(project.id);
  const blocked = await saveWarranties(project.id, [warranty()]);
  assert.deepEqual([blocked.status, blocked.body.code], [409, "WARRANTY_REFERENCES_REQUIRED"]);
  assert.deepEqual(await conservation(project.id), snapshot, "nada cambia");
  const kept = await saveWarranties(project.id, [warranty({ code: "Editada", id: second.id })]);
  assert.equal(kept.body.configuration.warranties[0].id, second.id);

  // Apagada: los vínculos no existen para el backend; el guardado sin ids conserva el comportamiento anterior
  // y con ids es estable (las columnas que usa son anteriores a la Fase 1.2).
  setReview(false);
  try {
    const legacyProject = await createProject();
    const [legacyA] = (await saveWarranties(legacyProject.id, [warranty()])).body.configuration.warranties;
    const [legacyB] = (await saveWarranties(legacyProject.id, [warranty({ id: legacyA.id })])).body.configuration.warranties;
    assert.equal(legacyB.id, legacyA.id);
  } finally {
    setReview(true);
  }
});

test("vínculos: mismo proyecto, subárbol de garantías, varias garantías por documento, auditados e idempotentes", { skip }, async () => {
  setReview(true);
  const project = await createProject();
  const [w1, w2, w3] = (await saveWarranties(project.id, [warranty({ code: "1" }), warranty({ code: "2" }), warranty({ code: "3" })])).body.configuration.warranties.map((item) => item.id);
  const [custom] = await rows(`insert into public.project_folders (project_id, parent_id, name, created_by) values ($1, $2, 'Calentadores', $3) returning id::int`,
    [project.id, project.folders["documents.warranties"], seed.admin]);
  const inFolder = await insertDocument({ folderId: project.folders["documents.warranties"], projectId: project.id });
  const inSubfolder = await insertDocument({ folderId: custom.id, projectId: project.id });
  const outside = await insertDocument({ folderId: project.folders["documents.initial_proposal"], projectId: project.id });

  const linked = await link("PUT", project.id, w1, inFolder.fileId);
  assert.deepEqual([linked.status, linked.body.changed, linked.body.linkedWarrantyIds], [200, true, [w1]]);
  assert.deepEqual((await link("PUT", project.id, w2, inFolder.fileId)).body.linkedWarrantyIds.sort(), [w1, w2].sort(), "varias garantías");
  assert.equal((await link("PUT", project.id, w1, inFolder.fileId)).body.changed, false, "idempotente");
  assert.equal((await link("PUT", project.id, w1, inSubfolder.fileId)).status, 200, "subcarpeta personalizada de Garantías");
  const outsideLink = await link("PUT", project.id, w1, outside.fileId);
  assert.deepEqual([outsideLink.status, outsideLink.body.code], [409, "WARRANTY_DOCUMENT_OUTSIDE_FOLDER"]);

  const other = await createProject();
  const [otherWarranty] = (await saveWarranties(other.id, [warranty()])).body.configuration.warranties;
  const otherDocument = await insertDocument({ folderId: other.folders["documents.warranties"], projectId: other.id });
  assert.equal((await link("PUT", project.id, w1, otherDocument.fileId)).body.code, "FILE_NOT_FOUND", "documento de otro proyecto");
  assert.equal((await link("PUT", project.id, otherWarranty.id, inFolder.fileId)).body.code, "WARRANTY_NOT_FOUND", "garantía de otro proyecto");

  const unlinked = await link("DELETE", project.id, w2, inFolder.fileId);
  assert.deepEqual([unlinked.status, unlinked.body.linkedWarrantyIds], [200, [w1]]);
  assert.equal((await link("DELETE", project.id, w2, inFolder.fileId)).body.code, "WARRANTY_DOCUMENT_LINK_NOT_FOUND");
  const history = await rows("select unlinked_at is not null as closed, unlinked_by::int from public.project_warranty_documents where warranty_id = $1 and file_id = $2", [w2, inFolder.fileId]);
  assert.deepEqual(history, [{ closed: true, unlinked_by: seed.admin }], "el vínculo deshecho queda como historial");
  assert.equal((await link("PUT", project.id, w2, inFolder.fileId)).body.changed, true, "se puede volver a vincular");

  // Retirar W3 (omitiéndola con ids explícitos) conserva sus vínculos como evidencia y no admite nuevos.
  assert.equal((await link("PUT", project.id, w3, inSubfolder.fileId)).status, 200);
  const snapshot = await conservation(project.id);
  await saveWarranties(project.id, [warranty({ code: "1", id: w1 }), warranty({ code: "2", id: w2 })]);
  const after = await conservation(project.id);
  assert.deepEqual([after.files, after.versions, after.link_rows], [snapshot.files, snapshot.versions, snapshot.link_rows], "archivos, versiones y vínculos conservados");
  assert.deepEqual(await rows("select unlinked_at from public.project_warranty_documents where warranty_id = $1", [w3]), [{ unlinked_at: null }], "evidencia intacta");
  assert.equal((await link("PUT", project.id, w3, inFolder.fileId)).body.code, "WARRANTY_RETIRED");
  assert.equal((await link("DELETE", project.id, w3, inSubfolder.fileId)).body.code, "WARRANTY_RETIRED", "la evidencia no se modifica");

  const audit = await rows(`select action, count(*)::int as total from public.audit_logs
    where entity_type = 'project_warranty_document' and (new_values->>'projectId')::int = $1 group by action order by action`, [project.id]);
  assert.deepEqual(audit, [{ action: "project_warranty_document.linked", total: 5 }, { action: "project_warranty_document.unlinked", total: 1 }]);

  // Permisos, activación y estados.
  for (const actor of ["architect", "owner"]) assert.equal((await link("PUT", project.id, w1, inSubfolder.fileId, seed.headers[actor])).status, 403);
  assert.equal((await link("PUT", project.id, w1, inSubfolder.fileId, {})).status, 401);
  setReview(false);
  try {
    assert.equal((await link("PUT", project.id, w1, inSubfolder.fileId, {})).body.code, "API_ROUTE_NOT_FOUND");
  } finally {
    setReview(true);
  }
  await rows("update public.projects set status = 'finished' where id = $1", [project.id]);
  assert.equal((await link("DELETE", project.id, w1, inSubfolder.fileId)).body.code, "PROJECT_FINALIZED");
});

test("movimiento: un documento con vínculos activos no sale de Garantías; la evidencia de retiradas no lo retiene", { skip }, async () => {
  setReview(true);
  const project = await createProject();
  const [w1, w2] = (await saveWarranties(project.id, [warranty({ code: "1" }), warranty({ code: "2" })])).body.configuration.warranties.map((item) => item.id);
  const [custom] = await rows(`insert into public.project_folders (project_id, parent_id, name, created_by) values ($1, $2, 'Bombas', $3) returning id::int`,
    [project.id, project.folders["documents.warranties"], seed.admin]);
  const document = await insertDocument({ folderId: project.folders["documents.warranties"], projectId: project.id });
  const free = await insertDocument({ folderId: project.folders["documents.warranties"], projectId: project.id });
  await link("PUT", project.id, w1, document.fileId);
  const move = (fileId, folderId) => api(`/admin/projects/${project.id}/configuration/files/${fileId}`, { body: { folderId }, method: "PATCH" });

  for (const target of [project.folders["documents.initial_proposal"], project.folders.documents, null]) {
    const response = await move(document.fileId, target);
    assert.deepEqual([response.status, response.body.code], [409, "WARRANTY_DOCUMENT_MOVE_FORBIDDEN"], String(target));
  }
  assert.equal((await move(document.fileId, custom.id)).status, 200, "dentro del subárbol");
  assert.equal((await move(free.fileId, project.folders.documents)).status, 200, "sin vínculos se mueve libremente");

  // Retirar W1: su vínculo queda como evidencia y ya no retiene el documento.
  await saveWarranties(project.id, [warranty({ code: "2", id: w2 })]);
  assert.equal((await move(document.fileId, project.folders.documents)).status, 200);
});

test("lectura: política común de versiones; el cliente recibe la autorizada y nunca los documentos internos", { skip }, async () => {
  setReview(true);
  const project = await createProject();
  const [w1, w2] = (await saveWarranties(project.id, [warranty({ code: "Con documentos" }), warranty({ code: "Sin visibles" })])).body.configuration.warranties.map((item) => item.id);
  const folder = project.folders["documents.warranties"];
  const shared = await insertDocument({ folderId: folder, projectId: project.id, statuses: ["approved", "approved"] });
  const internal = await insertDocument({ folderId: folder, projectId: project.id });
  const legacy = await insertDocument({ folderId: folder, policy: null, projectId: project.id, statuses: [null] });
  for (const fileId of [shared.fileId, internal.fileId, legacy.fileId]) await link("PUT", project.id, w1, fileId);
  await link("PUT", project.id, w2, internal.fileId);
  await rows("update public.projects set status = 'in_process' where id = $1", [project.id]);
  const grant = await api(`/projects/${project.id}/files/${shared.fileId}/audiences/client`, { body: { versionId: shared.versionIds[0] }, method: "PUT" });
  assert.equal(grant.status, 200, JSON.stringify(grant.body));

  const read = async (actor) => api(`/projects/${project.id}/warranties`, { headers: seed.headers[actor] });
  const documentsOf = (body, warrantyId) => body.warranties.find((item) => item.id === warrantyId).documents.map((doc) => [doc.fileId, doc.versionId]);
  const owner = await read("owner");
  assert.equal(owner.status, 200);
  assert.deepEqual(owner.body.warranties.map((item) => item.id), [w1, w2], "las garantías siempre aparecen");
  assert.deepEqual(documentsOf(owner.body, w1).sort(), [[shared.fileId, shared.versionIds[0]], [legacy.fileId, legacy.versionIds[0]]].sort(), "la versión autorizada, no la vigente");
  assert.deepEqual(documentsOf(owner.body, w2), [], "el documento interno no aparece");
  for (const actor of ["admin", "architect"]) {
    const staff = await read(actor);
    assert.deepEqual(documentsOf(staff.body, w1).sort(), [[shared.fileId, shared.versionIds[1]], [internal.fileId, internal.versionIds[0]], [legacy.fileId, legacy.versionIds[0]]].sort(), actor);
  }
  assert.equal((await read("stranger")).status, 404);
  // La misma política que la descarga.
  assert.equal((await fetch(`${base}/projects/${project.id}/files/${internal.fileId}/content`, { headers: seed.headers.owner })).status, 404);

  // Revocar: el documento deja de aparecer y el vínculo se conserva.
  await api(`/projects/${project.id}/files/${shared.fileId}/audiences/client`, { method: "DELETE" });
  assert.deepEqual(documentsOf((await read("owner")).body, w1), [[legacy.fileId, legacy.versionIds[0]]]);
  assert.equal((await rows("select count(*)::int as total from public.project_warranty_documents where file_id = $1 and unlinked_at is null", [shared.fileId]))[0].total, 1);
  setReview(false);
  try {
    assert.equal((await read("owner")).status, 404, "apagada: ruta inexistente");
  } finally {
    setReview(true);
  }
});

test("concurrencia y rollback: vínculos simultáneos, guardado y movimiento a la vez, y fallo de auditoría", { skip }, async () => {
  setReview(true);
  const project = await createProject();
  const [w1] = (await saveWarranties(project.id, [warranty()])).body.configuration.warranties.map((item) => item.id);
  const document = await insertDocument({ folderId: project.folders["documents.warranties"], projectId: project.id });

  const same = await Promise.all([1, 2, 3, 4].map(() => link("PUT", project.id, w1, document.fileId)));
  assert.deepEqual(same.map((result) => [result.status, result.body.changed]).sort(), [[200, false], [200, false], [200, false], [200, true]]);
  assert.equal((await rows("select count(*)::int as total from public.project_warranty_documents where file_id = $1", [document.fileId]))[0].total, 1);

  // Mover fuera y vincular otra garantía a la vez: el resultado final siempre respeta la regla.
  const other = await insertDocument({ folderId: project.folders["documents.warranties"], projectId: project.id });
  const [, w2] = (await saveWarranties(project.id, [warranty({ id: w1 }), warranty({ code: "2" })])).body.configuration.warranties.map((item) => item.id);
  const [moved, linked] = await Promise.all([
    api(`/admin/projects/${project.id}/configuration/files/${other.fileId}`, { body: { folderId: project.folders.documents }, method: "PATCH" }),
    link("PUT", project.id, w2, other.fileId),
  ]);
  assert.ok([200, 409].includes(moved.status) && [200, 409].includes(linked.status), JSON.stringify([moved.body, linked.body]));
  const [state] = await rows(`select f.folder_id::int, exists (select 1 from public.project_warranty_documents where file_id = f.id and unlinked_at is null) as linked
    from public.files f where f.id = $1`, [other.fileId]);
  assert.ok(!state.linked || state.folder_id === project.folders["documents.warranties"], "nunca vinculado fuera de Garantías");

  // Guardar sin ids mientras se vincula: o se vincula primero y el guardado responde 409, o al revés.
  const third = await insertDocument({ folderId: project.folders["documents.warranties"], projectId: project.id });
  const results = await Promise.all([saveWarranties(project.id, [warranty()]), link("PUT", project.id, w1, third.fileId)]);
  assert.ok(results.every((result) => [200, 409].includes(result.status)), JSON.stringify(results.map((result) => result.body)));

  // Rollback: si la auditoría falla, el vínculo no existe.
  const fresh = await createProject();
  const [fw] = (await saveWarranties(fresh.id, [warranty()])).body.configuration.warranties;
  const freshDocument = await insertDocument({ folderId: fresh.folders["documents.warranties"], projectId: fresh.id });
  await rows(`create function test_fail_link_audit() returns trigger language plpgsql as $$
    begin if new.action = 'project_warranty_document.linked' then raise exception 'fallo simulado'; end if; return new; end $$`);
  await rows("create trigger test_fail_link_audit before insert on public.audit_logs for each row execute function test_fail_link_audit()");
  try {
    assert.equal((await link("PUT", fresh.id, fw.id, freshDocument.fileId)).status, 500);
  } finally {
    await rows("drop trigger test_fail_link_audit on public.audit_logs; drop function test_fail_link_audit()");
  }
  assert.equal((await rows("select count(*)::int as total from public.project_warranty_documents where file_id = $1", [freshDocument.fileId]))[0].total, 0);
});
