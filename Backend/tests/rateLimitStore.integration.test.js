import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

// PostgreSQL aislado y opcional: ARCA_RATE_LIMIT_DB_TESTS=1 y ARCA_RATE_LIMIT_TEST_DATABASE_URL
// (solo localhost). La prueba crea y elimina su propia base; nunca usa DATABASE_URL del proyecto.
// ARCA_RATE_LIMIT_TEST_CREATE_ROLES=1 crea los roles anon/authenticated/service_role del clúster
// para ejercitar el REVOKE de la migración (usarlo solo en un clúster desechable).
const enabled = process.env.ARCA_RATE_LIMIT_DB_TESTS === "1";
const skip = !enabled && "Requiere PostgreSQL local, ARCA_RATE_LIMIT_DB_TESTS=1 y ARCA_RATE_LIMIT_TEST_DATABASE_URL.";
const run = promisify(execFile);
const backendDirectory = fileURLToPath(new URL("../", import.meta.url));
const MIGRATION = new URL("../prisma/migrations/20261014140000_rate_limit_buckets/migration.sql", import.meta.url);
const SECRET = "integration-secret-shared-by-all-instances";

let admin;
let databaseUrl;
let databaseName;
let modules;

before(async () => {
  if (!enabled) return;
  const base = new URL(process.env.ARCA_RATE_LIMIT_TEST_DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(base.hostname), "La prueba rechaza hosts remotos.");
  const { default: pg } = await import("pg");
  admin = new pg.Client({ connectionString: base.toString(), ssl: false });
  await admin.connect();
  databaseName = `arca_rate_limit_${randomUUID().replaceAll("-", "")}`;
  // Nombre generado internamente, sin entradas externas.
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  base.pathname = `/${databaseName}`;
  databaseUrl = base.toString();

  const setup = new pg.Client({ connectionString: databaseUrl, ssl: false });
  await setup.connect();
  try {
    if (process.env.ARCA_RATE_LIMIT_TEST_CREATE_ROLES === "1") {
      for (const role of ["anon", "authenticated", "service_role"]) {
        await setup.query(`DO $$ BEGIN CREATE ROLE ${role} NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
      }
      // Igual que Supabase: los roles de la API reciben estos privilegios en cada tabla nueva.
      await setup.query("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLES TO anon, authenticated, service_role");
    }
    await setup.query(await readFile(MIGRATION, "utf8"));
  } finally {
    await setup.end();
  }

  Object.assign(process.env, {
    AUTH_TOKEN_SECRET: SECRET,
    DATABASE_POOL_MAX: "10",
    DATABASE_URL: databaseUrl,
  });
  modules = {
    db: await import("../src/config/db.js"),
    policies: await import("../src/config/authRateLimits.js"),
    repository: await import("../src/repositories/rateLimitRepository.js"),
    service: await import("../src/services/rateLimitService.js"),
  };
});

after(async () => {
  if (!enabled) return;
  await modules?.db.pool.end().catch(() => {});
  await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`).catch(() => {});
  await admin.end();
});

const noCleanup = { scheduleCleanup: () => {} };
const accountDimension = (email, max = 20, windowMs = 60_000) => [{ max, name: "account", parts: [`email:${email}`], windowMs }];

test("migración: tabla con RLS, restricciones y sin privilegios peligrosos para los roles de la API", { skip }, async () => {
  const { query } = modules.db;
  const table = (await query("select relrowsecurity from pg_class where oid = 'public.rate_limit_buckets'::regclass")).rows[0];
  assert.equal(table.relrowsecurity, true);
  const index = await query("select 1 from pg_indexes where indexname = 'rate_limit_buckets_expires_at_idx'");
  assert.equal(index.rowCount, 1);
  await assert.rejects(query("insert into public.rate_limit_buckets (key_hash, scope, count, expires_at) values ('\\x00'::bytea, 's', 1, now())"), { code: "23514" });
  if (process.env.ARCA_RATE_LIMIT_TEST_CREATE_ROLES === "1") {
    const grants = await query(`
      select a.grantee::regrole::text as grantee, a.privilege_type
      from pg_class c cross join lateral aclexplode(c.relacl) a
      where c.oid = 'public.rate_limit_buckets'::regclass and a.grantee <> 0
        and a.grantee::regrole::text in ('anon', 'authenticated', 'service_role')`);
    assert.deepEqual(grants.rows, []);
  }
});

test("solicitudes concurrentes: de 60 intentos simultáneos solo pasan exactamente 20", { skip }, async () => {
  const attempts = await Promise.all(Array.from({ length: 60 }, () =>
    modules.service.consumeRateLimit("login", accountDimension("concurrente@arca.test"), noCleanup)));
  assert.equal(attempts.filter((attempt) => attempt.allowed).length, 20);
  const { rows } = await modules.db.query("select count from public.rate_limit_buckets where scope = 'login' order by count desc limit 1");
  assert.equal(rows[0].count, 60);
});

test("varias instancias: tres procesos independientes comparten el mismo contador", { skip }, async () => {
  const script = `
    const { consumeRateLimit } = await import(${JSON.stringify(pathToFileURL(`${backendDirectory}src/services/rateLimitService.js`).href)});
    const { pool } = await import(${JSON.stringify(pathToFileURL(`${backendDirectory}src/config/db.js`).href)});
    const dimensions = [{ max: 20, name: "account", parts: ["email:instancias@arca.test"], windowMs: 60000 }];
    const results = await Promise.all(Array.from({ length: 15 }, () => consumeRateLimit("login", dimensions, { scheduleCleanup: () => {} })));
    console.log("RESULT" + results.filter((r) => r.allowed).length);
    await pool.end();
  `;
  const env = { ...process.env, AUTH_TOKEN_SECRET: SECRET, DATABASE_POOL_MAX: "5", DATABASE_URL: databaseUrl, NODE_ENV: "test" };
  const outputs = await Promise.all([1, 2, 3].map(() => run(process.execPath, ["--input-type=module", "-e", script], { env, timeout: 60_000 })));
  const allowed = outputs.map(({ stdout }) => Number(stdout.match(/RESULT(\d+)/)[1]));
  assert.equal(allowed.reduce((sum, value) => sum + value, 0), 20, `aceptados por instancia: ${allowed.join(", ")}`);
});

test("expiración: al terminar la ventana el contador se reinicia y vuelve a permitir", { skip }, async () => {
  const dimensions = accountDimension("expira@arca.test", 2, 700);
  for (let attempt = 0; attempt < 2; attempt += 1) assert.equal((await modules.service.consumeRateLimit("login", dimensions, noCleanup)).allowed, true);
  const blocked = await modules.service.consumeRateLimit("login", dimensions, noCleanup);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 1);
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal((await modules.service.consumeRateLimit("login", dimensions, noCleanup)).allowed, true);
});

test("dimensiones: cuenta + IP verificada 5/15 min sin bloquear otras cuentas; IP verificada 30/15 min", { skip }, async () => {
  const { consumeRateLimit } = modules.service;
  const { AUTH_RATE_LIMIT_POLICIES } = modules.policies;
  const login = (email, ip) => consumeRateLimit("login", AUTH_RATE_LIMIT_POLICIES.login({ body: { email } }, ip), noCleanup);
  for (let attempt = 0; attempt < 5; attempt += 1) assert.equal((await login("ana@arca.test", "203.0.113.5")).allowed, true);
  const sixth = await login("ana@arca.test", "203.0.113.5");
  assert.deepEqual([sixth.allowed, sixth.exceeded], [false, ["account-ip"]]);
  assert.equal((await login("ana@arca.test", "203.0.113.6")).allowed, true, "la misma cuenta desde otra IP sigue bajo el límite de cuenta");
  assert.equal((await login("otra@arca.test", "203.0.113.5")).allowed, true, "otra cuenta desde la misma IP no queda bloqueada");

  let ipBlocked = null;
  for (let index = 0; index < 40 && !ipBlocked; index += 1) {
    const result = await login(`relleno${index}@arca.test`, "198.51.100.77");
    if (!result.allowed) ipBlocked = { index, result };
  }
  assert.equal(ipBlocked.index, 30, "la IP verificada admite 30 intentos en la ventana");
  assert.deepEqual(ipBlocked.result.exceeded, ["ip"]);
});

test("sin IP confiable solo se cuenta la cuenta: la IP compartida de Netlify no bloquea a otros", { skip }, async () => {
  const { consumeRateLimit } = modules.service;
  const { AUTH_RATE_LIMIT_POLICIES } = modules.policies;
  for (let index = 0; index < 40; index += 1) {
    const dimensions = AUTH_RATE_LIMIT_POLICIES.login({ body: { email: `usuario${index}@arca.test` }, ip: "198.51.100.10" }, null);
    assert.equal((await consumeRateLimit("login", dimensions, noCleanup)).allowed, true);
  }
});

test("las claves almacenadas no contienen correos, tokens ni IP", { skip }, async () => {
  const { rows } = await modules.db.query("select encode(key_hash, 'escape') as raw, scope from public.rate_limit_buckets");
  assert.ok(rows.length > 0);
  for (const row of rows) assert.doesNotMatch(`${row.raw}${row.scope}`, /@arca\.test|203\.0\.113|198\.51\.100|token/);
});

test("limpieza: elimina solo los contadores caducados", { skip }, async () => {
  const { consumeRateLimit } = modules.service;
  await consumeRateLimit("cleanup", accountDimension("caducado@arca.test", 5, 1), noCleanup);
  await consumeRateLimit("cleanup", accountDimension("vigente@arca.test", 5, 60_000), noCleanup);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const deleted = await modules.repository.deleteExpiredRateLimitBuckets({ limit: 1000 });
  assert.ok(deleted >= 1);
  const { rows } = await modules.db.query("select count(*)::int as total from public.rate_limit_buckets where scope = 'cleanup'");
  assert.equal(rows[0].total, 1);
});

test("fallo de PostgreSQL: con la base inaccesible el límite se informa como no disponible", { skip }, async () => {
  const script = `
    const { consumeRateLimit } = await import(${JSON.stringify(pathToFileURL(`${backendDirectory}src/services/rateLimitService.js`).href)});
    try {
      await consumeRateLimit("login", [{ max: 5, name: "account", parts: ["email:x@arca.test"], windowMs: 60000 }], { scheduleCleanup: () => {} });
      console.log("RESULT allowed");
    } catch (error) { console.log("RESULT " + error.code); }
    process.exit(0);
  `;
  const unreachable = new URL(databaseUrl);
  unreachable.port = "1";
  const { stdout } = await run(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, DATABASE_CONNECTION_TIMEOUT_MS: "2000", DATABASE_URL: unreachable.toString(), NODE_ENV: "test" },
    timeout: 60_000,
  });
  assert.match(stdout, /RESULT RATE_LIMIT_STORE_UNAVAILABLE/);
});
