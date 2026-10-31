import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { after, before, test } from "node:test";

import { createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

// P0-1 contra PostgreSQL real: bloqueos FOR UPDATE, transacciones y un pool de 2 conexiones como en
// un servidor con base remota. Opcional y aislada: ARCA_UPLOAD_DB_TESTS=1 y
// ARCA_UPLOAD_TEST_DATABASE_URL (solo localhost). Crea una base propia con el historial completo de
// migraciones y la elimina al terminar; nunca usa DATABASE_URL del proyecto. El almacenamiento es un
// sustituto en memoria con transferencias que se pueden pausar.
const enabled = process.env.ARCA_UPLOAD_DB_TESTS === "1";
const skip = !enabled && "Requiere PostgreSQL local, ARCA_UPLOAD_DB_TESTS=1 y ARCA_UPLOAD_TEST_DATABASE_URL.";

let database;
let modules;
let seed;

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({ baseUrl: process.env.ARCA_UPLOAD_TEST_DATABASE_URL, prefix: "arca_uploads" });
  Object.assign(process.env, {
    DATABASE_POOL_MAX: "2",
    DATABASE_URL: database.databaseUrl,
    NODE_ENV: "test",
    SUPABASE_STORAGE_BUCKET: "test-bucket",
    SUPABASE_STORAGE_S3_ACCESS_KEY_ID: "test-access-key",
    SUPABASE_STORAGE_S3_ENDPOINT: "https://storage.test.local/s3",
    SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY: "test-secret-key",
  });
  modules = {
    ...(await import("../src/config/db.js")),
    ...(await import("../src/repositories/fileRepository.js")),
    ...(await import("../src/repositories/projectCommentRepository.js")),
    ...(await import("../src/services/objectStorage.js")),
    ...(await import("../src/services/projectRequestFileService.js")),
  };

  const { client } = database;
  const roleId = (await client.query("insert into public.roles (code, name) values ('admin', 'Admin prueba') returning id")).rows[0].id;
  const clientId = (await client.query(`insert into public.clients (name, email, phone, address, city, country)
    values ('Cliente prueba', 'cliente@example.test', '+584120000002', 'Prueba', 'Caracas', 'VE') returning id`)).rows[0].id;
  const userId = (await client.query(`insert into public.users (role_id, client_id, email, first_name, last_name, password_hash, phone)
    values ($1, $2, 'cargas@example.test', 'Prueba', 'Cargas', '!login-disabled!', '+584120000001') returning id`, [roleId, clientId])).rows[0].id;
  // Un fallo de PostgreSQL después de transferir el archivo, provocado solo por este nombre.
  await client.query(`
    create function public.test_fail_file_version() returns trigger language plpgsql as
    $$ begin
      if new.original_name = 'fallo-bd.pdf' then raise exception 'fallo simulado tras la transferencia'; end if;
      return new;
    end $$;
    create trigger test_fail_file_version before insert on public.file_versions
      for each row execute function public.test_fail_file_version();
  `);
  seed = {
    clientId: Number(clientId),
    userId: Number(userId),
    user: { clientId: Number(clientId), id: Number(userId), role: { code: "admin" } },
  };
});

after(async () => {
  if (!enabled) return;
  await modules?.pool.end();
  await database?.drop();
});

/**
 * Crea un proyecto en curso para una prueba, con nombre único.
 *
 * @param {string} name - Nombre del proyecto.
 * @returns {Promise<number>} Identificador del proyecto.
 */
async function createProject(name) {
  const result = await database.client.query(`insert into public.projects
    (client_id, created_by, assigned_architect_id, name, status, start_date, project_type, location, public_slug, progress)
    values ($1, $2, $2, $3, 'in_process', '2026-01-01', 'residential', 'Caracas', $3, 10) returning id`,
  [seed.clientId, seed.userId, name]);
  return Number(result.rows[0].id);
}

/**
 * Sustituye el almacenamiento por un mapa en memoria con una pausa opcional en cada transferencia.
 * Durante la pausa registra cuántas conexiones del pool están prestadas.
 *
 * @param {import("node:test").TestContext} context - Contexto que restaura los mocks.
 * @param {Promise<void>} [gate] - Promesa que libera las transferencias pausadas.
 * @returns {{ stored: Map<string, number>, deleted: Array<string>, borrowedDuringTransfer: Array<number> }} Estado.
 */
