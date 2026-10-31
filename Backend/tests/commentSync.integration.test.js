import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

// P1-1: lectura incremental de comentarios con `syncCursor` contra PostgreSQL real. Opcional y
// aislada: ARCA_COMMENT_SYNC_DB_TESTS=1 y ARCA_COMMENT_SYNC_TEST_DATABASE_URL (solo localhost).
const enabled = process.env.ARCA_COMMENT_SYNC_DB_TESTS === "1";
const skip = !enabled && "Requiere PostgreSQL local, ARCA_COMMENT_SYNC_DB_TESTS=1 y ARCA_COMMENT_SYNC_TEST_DATABASE_URL.";

let database;
let modules;
let seed;

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({ baseUrl: process.env.ARCA_COMMENT_SYNC_TEST_DATABASE_URL, prefix: "arca_comment_sync" });
  Object.assign(process.env, { DATABASE_URL: database.databaseUrl, NODE_ENV: "test" });
  modules = {
    ...(await import("../src/config/db.js")),
    ...(await import("../src/repositories/projectCommentRepository.js")),
    ...(await import("../src/utils/pagination.js")),
  };
  const { client } = database;
  const roleId = (await client.query("insert into public.roles (code, name) values ('admin', 'Admin prueba') returning id")).rows[0].id;
  const clientId = (await client.query(`insert into public.clients (name, email, phone, address, city, country)
    values ('Cliente prueba', 'cliente@example.test', '+584120000002', 'Prueba', 'Caracas', 'VE') returning id`)).rows[0].id;
  const userId = Number((await client.query(`insert into public.users (role_id, client_id, email, first_name, last_name, password_hash, phone)
    values ($1, $2, 'sync@example.test', 'Prueba', 'Sync', '!login-disabled!', '+584120000001') returning id`, [roleId, clientId])).rows[0].id);
  const projectId = Number((await client.query(`insert into public.projects
    (client_id, created_by, assigned_architect_id, name, status, start_date, project_type, location, public_slug, progress)
    values ($1, $2, $2, 'sync', 'in_process', '2026-01-01', 'residential', 'Caracas', 'sync', 10) returning id`, [clientId, userId])).rows[0].id);
  seed = { projectId, user: { clientId: Number(clientId), id: userId, role: { code: "admin" } }, userId };
});

after(async () => {
  if (!enabled) return;
  await modules?.pool.end();
  await database?.drop();
});

/**
 * Lee todas las páginas desde un cursor, como hace el cliente.
 *
 * @param {string|null} start - Cursor opaco inicial.
 * @returns {Promise<{ comments: Array<object>, syncCursor: string|null }>} Comentarios y último syncCursor.
 */
async function readFrom(start) {
  const { decodeCursor, listProjectComments } = modules;
  // Deduplica por id como collectCursorPages: el cursor de página guarda milisegundos y created_at
  // tiene microsegundos, así que el último elemento de una página puede repetirse en la siguiente.
  const commentsById = new Map();
  let cursor = start;
  let syncCursor = null;
  do {
    const page = await listProjectComments(seed.projectId, seed.user, { cursor: decodeCursor(cursor), limit: 2 });
    for (const comment of page.items) commentsById.set(String(comment.id), comment);
    syncCursor = page.syncCursor || syncCursor;
    cursor = page.nextCursor;
  } while (cursor);
  return { comments: [...commentsById.values()], syncCursor };
}

test("syncCursor devuelve solo la ventana reciente y los comentarios nuevos", { skip }, async () => {
  const { createProjectCommentRecord } = modules;
  const { client } = database;
  // Historial antiguo: fuera de la ventana de solapamiento, no debe volver a descargarse.
  await client.query(`insert into public.project_comments (project_id, user_id, content, comment_type, status, created_at)
    select $1, $2, 'histórico ' || n, 'general', 'active', now() - interval '1 day' + n * interval '5 minutes'
    from generate_series(1, 5) n`, [seed.projectId, seed.userId]);

  const initial = await readFrom(null);
  assert.equal(initial.comments.length, 5);
  assert.ok(initial.syncCursor);

  const created = await createProjectCommentRecord({ content: "nuevo", projectId: seed.projectId, user: seed.user });
  const incremental = await readFrom(initial.syncCursor);
  // Solo la ventana de solapamiento (el último ya sincronizado) y el comentario nuevo; el resto del
  // historial no se vuelve a descargar.
  assert.deepEqual(incremental.comments.map((comment) => comment.content), ["histórico 5", "nuevo"]);
  assert.ok(created);
  assert.ok(incremental.syncCursor);
});

test("un comentario confirmado tarde con fecha anterior no se pierde gracias al solapamiento", { skip }, async () => {
  const { client } = database;
  const synced = await readFrom(null);
  // Simula la carrera: otra transacción empezó hace 20 s y confirma ahora, con created_at anterior
  // al último comentario ya sincronizado.
  await client.query(`insert into public.project_comments (project_id, user_id, content, comment_type, status, created_at)
    values ($1, $2, 'confirmado tarde', 'general', 'active', now() - interval '20 seconds')`, [seed.projectId, seed.userId]);
  const incremental = await readFrom(synced.syncCursor);
  assert.ok(incremental.comments.some((comment) => comment.content === "confirmado tarde"));
});
