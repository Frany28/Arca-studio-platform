import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

import pg from "pg";

import { applyMigration, createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";
import { PROJECT_SYSTEM_FOLDERS } from "../src/domain/projectFolderCatalog.js";

/*
 * Carpetas predeterminadas de proyectos draft contra PostgreSQL real (Fase 1.2). Opcional y local:
 *   ARCA_PROJECT_FOLDERS_DB_TESTS=1
 *   ARCA_PROJECT_FOLDERS_TEST_DATABASE_URL=postgres://postgres@localhost:54329/postgres
 * Aplica el historial hasta antes de la migración, registra datos previos, ejecuta preflight,
 * migración y postcheck, y ensaya las tres rutas de alta (manual, cotización y aprobación) con
 * repetición, concurrencia, rollback y protección. Datos ficticios; nunca lee .env.
 */

const MIGRATION = "20261117120000_project_folder_system_keys";
const enabled = process.env.ARCA_PROJECT_FOLDERS_DB_TESTS === "1" && process.env.ARCA_PROJECT_FOLDERS_TEST_DATABASE_URL;
const skip = !enabled && "Requiere PostgreSQL local, ARCA_PROJECT_FOLDERS_DB_TESTS=1 y ARCA_PROJECT_FOLDERS_TEST_DATABASE_URL.";

let database;
let db;
let quotes;
let configuration;
let workflow;
let systemFolders;
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
 * Ejecuta un archivo de comprobación (preflight o postcheck) y devuelve todas sus filas.
 *
 * @param {"preflight"|"postcheck"} name - Archivo.
 * @returns {Promise<Array<object>>} Filas de todas las consultas.
 */
async function runCheck(name) {
  const source = await readFile(new URL(`../prisma/checks/${MIGRATION}/${name}.sql`, import.meta.url), "utf8");
  const results = await database.client.query(source.replace(/^\\.*$/gm, ""));
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
  for (const row of checkRows) {
    for (const [key, value] of Object.entries(row)) {
      if (key.startsWith("ok_")) assert.equal(value, true, `${label}: ${row.name || row.table_name || ""}.${key}`);
    }
  }
}

/**
 * Lee el árbol de carpetas predeterminadas de un proyecto con la clave de su madre.
 *
 * @param {number} projectId - Proyecto.
 * @returns {Promise<Array<{ id: number, system_key: string, name: string, parent_key: string|null }>>} Carpetas.
 */
function systemTree(projectId) {
  return rows(`select folder.id::int, folder.system_key, folder.name, parent.system_key as parent_key
    from public.project_folders folder left join public.project_folders parent on parent.id = folder.parent_id
    where folder.project_id = $1 and folder.system_key is not null order by folder.id`, [projectId]);
}

/**
 * Comprueba que un proyecto tenga exactamente el árbol del catálogo, en su orden de creación.
 *
 * @param {number} projectId - Proyecto.
 * @returns {Promise<void>}
 */
async function assertCatalogTree(projectId) {
  const tree = await systemTree(projectId);
  assert.equal(tree.length, PROJECT_SYSTEM_FOLDERS.length);
  const expected = new Map(PROJECT_SYSTEM_FOLDERS.map((folder) => [folder.key, folder]));
  for (const folder of tree) {
    const definition = expected.get(folder.system_key);
    assert.ok(definition, folder.system_key);
    assert.equal(folder.name, definition.name, `nombre de ${folder.system_key}`);
    assert.equal(folder.parent_key, definition.parentKey, `madre de ${folder.system_key}`);
  }
}

/**
 * Crea una solicitud lista para decidir (pending_review) del cliente de prueba.
 *
 * @param {string} name - Nombre del proyecto solicitado.
 * @returns {Promise<number>} Id de la solicitud.
 */
async function createPendingRequest(name) {
  const [request] = await rows(`insert into public.project_requests (client_id, requested_by, project_name, project_type, location, description, status)
    values ($1, $2, $3, 'residential', 'Caracas', 'Descripción de prueba', 'pending_review') returning id::int`, [ids.client, ids.clientUser, name]);
  const [file] = await rows(`insert into public.files (project_request_id, uploaded_by, title, file_type, current_version)
    values ($1, $2, 'plano.pdf', 'application/pdf', 1) returning id::int`, [request.id, ids.clientUser]);
  await rows(`insert into public.file_versions (file_id, uploaded_by, version_number, file_name, original_name, file_url, file_extension, file_size)
    values ($1, $2, 1, 'project-requests/x/plano.pdf', 'plano.pdf', 's3://ficticio/plano.pdf', 'pdf', 10)`, [file.id, ids.clientUser]);
  return request.id;
}

/**
 * Crea una cotización con un proyecto draft nuevo mediante el servicio real.
 *
 * @param {string} newProjectName - Nombre del proyecto nuevo.
 * @returns {Promise<object>} Resultado de createQuote.
 */
function createDraftQuote(newProjectName) {
  return quotes.createQuote({
    payload: { clientId: ids.client, items: [{ quantity: "1.000", serviceId: ids.service, unitRate: "10.00" }], newProjectName, notes: null, submissionId: randomUUID() },
    user: { id: ids.admin },
  });
}

/**
 * Instala un disparador que hace fallar la creación de la última carpeta del catálogo, para
 * comprobar que proyecto y carpetas se revierten juntos.
 *
 * @returns {Promise<() => Promise<void>>} Función que retira el disparador.
 */
async function failFolderCreation() {
  await database.client.query(`create function public.test_fail_folder() returns trigger language plpgsql as $$
    begin
      if new.system_key = 'client_files' then raise exception 'fallo simulado de carpeta' using errcode = 'P0001'; end if;
      return new;
    end $$`);
  await database.client.query("create trigger test_fail_folder before insert on public.project_folders for each row execute function public.test_fail_folder()");
  return async () => {
    await database.client.query("drop trigger test_fail_folder on public.project_folders");
    await database.client.query("drop function public.test_fail_folder()");
  };
}

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({
    baseUrl: process.env.ARCA_PROJECT_FOLDERS_TEST_DATABASE_URL,
    createApiRoles: true,
    prefix: "arca_project_folders",
    stopBefore: MIGRATION,
  });
  const [adminRole] = await rows("insert into public.roles (code, name) values ('admin', 'Administrador') returning id");
  const [clientRole] = await rows("insert into public.roles (code, name) values ('client', 'Cliente') returning id");
  const [admin] = await rows(`insert into public.users (role_id, email, first_name, last_name, password_hash)
    values ($1, 'admin@folders.test', 'Admin', 'Carpetas', '!disabled!') returning id::int`, [adminRole.id]);
  const [client] = await rows("insert into public.clients (name, email) values ('Cliente Carpetas', 'cliente@folders.test') returning id::int");
  const [clientUser] = await rows(`insert into public.users (role_id, client_id, email, first_name, last_name, password_hash)
    values ($1, $2, 'usuario@folders.test', 'Cliente', 'Carpetas', '!disabled!') returning id::int`, [clientRole.id, client.id]);
  // Proyecto anterior a la migración con una carpeta personalizada llamada como una predeterminada.
  const [legacy] = await rows(`insert into public.projects (client_id, created_by, name, status, public_slug)
    values ($1, $2, 'Draft anterior', 'draft', 'draft-anterior-folders') returning id::int`, [client.id, admin.id]);
  await rows("insert into public.project_folders (project_id, name, created_by) values ($1, 'Documentos', $2)", [legacy.id, admin.id]);

  checks.preflight = await runCheck("preflight");
  await applyMigration(database.client, MIGRATION);
  // El helper aplica el SQL sin Prisma: se registra la migración como lo haría `migrate deploy`.
  await rows(`insert into public._prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count)
    values ($1, 'ensayo-local', $2, now(), 1)`, [randomUUID(), MIGRATION]);
  checks.postcheck = await runCheck("postcheck");

  const [unit] = await rows("select id::int from public.measurement_units where code = 'square_meter'");
  Object.assign(process.env, { DATABASE_POOL_MAX: "8", DATABASE_URL: database.databaseUrl, NODE_ENV: "test" });
  db = await import("../src/config/db.js");
  quotes = await import("../src/services/quoteService.js");
  configuration = await import("../src/services/projectConfigurationService.js");
  workflow = await import("../src/repositories/projectRequestWorkflowRepository.js");
  systemFolders = await import("../src/repositories/projectSystemFolderRepository.js");
  const catalog = await import("../src/services/serviceCatalogService.js");
  const service = await catalog.createService({
    payload: { changeNote: null, description: null, isActive: true, measurementUnitId: unit.id, name: "Anteproyecto", referenceRate: "10.00", sortOrder: 0 },
    user: { id: admin.id },
  });
  ids = { admin: admin.id, client: client.id, clientUser: clientUser.id, legacy: legacy.id, service: service.id };
});