function memoryStorage(context, gate) {
  const state = { borrowedDuringTransfer: [], deleted: [], stored: new Map() };
  const { objectStorage, pool } = modules;
  context.mock.method(objectStorage, "put", async ({ body, key }) => {
    let bytes = 0;
    for await (const chunk of body) bytes += chunk.length;
    if (gate) await gate;
    state.borrowedDuringTransfer.push(pool.totalCount - pool.idleCount);
    state.stored.set(key, bytes);
    return {};
  });
  context.mock.method(objectStorage, "delete", async (key) => {
    state.deleted.push(key);
    state.stored.delete(key);
    return {};
  });
  return state;
}

/**
 * Crea una promesa controlable para pausar transferencias.
 *
 * @returns {{ promise: Promise<void>, resolve: Function }} Promesa y su resolución.
 */
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

/**
 * Prepara una carga de proyecto con un PDF mínimo.
 *
 * @param {number} projectId - Proyecto destino.
 * @param {string} name - Nombre original.
 * @returns {object} Opciones para uploadProjectFile.
 */
function projectUpload(projectId, name) {
  return { body: Readable.from([Buffer.from("%PDF-1.7")]), contentType: "application/pdf", originalName: name, projectId, size: 8, user: seed.user };
}

/**
 * Comprueba que no quedan objetos sin fila ni filas sin objeto para un conjunto de claves.
 *
 * @param {Map<string, number>} stored - Objetos almacenados por la prueba.
 * @param {number} projectId - Proyecto revisado.
 * @returns {Promise<void>}
 */
async function assertNoOrphans(stored, projectId) {
  const rows = await database.client.query(`select v.file_name from public.file_versions v
    inner join public.files f on f.id = v.file_id where f.project_id = $1 and f.deleted_at is null`, [projectId]);
  const recorded = new Set(rows.rows.map((row) => row.file_name));
  const storedForProject = [...stored.keys()].filter((key) => key.startsWith(`projects/${projectId}/`));
  assert.deepEqual(storedForProject.sort(), [...recorded].sort(), "cada objeto tiene su fila y cada fila su objeto");
}

/**
 * Comprueba que el pool no retiene conexiones ni tiene peticiones esperando.
 *
 * @returns {void}
 */
function assertPoolIdle() {
  const { pool } = modules;
  assert.equal(pool.totalCount - pool.idleCount, 0, "no quedan conexiones prestadas");
  assert.equal(pool.waitingCount, 0, "nadie espera una conexión");
}

test("cinco cargas simultáneas al mismo proyecto con un pool de 2 conexiones", { skip }, async (context) => {
  const projectId = await createProject("cinco-cargas");
  const gate = deferred();
  const storage = memoryStorage(context, gate.promise);
  const uploads = Array.from({ length: 5 }, (_, index) => modules.uploadProjectFile(projectUpload(projectId, `plano-${index}.pdf`)));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assertPoolIdle();
  gate.resolve();
  const results = await Promise.all(uploads);
  assert.equal(new Set(results.map((file) => file.id)).size, 5);
  assert.deepEqual([...new Set(storage.borrowedDuringTransfer)], [0], "ninguna transferencia retuvo una conexión");
  await assertNoOrphans(storage.stored, projectId);
  assertPoolIdle();
});

test("un comentario en el mismo proyecto no espera a una carga lenta", { skip }, async (context) => {
  const projectId = await createProject("comentario-durante-carga");
  const gate = deferred();
  const storage = memoryStorage(context, gate.promise);
  const uploads = Array.from({ length: 3 }, (_, index) => modules.uploadProjectFile(projectUpload(projectId, `lento-${index}.pdf`)));
  await new Promise((resolve) => setTimeout(resolve, 100));

  const startedAt = Date.now();
  const comment = await modules.createProjectCommentRecord({ content: "Observación durante la carga", projectId, user: seed.user });
  const elapsedMs = Date.now() - startedAt;
  assert.ok(comment, "el comentario se crea");
  assert.ok(elapsedMs < 1000, `el comentario tardó ${elapsedMs} ms`);

  gate.resolve();
  await Promise.all(uploads);
  await assertNoOrphans(storage.stored, projectId);
  assertPoolIdle();
});

