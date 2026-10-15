import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import bcrypt from "bcrypt";

// Sesiones revocables (B-3) contra PostgreSQL real. Opcional y aislada: ARCA_SESSION_DB_TESTS=1 y
// ARCA_SESSION_TEST_DATABASE_URL (solo localhost). Crea una base propia, aplica el historial completo
// de migraciones y la elimina al terminar; nunca usa DATABASE_URL del proyecto.
// ARCA_SESSION_TEST_CREATE_ROLES=1 crea los roles anon/authenticated/service_role como en Supabase
// para comprobar el REVOKE de la migración (solo en un clúster desechable).
const enabled = process.env.ARCA_SESSION_DB_TESTS === "1";
const skip = !enabled && "Requiere PostgreSQL local, ARCA_SESSION_DB_TESTS=1 y ARCA_SESSION_TEST_DATABASE_URL.";
const backendDirectory = fileURLToPath(new URL("../", import.meta.url));
const migrationsDirectory = new URL("../prisma/migrations/", import.meta.url);
const SECRET = "integration-secret-shared-by-all-session-instances";
const PASSWORD = "Segura2026*";

let admin;
let databaseUrl;
let databaseName;
let modules;
let ids;
const instances = [];

before(async () => {
  if (!enabled) return;
  const base = new URL(process.env.ARCA_SESSION_TEST_DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(base.hostname), "La prueba rechaza hosts remotos.");
  const { default: pg } = await import("pg");
  admin = new pg.Client({ connectionString: base.toString(), ssl: false });
  await admin.connect();
  databaseName = `arca_sessions_${randomUUID().replaceAll("-", "")}`;
  // Nombre generado internamente, sin entradas externas.
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  base.pathname = `/${databaseName}`;
  databaseUrl = base.toString();

  const setup = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await setup.connect();
  try {
    if (process.env.ARCA_SESSION_TEST_CREATE_ROLES === "1") {
      for (const role of ["anon", "authenticated", "service_role"]) {
        await setup.query(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
      }
      await setup.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role");
    }
    // Tabla de control que Prisma crea antes de migrar; la migración D-2 revoca privilegios sobre ella.
    await setup.query(`
      create table public._prisma_migrations (
        id varchar(36) primary key, checksum varchar(64) not null, finished_at timestamptz,
        migration_name varchar(255) not null, logs text, rolled_back_at timestamptz,
        started_at timestamptz not null default now(), applied_steps_count integer not null default 0
      )
    `);
    const migrations = (await readdir(migrationsDirectory)).filter((name) => /^\d{14}_/.test(name)).sort();
    for (const migration of migrations) {
      const sql = await readFile(new URL(`${migration}/migration.sql`, migrationsDirectory), "utf8");
      // Un valor de enum nuevo no puede usarse en la misma transacción implícita que lo crea:
      // se ejecuta por tramos tras cada ADD VALUE. No se usa la CLI de Prisma para no leer .env.
      for (const chunk of sql.split(/(?<=ADD VALUE[^;]*;)/i)) {
        if (chunk.trim()) await setup.query(chunk);
      }
    }
    // Mismo trigger que en Supabase: cualquier UPDATE de users renueva updated_at (causa de B3-3).
    await setup.query(`
      create or replace function public.test_touch_updated_at() returns trigger language plpgsql as
      $$ begin new.updated_at = now(); return new; end $$;
      create trigger update_users_updated_at before update on public.users
        for each row execute function public.test_touch_updated_at();
    `);
    const hash = await bcrypt.hash(PASSWORD, 4);
    const roles = await setup.query(`
      insert into public.roles (code, name) values ('admin', 'Administrador'), ('client', 'Cliente'), ('architect', 'Arquitecto')
      returning id, code
    `);
    const roleId = Object.fromEntries(roles.rows.map((row) => [row.code, row.id]));
    const users = await setup.query(`
      insert into public.users (role_id, email, first_name, last_name, password_hash, phone)
      values ($1, 'admin@arca.test', 'Admin', 'Prueba', $3, '+10000000001'),
             ($2, 'cliente@arca.test', 'Cliente', 'Prueba', $3, '+10000000002'),
             ($2, 'otro@arca.test', 'Otro', 'Prueba', $3, '+10000000003')
      returning id, email
    `, [roleId.admin, roleId.client, hash]);
    const userId = Object.fromEntries(users.rows.map((row) => [row.email, row.id]));
    ids = { admin: userId["admin@arca.test"], client: userId["cliente@arca.test"], other: userId["otro@arca.test"], roleId };
  } finally {
    await setup.end();
  }

  Object.assign(process.env, {
    AUTH_TOKEN_SECRET: SECRET,
    DATABASE_POOL_MAX: "10",
    DATABASE_URL: databaseUrl,
    NODE_ENV: "test",
    ROUTE_AUTH_DISABLED_FOR_TESTS: "false",
  });
  modules = {
    adminUsers: await import("../src/repositories/adminUserRepository.js"),
    db: await import("../src/config/db.js"),
    sessionRepository: await import("../src/repositories/sessionRepository.js"),
    sessionService: await import("../src/services/sessionService.js"),
    tokens: await import("../src/utils/tokens.js"),
    users: await import("../src/repositories/userRepository.js"),
  };
});

after(async () => {
  if (!enabled) return;
  for (const instance of instances) instance.kill();
  await modules?.db.pool.end().catch(() => {});
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).catch(() => {});
  await admin.end();
});