after(async () => {
  await db?.pool.end().catch(() => {});
  if (database) await database.drop();
});

test("migración: preflight y postcheck correctos, datos existentes intactos y sin carpetas nuevas", { skip }, async () => {
  assertAllOk(checks.preflight, "preflight");
  assertAllOk(checks.postcheck, "postcheck");
  const before = checks.preflight.find((row) => row.table_name === "project_folders");
  const afterMigration = checks.postcheck.find((row) => row.table_name === "project_folders");
  assert.deepEqual([afterMigration.row_count, afterMigration.fingerprint], [before.row_count, before.fingerprint]);
  // Los proyectos existentes no reciben carpetas: su tratamiento depende de la compatibilidad.
  assert.deepEqual(await systemTree(ids.legacy), []);
});

test("alta manual: el draft nace con las 17 carpetas del catálogo", { skip }, async () => {
  const { projectId } = await configuration.createManualDraftProject({ clientId: ids.client, name: "Casa manual", user: { id: ids.admin } });
  await assertCatalogTree(projectId);
  const [creator] = await rows("select bool_and(created_by = $2) as ok from public.project_folders where project_id = $1", [projectId, ids.admin]);
  assert.equal(creator.ok, true);
  // El orden de creación sigue el catálogo: la portada es la primera carpeta del proyecto.
  assert.equal((await systemTree(projectId))[0].system_key, "cover");
});

