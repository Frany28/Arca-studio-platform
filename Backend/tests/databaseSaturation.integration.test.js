import assert from "node:assert/strict";
import { after, before, test } from "node:test";

// P1-2 contra PostgreSQL real con un pool de 1 conexión y plazos cortos. Opcional y aislada:
// ARCA_DB_SATURATION_TESTS=1 y ARCA_DB_SATURATION_TEST_DATABASE_URL (solo localhost). Solo ejecuta
// lecturas (`select 1`, `pg_sleep`) y termina sus propias conexiones; nunca usa DATABASE_URL del proyecto.
const enabled = process.env.ARCA_DB_SATURATION_TESTS === "1";
const skip = !enabled && "Requiere PostgreSQL local, ARCA_DB_SATURATION_TESTS=1 y ARCA_DB_SATURATION_TEST_DATABASE_URL.";

let modules;
let admin;

before(async () => {
  if (!enabled) return;
  const url = new URL(process.env.ARCA_DB_SATURATION_TEST_DATABASE_URL);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "La prueba rechaza hosts remotos.");
  Object.assign(process.env, {
    DATABASE_CONNECTION_TIMEOUT_MS: "300",
    DATABASE_MAX_WAITING: "3",
    DATABASE_POOL_MAX: "1",
    DATABASE_STATEMENT_TIMEOUT_MS: "300",
    DATABASE_URL: url.toString(),
    NODE_ENV: "test",
  });
  modules = {
    ...(await import("../src/config/db.js")),
    ...(await import("../src/errors/appError.js")),
  };
  const { default: pg } = await import("pg");
  admin = new pg.Client({ connectionString: url.toString(), ssl: false });
  await admin.connect();
});

after(async () => {
  if (!enabled) return;
  await modules?.pool.end();
  await admin?.end();
});

/**
 * Comprueba que el pool no retiene conexiones ni peticiones en espera.
 *
 * @returns {void}
 */
function assertPoolIdle() {
  const { pool } = modules;
  assert.equal(pool.totalCount - pool.idleCount, 0, "no quedan conexiones prestadas");
  assert.equal(pool.waitingCount, 0, "nadie espera una conexión");
}

test("pool agotado: las lecturas fallan con 503 en el plazo y el pool se recupera al liberar", { skip }, async () => {
  const { normalizeError, pool, query } = modules;
  const held = await pool.connect();
  const startedAt = Date.now();
  const results = await Promise.allSettled([query("select 1"), query("select 1"), query("select 1")]);
  const elapsedMs = Date.now() - startedAt;
  held.release();

  assert.deepEqual(results.map((result) => result.status), ["rejected", "rejected", "rejected"]);
  assert.ok(results.every((result) => normalizeError(result.reason).status === 503));
  assert.ok(elapsedMs < 1500, `sin reintentos que alarguen la espera (${elapsedMs} ms)`);
  assert.deepEqual((await query("select 1 as ok")).rows, [{ ok: 1 }]);
  assertPoolIdle();
});

test("cola de espera llena: las peticiones sobrantes reciben 503 al instante", { skip }, async () => {
  const { normalizeError, pool, query } = modules;
  const held = await pool.connect();
  const settled = await Promise.allSettled(Array.from({ length: 6 }, async () => {
    const startedAt = Date.now();
    try {
      await query("select 1");
      return { ok: true };
    } catch (error) {
      return { code: error.code || error.message, elapsedMs: Date.now() - startedAt, status: normalizeError(error).status };
    }
  }));
  held.release();
  const outcomes = settled.map((result) => result.value);
  const immediate = outcomes.filter((outcome) => outcome.code === "POOL_QUEUE_FULL");
  assert.equal(immediate.length, 3, JSON.stringify(outcomes));
  assert.ok(immediate.every((outcome) => outcome.elapsedMs < 100 && outcome.status === 503));
  assert.ok(outcomes.every((outcome) => outcome.status === 503));
  assertPoolIdle();
});

test("statement_timeout: la consulta lenta se cancela una sola vez y la conexión sigue sirviendo", { skip }, async () => {
  const { normalizeError, query } = modules;
  const startedAt = Date.now();
  const error = await query("select pg_sleep(2)").catch((caught) => caught);
  assert.equal(error.code, "57014");
  assert.equal(normalizeError(error).status, 503);
  assert.ok(Date.now() - startedAt < 1500, "no se reintenta la consulta lenta");
  assert.deepEqual((await query("select 1 as ok")).rows, [{ ok: 1 }]);
  assertPoolIdle();
});

test("una transacción fallida libera su conexión", { skip }, async () => {
  const { query, withTransaction } = modules;
  await assert.rejects(withTransaction(async (client) => { await client.query("select 1/0"); }), { code: "22012" });
  assertPoolIdle();
  assert.deepEqual((await query("select 2 as ok")).rows, [{ ok: 2 }]);
});

test("la base corta una conexión inactiva: el proceso sigue y la siguiente consulta reconecta", { skip }, async (context) => {
  const { pool, query } = modules;
  const warnings = [];
  context.mock.method(console, "warn", (message) => warnings.push(String(message)));
  const pid = (await query("select pg_backend_pid() as pid")).rows[0].pid;
  assert.equal(pool.idleCount, 1);
  await admin.query("select pg_terminate_backend($1)", [pid]);
  const deadline = Date.now() + 3000;
  while (!warnings.some((message) => message.includes("database_idle_client_error")) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(warnings.some((message) => message.includes("database_idle_client_error")));
  const next = (await query("select pg_backend_pid() as pid")).rows[0].pid;
  assert.notEqual(next, pid, "se abrió una conexión nueva");
  assertPoolIdle();
});
