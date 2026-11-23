import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

/*
 * Sincronización de carpetas y clasificación documental contra PostgreSQL real (todas las migraciones).
 * Opcional y local, con la misma base que el administrador de archivos:
 *   ARCA_FILE_MANAGER_DB_TESTS=1
 *   ARCA_FILE_MANAGER_TEST_DATABASE_URL=postgres://postgres@localhost:54329/postgres
 * Base propia eliminada al terminar; nunca lee .env ni toca el almacenamiento. Cubre plan sin
 * escrituras, aplicación idempotente, conflicto con una carpeta personalizada, índices únicos reales,
 * archivos y versiones intactos, auditoría y la ubicación automática al convertir una solicitud.
 */

const enabled = process.env.ARCA_FILE_MANAGER_DB_TESTS === "1" && process.env.ARCA_FILE_MANAGER_TEST_DATABASE_URL;
const skip = !enabled && "Requiere PostgreSQL local, ARCA_FILE_MANAGER_DB_TESTS=1 y ARCA_FILE_MANAGER_TEST_DATABASE_URL.";
const NEW_KEYS = ["documents.quotes", "documents.records", "documents.plans", "documents.additional"];

let database;
let sync;
let folders;
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
 * Crea un proyecto con el árbol del catálogo anterior: crea el actual y retira (borrado lógico) las
 * carpetas de las categorías documentales nuevas, como un proyecto registrado antes de ampliarlo.
 *
 * @param {string} name - Nombre.
 * @returns {Promise<{ id: number, folders: Record<string, number> }>} Proyecto y carpetas vigentes por clave.
 */
async function createLegacyProject(name) {
  const [project] = await rows(`insert into public.projects (client_id, created_by, name, status, public_slug, start_date, project_type, location, has_plans)
    values ($1, $2, $3, 'in_process', $4, '2026-11-01', 'residential', 'Caracas', false) returning id::int`, [seed.client, seed.admin, name, `sync-${randomUUID()}`]);
  await database.client.query("begin");
  await folders.ensureProjectSystemFolders(database.client, { createdBy: seed.admin, projectId: project.id });
  await database.client.query("commit");
  await rows("update public.project_folders set deleted_at = now() where project_id = $1 and system_key = any($2::text[])", [project.id, NEW_KEYS]);
  const byKey = Object.fromEntries((await rows("select system_key, id::int from public.project_folders where project_id = $1 and system_key is not null and deleted_at is null", [project.id])).map((row) => [row.system_key, row.id]));
  return { folders: byKey, id: project.id };
}

/**
 * Registra un archivo con una versión, opcionalmente adjunto de una solicitud de origen.
 *
 * @param {object} options - Proyecto, nombre, categoría, carpeta y solicitud.
 * @returns {Promise<number>} Id del archivo.
 */
async function insertFile({ category, folderId = null, name, projectId, requestId = null }) {
  const [file] = await rows(`insert into public.files (project_id, folder_id, uploaded_by, title, file_type, file_category, current_version, origin_project_request_id)
    values ($1, $2, $3, $4, 'application/octet-stream', $5::public.file_category, 1, $6) returning id::int`, [projectId, folderId, seed.admin, name, category, requestId]);
  await rows(`insert into public.file_versions (file_id, uploaded_by, version_number, file_name, original_name, file_url, file_extension, file_size, is_current)
    values ($1, $2, 1, $3, $4, 's3://ficticio', 'bin', 10, true)`, [file.id, seed.admin, `projects/${projectId}/files/${file.id}/v1/${name}`, name]);
  return file.id;
}

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({ recordMigrations: true, baseUrl: process.env.ARCA_FILE_MANAGER_TEST_DATABASE_URL, prefix: "arca_folder_sync" });
  process.env.DATABASE_URL = database.databaseUrl;
  sync = await import("../src/services/projectFolderSyncService.js");
  folders = await import("../src/repositories/projectSystemFolderRepository.js");
  const roleId = async (code) => Number((await rows("insert into public.roles (code, name) values ($1, $1) returning id", [code]))[0].id);
  const admin = await roleId("admin");
  seed.client = Number((await rows("insert into public.clients (name, email) values ('Cliente Sync', 'sync@arca.test') returning id"))[0].id);
  seed.admin = Number((await rows(`insert into public.users (role_id, email, first_name, last_name, password_hash, status)
    values ($1, 'admin@sync.test', 'Ana', 'Admin', '!disabled!', 'active') returning id`, [admin]))[0].id);
  const [request] = await rows(`insert into public.project_requests (client_id, requested_by, project_name, project_type, location, description, status)
    values ($1, $2, 'Solicitud', 'residential', 'Caracas', 'Descripción', 'pending_review') returning id::int`, [seed.client, seed.admin]);
  seed.quinta = await createLegacyProject("Quinta");
  seed.apto = await createLegacyProject("Apartamento");
  const [custom] = await rows(`insert into public.project_folders (project_id, parent_id, name, created_by)
    values ($1, $2, 'Cotizaciones', $3) returning id::int`, [seed.apto.id, seed.apto.folders.documents, seed.admin]);
  seed.customQuotes = custom.id;
  seed.files = {
    attachment: await insertFile({ category: "image", name: "fachada-cliente.jpg", projectId: seed.quinta.id, requestId: request.id }),
    image: await insertFile({ category: "image", name: "render.png", projectId: seed.quinta.id }),
    panorama: await insertFile({ category: "panorama", name: "sala-360.jpg", projectId: seed.quinta.id }),
    placed: await insertFile({ category: "document", folderId: seed.quinta.folders["documents.initial_proposal"], name: "propuesta.pdf", projectId: seed.quinta.id }),
    video: await insertFile({ category: "video", name: "recorrido.mp4", projectId: seed.quinta.id }),
  };
});