test("cotización: el draft creado al guardar la cotización nace con las 17 carpetas", { skip }, async () => {
  const { quote } = await createDraftQuote("Casa cotizada");
  await assertCatalogTree(quote.project.id);
});

test("aprobación: el draft de una solicitud aprobada nace con las 17 carpetas y conserva sus adjuntos", { skip }, async () => {
  const requestId = await createPendingRequest("Casa solicitada");
  const result = await workflow.decideProjectRequest({ action: "approve", internalNotes: null, projectRequestId: requestId, reason: null, reviewedBy: ids.admin });
  assert.equal(result.outcome, "updated", JSON.stringify(result));
  const [request] = await rows("select status, converted_project_id::int from public.project_requests where id = $1", [requestId]);
  assert.equal(request.status, "converted");
  await assertCatalogTree(request.converted_project_id);
  // El adjunto pasa al proyecto como antes y queda sin carpeta: su ubicación es una decisión pendiente.
  const [attachment] = await rows("select project_id::int, folder_id, origin_project_request_id::int from public.files where origin_project_request_id = $1", [requestId]);
  assert.deepEqual(attachment, { folder_id: null, origin_project_request_id: requestId, project_id: request.converted_project_id });
});

test("repetición y concurrencia: una sola carpeta por clave y proyecto", { skip }, async () => {
  const { projectId } = await configuration.createManualDraftProject({ clientId: ids.client, name: "Casa concurrente", user: { id: ids.admin } });
  // Repetir la operación en transacciones simultáneas no duplica ni falla.
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => db.withTransaction((client) => systemFolders.ensureProjectSystemFolders(client, { createdBy: ids.admin, projectId }))));
  assert.deepEqual(results.map((result) => result.created), [0, 0, 0, 0, 0]);
  await assertCatalogTree(projectId);

  // Un proyecto sin carpetas (insertado directamente) recibe exactamente un árbol aunque se pida a la vez.
  const [bare] = await rows(`insert into public.projects (client_id, created_by, name, status, public_slug)
    values ($1, $2, 'Sin carpetas', 'draft', 'sin-carpetas-folders') returning id::int`, [ids.client, ids.admin]);
  const concurrent = await Promise.all([1, 2, 3, 4].map(() => db.withTransaction((client) => systemFolders.ensureProjectSystemFolders(client, { createdBy: ids.admin, projectId: bare.id }))));
  assert.equal(concurrent.reduce((sum, result) => sum + result.created, 0), 17);
  await assertCatalogTree(bare.id);

  // El índice único es la última barrera: una segunda carpeta con la misma clave se rechaza.
  await assert.rejects(
    rows("insert into public.project_folders (project_id, name, system_key, created_by) values ($1, 'Otra portada', 'cover', $2)", [projectId, ids.admin]),
    { code: "23505", constraint: "uq_project_folders_system_key" },
  );
});

