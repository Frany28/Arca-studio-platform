import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

// Regresión: la página 2 de Gestión de usuarios llegaba vacía cuando los usuarios compartían
// `created_at` en el mismo milisegundo (p. ej. creados en una transacción). El cursor guardaba la
// fecha truncada a milisegundos y `(created_at, id) < cursor` excluía todas esas filas.
// Opcional y aislada: ARCA_ADMIN_USERS_DB_TESTS=1 y ARCA_ADMIN_USERS_TEST_DATABASE_URL (solo localhost).
const enabled = process.env.ARCA_ADMIN_USERS_DB_TESTS === "1";
const skip = !enabled && "Requiere PostgreSQL local, ARCA_ADMIN_USERS_DB_TESTS=1 y ARCA_ADMIN_USERS_TEST_DATABASE_URL.";

let database;
let modules;
let seed;

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({ baseUrl: process.env.ARCA_ADMIN_USERS_TEST_DATABASE_URL, prefix: "arca_admin_users" });
  Object.assign(process.env, { DATABASE_URL: database.databaseUrl, NODE_ENV: "test" });
  modules = {
    ...(await import("../src/config/db.js")),
    ...(await import("../src/services/adminUserService.js")),
  };
  const { client } = database;
  const roleId = (await client.query("insert into public.roles (code, name) values ('admin', 'Admin prueba') returning id")).rows[0].id;
  // Una sola sentencia: now() es idéntico para las doce filas, como en un alta por lotes.
  const users = await client.query(`
    insert into public.users (role_id, email, first_name, last_name, password_hash, phone)
    select $1, 'usuario' || n || '@example.test', 'Usuario', 'N' || n, '!login-disabled!', '+5841200000' || lpad(n::text, 2, '0')
    from generate_series(1, 12) as n
    returning id
  `, [roleId]);
  const ids = users.rows.map((row) => Number(row.id));
  const [adminId, targetId] = ids;
  await client.query(`
    insert into public.admin_user_notes (admin_user_id, target_user_id, content)
    select $1, $2, 'Nota ' || n from generate_series(1, 30) as n
  `, [adminId, targetId]);
  seed = { adminId, ids, targetId };
});

after(async () => {
  if (!enabled) return;
  await modules?.pool.end();
  await database?.drop();
});

test("la segunda página de usuarios incluye a los creados en el mismo milisegundo", { skip }, async () => {
  const first = await modules.getAdminUsersPage({ limit: 10 });
  assert.equal(first.users.length, 10);
  assert.ok(first.nextCursor);
  const second = await modules.getAdminUsersPage({ cursor: first.nextCursor, limit: 10 });
  assert.equal(second.users.length, 2, "la página 2 no llega vacía");
  assert.equal(second.nextCursor, null);
  const seen = [...first.users, ...second.users].map((user) => Number(user.id));
  assert.equal(new Set(seen).size, 12, "sin repeticiones ni omisiones");
  assert.deepEqual([...seen].sort((a, b) => a - b), [...seed.ids].sort((a, b) => a - b));
});

test("las notas de un usuario recorren todas sus páginas sin omitir notas del mismo instante", { skip }, async () => {
  const seen = [];
  let cursor;
  do {
    const page = await modules.getAdminUserNotesPage({ actorUserId: seed.adminId, query: { cursor, limit: 25 }, userId: seed.targetId });
    seen.push(...page.notes.map((note) => Number(note.id)));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.length, 30);
  assert.equal(new Set(seen).size, 30);
});