/**
 * Lee el payload de un JWT ya emitido por el backend.
 *
 * @param {string} token - JWT compacto.
 * @returns {object} Payload decodificado.
 */
function payloadOf(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

/**
 * Arranca la aplicación real en un proceso independiente (otra "instancia" de Vercel) con su propio
 * pool y memoria, y devuelve su URL base.
 *
 * @returns {Promise<string>} URL base de la instancia.
 */
async function startInstance() {
  const script = `
    const { default: app } = await import(${JSON.stringify(pathToFileURL(`${backendDirectory}src/app.js`).href)});
    const server = app.listen(0, "127.0.0.1", () => console.log("PORT" + server.address().port));
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    cwd: backendDirectory,
    env: { ...process.env, AUTH_LOGIN_RATE_LIMIT_MAX: "100", DATABASE_POOL_MAX: "3" },
  });
  instances.push(child);
  const port = await new Promise((resolve, reject) => {
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/PORT(\d+)/);
      if (match) resolve(Number(match[1]));
    });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("exit", (code) => reject(new Error(`La instancia terminó (${code}): ${output}`)));
    setTimeout(() => reject(new Error(`La instancia no arrancó: ${output}`)), 30_000).unref();
  });
  return `http://127.0.0.1:${port}`;
}

/**
 * Inicia sesión en una instancia y devuelve la cookie.
 *
 * @param {string} instance - URL base de la instancia.
 * @param {string} email - Cuenta.
 * @returns {Promise<string>} Cabecera Cookie.
 */
async function login(instance, email) {
  const response = await fetch(`${instance}/api/auth/login`, {
    body: JSON.stringify({ email, password: PASSWORD }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.headers.get("set-cookie").split(";")[0];
}

/**
 * Devuelve el estado HTTP de /api/auth/me en una instancia con la cookie dada.
 *
 * @param {string} instance - URL base de la instancia.
 * @param {string} cookie - Cookie de sesión.
 * @returns {Promise<number>} Estado HTTP.
 */
async function me(instance, cookie) {
  return (await fetch(`${instance}/api/auth/me`, { headers: { Cookie: cookie } })).status;
}

test("migración: RLS, índices, restricciones, cascada y sin privilegios peligrosos para los roles de la API", { skip }, async () => {
  const { query } = modules.db;
  assert.equal((await query("select relrowsecurity from pg_class where oid = 'public.user_sessions'::regclass")).rows[0].relrowsecurity, true);
  const indexes = (await query("select indexname, indexdef from pg_indexes where tablename = 'user_sessions' order by indexname")).rows;
  assert.deepEqual(indexes.map((row) => row.indexname), ["user_sessions_active_user_idx", "user_sessions_expires_at_idx", "user_sessions_pkey"]);
  assert.match(indexes[0].indexdef, /WHERE \(revoked_at IS NULL\)/);

  await assert.rejects(query("insert into public.user_sessions (user_id, expires_at) values ($1, now() - interval '1 second')", [ids.other]), { code: "23514" });
  await assert.rejects(query("insert into public.user_sessions (user_id, expires_at, revoked_at) values ($1, now() + interval '1 hour', now())", [ids.other]), { code: "23514" });
  await assert.rejects(query("insert into public.user_sessions (user_id, expires_at) values (-1, now() + interval '1 hour')"), { code: "23503" });

  if (process.env.ARCA_SESSION_TEST_CREATE_ROLES === "1") {
    const { rows } = await query(`
      select grantee, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'user_sessions'
        and grantee in ('anon', 'authenticated', 'service_role')
        and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
    `);
    assert.deepEqual(rows, [], "D-2: sin TRUNCATE/TRIGGER/REFERENCES/MAINTAIN para los roles de la API");
  }
});

test("sesión vigente: solo autentica su usuario, activa, no revocada ni caducada", { skip }, async () => {
  const { createSession, revokeSession } = modules.sessionRepository;
  const { findActiveSessionUser } = modules.users;
  const { query } = modules.db;
  const session = await createSession({ expiresInSeconds: 600, userId: ids.client });

  assert.equal((await findActiveSessionUser({ sessionId: session.id, userId: ids.client })).email, "cliente@arca.test");
  assert.equal(await findActiveSessionUser({ sessionId: session.id, userId: ids.other }), null, "sid de otro usuario");
  assert.equal(await findActiveSessionUser({ sessionId: randomUUID(), userId: ids.client }), null, "sid inexistente");

  await query("update public.user_sessions set created_at = now() - interval '2 hours', expires_at = now() - interval '1 second' where id = $1", [session.id]);
  assert.equal(await findActiveSessionUser({ sessionId: session.id, userId: ids.client }), null, "sesión caducada");

  const second = await createSession({ expiresInSeconds: 600, userId: ids.client });
  assert.equal(await revokeSession({ reason: "logout", sessionId: second.id }), true);
  assert.equal(await revokeSession({ reason: "logout", sessionId: second.id }), false, "idempotente");
  assert.equal(await findActiveSessionUser({ sessionId: second.id, userId: ids.client }), null, "sesión revocada");
});

test("varias instancias: login en una, revocación en otra y rechazo inmediato en todas", { skip }, async () => {
  const [instanceA, instanceB] = await Promise.all([startInstance(), startInstance()]);
  const laptop = await login(instanceA, "otro@arca.test");
  const phone = await login(instanceB, "otro@arca.test");

  for (const instance of [instanceA, instanceB]) {
    assert.equal(await me(instance, laptop), 200);
    assert.equal(await me(instance, phone), 200, "un login nuevo no cierra otros dispositivos (B3-3)");
  }

  const logout = await fetch(`${instanceB}/api/auth/logout`, { headers: { Cookie: laptop }, method: "POST" });
  assert.equal(logout.status, 204);
  assert.equal(await me(instanceA, laptop), 401, "la otra instancia ve la revocación en la siguiente petición");
  assert.equal(await me(instanceB, laptop), 401);
  assert.equal(await me(instanceA, phone), 200, "la otra sesión sigue activa");

  // Desactivación desde fuera de la aplicación (otra instancia o un administrador).
  await modules.adminUsers.updateAdminUserStatusRecord({ status: "blocked", userId: ids.other });
  assert.equal(await me(instanceA, phone), 401);
  await modules.adminUsers.updateAdminUserStatusRecord({ status: "active", userId: ids.other });
  assert.equal(await me(instanceB, phone), 401, "reactivar no revive sesiones revocadas");

  const legacy = modules.tokens.createAuthToken({ email: "otro@arca.test", role: "client", sub: String(ids.other) }, { expiresInSeconds: 600, secret: SECRET });
  assert.equal(await me(instanceA, `__Host-arca_session=${legacy}`), 401, "JWT sin sid");
  assert.equal(await me(instanceA, `arca_session=${legacy}`), 401);
});

test("cambio de contraseña: transacción atómica que revoca todo y crea una única sesión nueva", { skip }, async () => {
  const { changePasswordAndRotateSession, issueUserSession } = modules.sessionService;
  const { query } = modules.db;
  const before = await Promise.all([issueUserSession(ids.client), issueUserSession(ids.client)]);

  const rotated = await changePasswordAndRotateSession({ passwordHash: await bcrypt.hash("Nueva2026*x", 4), userId: ids.client });
  const { rows } = await query("select id, revoked_reason from public.user_sessions where user_id = $1 and revoked_at is null", [ids.client]);
  assert.deepEqual(rows.map((row) => row.id), [payloadOf(rotated.token).sid]);
  for (const session of before) {
    assert.equal(await modules.users.findActiveSessionUser({ sessionId: session.sessionId, userId: ids.client }), null);
  }

  // Si la sesión nueva no puede crearse, ni la contraseña ni las revocaciones se confirman.
  const passwordBefore = (await query("select password_hash from public.users where id = $1", [ids.client])).rows[0].password_hash;
  await query(`
    create function public.test_block_session_insert() returns trigger language plpgsql as
    $$ begin raise exception 'bloqueo de prueba'; end $$;
    create trigger test_block_session_insert before insert on public.user_sessions
      for each row execute function public.test_block_session_insert();
  `);
  try {
    await assert.rejects(changePasswordAndRotateSession({ passwordHash: "otro-hash", userId: ids.client }), /bloqueo de prueba/);
  } finally {
    await query("drop trigger test_block_session_insert on public.user_sessions; drop function public.test_block_session_insert()");
  }
  assert.equal((await query("select password_hash from public.users where id = $1", [ids.client])).rows[0].password_hash, passwordBefore);
  assert.ok(await modules.users.findActiveSessionUser({ sessionId: payloadOf(rotated.token).sid, userId: ids.client }), "la sesión vigente no se revocó");
});

test("concurrencia: revocar todas mientras se emiten sesiones nuevas no deja sesiones previas activas", { skip }, async () => {
  const { issueUserSession } = modules.sessionService;
  const { revokeUserSessions } = modules.sessionRepository;
  const previous = await Promise.all(Array.from({ length: 20 }, () => issueUserSession(ids.admin)));
  const [revoked, concurrent] = await Promise.all([
    revokeUserSessions({ reason: "password_changed", userId: ids.admin }),
    Promise.all(Array.from({ length: 20 }, () => issueUserSession(ids.admin))),
  ]);

  assert.ok(revoked >= 20);
  for (const session of previous) {
    assert.equal(await modules.users.findActiveSessionUser({ sessionId: session.sessionId, userId: ids.admin }), null);
  }
  const { rows } = await modules.db.query("select count(*)::int as active from public.user_sessions where user_id = $1 and revoked_at is null", [ids.admin]);
  assert.equal(rows[0].active + revoked, 40, "cada sesión concurrente quedó revocada o activa, nunca a medias");
  assert.equal(concurrent.length, 20);
});

test("edición administrativa: datos no sensibles conservan sesiones; rol, correo o contraseña las revocan", { skip }, async () => {
  const { issueUserSession } = modules.sessionService;
  const { findActiveSessionUser } = modules.users;
  const { updateAdminUserRecord } = modules.adminUsers;
  const base = {
    companyName: null,
    email: "otro@arca.test",
    firstName: "Otro",
    lastName: "Prueba",
    passwordHash: null,
    phone: "+10000000003",
    roleCode: "architect",
    secondaryPhone: null,
    status: "active",
    userId: ids.other,
  };
  // Normaliza a un rol sin cliente asociado para que el escenario no dependa de la tabla clients.
  await updateAdminUserRecord(base);

  const kept = await issueUserSession(ids.other);
  const renamed = await updateAdminUserRecord({ ...base, firstName: "Renombrado", phone: "+10000000009" });
  assert.equal(renamed.revokedSessions, 0);
  assert.ok(await findActiveSessionUser({ sessionId: kept.sessionId, userId: ids.other }), "cambiar nombre o teléfono no cierra sesiones");

  const promoted = await updateAdminUserRecord({ ...base, roleCode: "admin" });
  assert.equal(promoted.revokedSessions, 1);
  assert.equal(await findActiveSessionUser({ sessionId: kept.sessionId, userId: ids.other }), null);

  const next = await issueUserSession(ids.other);
  assert.equal((await updateAdminUserRecord({ ...base, roleCode: "admin", email: "otro.nuevo@arca.test" })).revokedSessions, 1);
  assert.equal(await findActiveSessionUser({ sessionId: next.sessionId, userId: ids.other }), null);

  const last = await issueUserSession(ids.other);
  assert.equal((await updateAdminUserRecord({ ...base, email: "otro.nuevo@arca.test", passwordHash: "hash", roleCode: "admin" })).revokedSessions, 1);
  assert.equal(await findActiveSessionUser({ sessionId: last.sessionId, userId: ids.other }), null);
});

test("limpieza: elimina sesiones caducadas o revocadas hace más de un día y conserva las vigentes", { skip }, async () => {
  const { createSession, deleteExpiredSessions } = modules.sessionRepository;
  const { query } = modules.db;
  const old = await createSession({ expiresInSeconds: 600, userId: ids.admin });
  const current = await createSession({ expiresInSeconds: 600, userId: ids.admin });
  await query("update public.user_sessions set created_at = now() - interval '3 days', expires_at = now() - interval '2 days' where id = $1", [old.id]);

  assert.ok(await deleteExpiredSessions({ limit: 1000 }) >= 1);
  const { rows } = await query("select id from public.user_sessions where id = any($1::uuid[])", [[old.id, current.id]]);
  assert.deepEqual(rows.map((row) => row.id), [current.id]);
});

test("rendimiento: la validación por petición usa índices y se mantiene por debajo de 5 ms", { skip }, async () => {
  const { query } = modules.db;
  // Volumen representativo: 20 000 sesiones de un mismo usuario, la mayoría revocadas.
  await query(`
    insert into public.user_sessions (user_id, expires_at, revoked_at, revoked_reason)
    select $1, now() + interval '12 hours', case when n % 10 = 0 then null else now() end, case when n % 10 = 0 then null else 'logout' end
    from generate_series(1, 20000) as n
  `, [ids.admin]);
  await query("analyze public.user_sessions");

  for (const userId of [ids.client, ids.admin]) {
    const session = await modules.sessionRepository.createSession({ expiresInSeconds: 600, userId });
    const plan = JSON.stringify((await query(`explain (format json) select 1 from public.user_sessions s where s.id = $1::uuid and s.user_id = $2 and s.revoked_at is null and s.expires_at > now()`, [session.id, userId])).rows[0]["QUERY PLAN"]);
    assert.match(plan, /"Index (Only )?Scan"/, plan);
    assert.doesNotMatch(plan, /Seq Scan/, plan);

    const timings = [];
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const started = process.hrtime.bigint();
      assert.ok(await modules.users.findActiveSessionUser({ sessionId: session.id, userId }));
      timings.push(Number(process.hrtime.bigint() - started) / 1e6);
    }
    timings.sort((a, b) => a - b);
    const p95 = timings[190];
    console.log(`findActiveSessionUser usuario=${userId} p50=${timings[100].toFixed(2)}ms p95=${p95.toFixed(2)}ms`);
    assert.ok(p95 < 5, `p95 ${p95.toFixed(2)} ms`);
  }
});