test("cargas simultáneas con el mismo nombre: exactamente una se registra", { skip }, async (context) => {
  const projectId = await createProject("nombres-duplicados");
  const gate = deferred();
  const storage = memoryStorage(context, gate.promise);
  const uploads = ["Plano.pdf", "plano.pdf", "PLANO.PDF", "plano.pdf"].map((name) => modules.uploadProjectFile(projectUpload(projectId, name)));
  await new Promise((resolve) => setTimeout(resolve, 100));
  gate.resolve();
  const results = await Promise.allSettled(uploads);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.deepEqual([...new Set(results.filter((result) => result.status === "rejected").map((result) => result.reason.code))], ["DUPLICATE_PROJECT_FILE"]);
  assert.equal(storage.deleted.length, 3, "los objetos rechazados se eliminan");
  await assertNoOrphans(storage.stored, projectId);
  assertPoolIdle();
});

test("el proyecto se archiva durante la carga: el archivo no se registra y su objeto se elimina", { skip }, async (context) => {
  const projectId = await createProject("archivado-durante-carga");
  const gate = deferred();
  const storage = memoryStorage(context, gate.promise);
  const upload = modules.uploadProjectFile(projectUpload(projectId, "tardio.pdf"));
  await new Promise((resolve) => setTimeout(resolve, 100));
  // Sin bloqueo retenido por la carga, el archivado no espera a que termine la transferencia.
  const startedAt = Date.now();
  await database.client.query("update public.projects set status = 'archived', archived_from_status = 'in_process' where id = $1", [projectId]);
  assert.ok(Date.now() - startedAt < 1000);
  gate.resolve();
  await assert.rejects(upload, { code: "PROJECT_ARCHIVED", status: 409 });
  await assertNoOrphans(storage.stored, projectId);
  assertPoolIdle();
});

test("fallo de PostgreSQL después de transferir: sin filas parciales, objeto eliminado, pool libre", { skip }, async (context) => {
  const projectId = await createProject("fallo-bd");
  const storage = memoryStorage(context);
  await assert.rejects(modules.uploadProjectFile(projectUpload(projectId, "fallo-bd.pdf")), /fallo simulado/);
  const files = await database.client.query("select count(*)::integer as total from public.files where project_id = $1", [projectId]);
  assert.equal(files.rows[0].total, 0, "el archivo sin versión se revierte");
  assert.equal(storage.deleted.length, 1);
  await assertNoOrphans(storage.stored, projectId);
  assertPoolIdle();
});

test("solicitud: cargas simultáneas respetan el límite de 10 y un envío durante la carga la rechaza", { skip }, async (context) => {
  const { client } = database;
  const requestId = Number((await client.query(`insert into public.project_requests (client_id, requested_by, project_name, project_type, location, status)
    values ($1, $2, 'Solicitud de cargas', 'residential', 'Caracas', 'draft') returning id`, [seed.clientId, seed.userId])).rows[0].id);
  const upload = (name) => modules.uploadProjectRequestAttachment({
    projectRequestId: requestId,
    upload: { body: Readable.from([Buffer.from("%PDF-1.7")]), contentType: "application/pdf", originalName: name, size: 8 },
    user: seed.user,
  });
  const storage = memoryStorage(context);
  for (let index = 0; index < 8; index += 1) await upload(`previo-${index}.pdf`);
  context.mock.restoreAll();

  const gate = deferred();
  const concurrent = memoryStorage(context, gate.promise);
  const uploads = ["a.pdf", "b.pdf", "c.pdf"].map(upload);
  await new Promise((resolve) => setTimeout(resolve, 100));
  gate.resolve();
  const results = await Promise.allSettled(uploads);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "PROJECT_REQUEST_FILE_LIMIT");
  const total = await client.query("select count(*)::integer as total from public.files where project_request_id = $1 and deleted_at is null", [requestId]);
  assert.equal(total.rows[0].total, 10);
  assert.equal(concurrent.stored.size, 2);
  assert.equal(storage.stored.size, 8);
  context.mock.restoreAll();

  // Un envío mientras se transfiere otro adjunto: la carga se rechaza al registrar.
  // Se libera un hueco (borrado lógico) para que el límite no sea la causa del rechazo.
  await client.query(`update public.files set deleted_at = now(), status = 'deleted'
    where id = (select id from public.files where project_request_id = $1 and deleted_at is null order by id desc limit 1)`, [requestId]);
  const submitGate = deferred();
  const lateStorage = memoryStorage(context, submitGate.promise);
  const late = upload("tardio.pdf");
  await new Promise((resolve) => setTimeout(resolve, 100));
  await client.query("update public.project_requests set status = 'pending_review' where id = $1", [requestId]);
  submitGate.resolve();
  await assert.rejects(late, { code: "PROJECT_REQUEST_NOT_FOUND", status: 404 });
  assert.equal(lateStorage.stored.size, 0);
  assertPoolIdle();
});