test("rollback: si falla una carpeta, ninguna de las tres rutas deja proyecto, carpetas ni cambios", { skip }, async () => {
  const restore = await failFolderCreation();
  try {
    const projectsBefore = (await rows("select count(*)::int as count from public.projects"))[0].count;
    const foldersBefore = (await rows("select count(*)::int as count from public.project_folders"))[0].count;

    await assert.rejects(configuration.createManualDraftProject({ clientId: ids.client, name: "Casa revertida manual", user: { id: ids.admin } }));
    await assert.rejects(createDraftQuote("Casa revertida cotización"));
    const requestId = await createPendingRequest("Casa revertida solicitud");
    await assert.rejects(workflow.decideProjectRequest({ action: "approve", internalNotes: null, projectRequestId: requestId, reason: null, reviewedBy: ids.admin }));

    assert.equal((await rows("select count(*)::int as count from public.projects"))[0].count, projectsBefore);
    assert.equal((await rows("select count(*)::int as count from public.project_folders"))[0].count, foldersBefore);
    assert.equal((await rows("select count(*)::int as count from public.quote_versions where project_name like 'Casa revertida%'"))[0].count, 0);
    const [request] = await rows("select status, converted_project_id from public.project_requests where id = $1", [requestId]);
    assert.deepEqual([request.status, request.converted_project_id], ["pending_review", null]);
  } finally {
    await restore();
  }
});

test("protección: las carpetas predeterminadas no se renombran ni eliminan; las personalizadas sí", { skip }, async () => {
  const { projectId } = await configuration.createManualDraftProject({ clientId: ids.client, name: "Casa protegida", user: { id: ids.admin } });
  const tree = await systemTree(projectId);
  const cover = tree.find((folder) => folder.system_key === "cover");
  const empty = tree.find((folder) => folder.system_key === "client_files");

  await assert.rejects(configuration.updateProjectFolder({ folderId: cover.id, name: "Otra", projectId }), { code: "PROJECT_FOLDER_PROTECTED" });
  await assert.rejects(configuration.deleteProjectFolder({ folderId: empty.id, projectId }), { code: "PROJECT_FOLDER_PROTECTED" });
  // PostgreSQL también impide retirar una carpeta predeterminada.
  await assert.rejects(rows("update public.project_folders set deleted_at = now() where id = $1", [empty.id]), { code: "23514", constraint: "chk_project_folders_system_not_deleted" });
  await assert.rejects(rows("update public.project_folders set system_key = 'Mal Formada' where id = $1", [empty.id]), { code: "23514", constraint: "chk_project_folders_system_key_format" });

  const custom = await configuration.createProjectFolder({ name: "Planos", parentId: null, projectId, user: { id: ids.admin } });
  assert.equal(custom.systemKey, null);
  const renamed = await configuration.updateProjectFolder({ folderId: custom.id, name: "Planos finales", projectId });
  const listed = renamed.folders.find((folder) => folder.id === custom.id);
  assert.deepEqual([listed.name, listed.systemKey], ["Planos finales", null]);
  assert.equal(renamed.folders.find((folder) => folder.id === cover.id).systemKey, "cover");
  await configuration.deleteProjectFolder({ folderId: custom.id, projectId });
  // Un nombre de carpeta predeterminada en la misma ubicación sigue rechazándose como duplicado.
  await assert.rejects(configuration.createProjectFolder({ name: "documentos", parentId: null, projectId, user: { id: ids.admin } }), { code: "VALIDATION_ERROR" });
});