after(async () => {
  if (!enabled) return;
  await database?.drop();
});

test("plan, aplicación idempotente y verificación sobre PostgreSQL real, sin perder archivos ni versiones", { skip }, async () => {
  const snapshot = async () => ({
    files: await rows("select id::int, folder_id::int, file_category::text, current_version from public.files order by id"),
    versions: await rows("select id::int, file_id::int, file_name, file_size::int from public.file_versions order by id"),
  });
  const before = await snapshot();
  const text = sync.serializeFolderSyncPlan(await sync.buildFolderSyncPlan(database.client, { target: "arca@test" }));
  const planSha256 = (await import("../src/services/projectFileCompatibilityService.js")).sha256(text);
  const plan = sync.readFolderSyncPlan(text, planSha256);
  assert.deepEqual(await snapshot(), before, "el plan no escribe");
  const quinta = plan.projects.find((project) => project.projectId === seed.quinta.id);
  const apto = plan.projects.find((project) => project.projectId === seed.apto.id);
  assert.deepEqual(quinta.createFolders, NEW_KEYS);
  assert.deepEqual(quinta.classify.map((file) => [file.fileId, file.folderKey]), [[seed.files.attachment, "client_files"]]);
  assert.deepEqual(quinta.pending.map((file) => file.fileId).sort(), [seed.files.image, seed.files.panorama, seed.files.video].sort());
  assert.deepEqual(apto.conflicts.map((conflict) => [conflict.systemKey, conflict.folderId]), [["documents.quotes", seed.customQuotes]]);

  const run = await sync.applyFolderSyncPlan(database.client, { operatorUserId: seed.admin, plan, planSha256, target: "arca@test" });
  assert.deepEqual(run.summary, { classifiedFiles: 1, createdFolders: 7, errors: 0, projects: 2 });
  const after = await snapshot();
  assert.deepEqual(after.versions, before.versions, "versiones y objetos intactos");
  assert.equal(after.files.length, before.files.length);
  const clientFiles = (await rows("select id::int from public.project_folders where project_id = $1 and system_key = 'client_files' and deleted_at is null", [seed.quinta.id]))[0].id;
  assert.equal(after.files.find((file) => file.id === seed.files.attachment).folder_id, clientFiles);
  assert.equal(after.files.find((file) => file.id === seed.files.placed).folder_id, seed.quinta.folders["documents.initial_proposal"]);
  assert.deepEqual(await rows("select name, system_key, deleted_at from public.project_folders where id = $1", [seed.customQuotes]), [{ deleted_at: null, name: "Cotizaciones", system_key: null }]);
  assert.equal((await rows("select count(*)::int as n from public.project_folders where project_id = $1 and system_key = 'documents.quotes' and deleted_at is null", [seed.apto.id]))[0].n, 0);
  assert.equal((await rows("select count(*)::int as n from public.audit_logs where action = 'project_folders.synchronized'"))[0].n, 2);

  const again = await sync.applyFolderSyncPlan(database.client, { operatorUserId: seed.admin, plan, planSha256, target: "arca@test" });
  assert.deepEqual(again.summary, { classifiedFiles: 0, createdFolders: 0, errors: 0, projects: 2 });
  assert.equal((await sync.verifyFolderSync(database.client, { target: "arca@test" })).ok, true);
});
