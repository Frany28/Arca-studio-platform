import assert from "node:assert/strict";
import test from "node:test";

// P1-2: saturación de PostgreSQL. El transporte simulado nunca consulta la base configurada ni
// requiere dotenv; las pruebas con PostgreSQL real viven en databaseSaturation.integration.test.js.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.ROUTE_AUTH_DISABLED_FOR_TESTS = "false";

const { pool, query, withTransaction } = await import("../src/config/db.js");
const {
  isConnectionLossError,
  isDatabaseSaturationError,
  isDatabaseUnavailableError,
  markDatabaseError,
} = await import("../src/config/databaseErrors.js");
const { normalizeError } = await import("../src/errors/appError.js");
const { authConfig } = await import("../src/config/auth.js");
const { createAuthToken } = await import("../src/utils/tokens.js");
const { default: app } = await import("../src/app.js");

const POOL_TIMEOUT = () => new Error("timeout exceeded when trying to connect");
const CONNECTION_LOST = () => new Error("Connection terminated unexpectedly");

/**
 * Inicia la aplicación real en un puerto libre.
 *
 * @param {import("node:test").TestContext} context - Contexto que cierra el servidor.
 * @returns {Promise<string>} URL base.
 */
async function startApp(context) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("clasifica saturación, cortes de conexión y errores que no son de disponibilidad", () => {
  for (const error of [POOL_TIMEOUT(), { code: "53300" }, { code: "57014" }, new Error("Query read timeout"), { code: "POOL_QUEUE_FULL" }, new Error("Connection terminated due to connection timeout")]) {
    assert.equal(isDatabaseSaturationError(error), true, JSON.stringify(error.message || error.code));
    assert.equal(isConnectionLossError(error), false, "la saturación no se reintenta");
    assert.equal(isDatabaseUnavailableError(error), true);
  }
  for (const error of [CONNECTION_LOST(), { code: "08006" }, { code: "57P01" }, markDatabaseError(Object.assign(new Error("reset"), { code: "ECONNRESET" }))]) {
    assert.equal(isConnectionLossError(error), true);
    assert.equal(isDatabaseUnavailableError(error), true);
  }
  // Un ECONNRESET del almacenamiento (sin marca de base de datos) no es saturación de PostgreSQL.
  for (const error of [{ code: "23505" }, { code: "42703" }, Object.assign(new Error("socket"), { code: "ECONNRESET" }), new Error("otro fallo")]) {
    assert.equal(isDatabaseUnavailableError(error), false, JSON.stringify(error.code || error.message));
  }
});

test("la saturación responde 503 con Retry-After y sin detalles internos", () => {
  const normalized = normalizeError(POOL_TIMEOUT());
  assert.equal(normalized.status, 503);
  assert.equal(normalized.code, "DATABASE_UNAVAILABLE");
  assert.equal(normalized.retryAfter, 5);
  assert.doesNotMatch(normalized.message, /timeout exceeded|pool/i);
  assert.equal(normalizeError({ code: "23505" }).status, 409, "los conflictos conservan su respuesta");
  assert.equal(normalizeError(Object.assign(new Error("socket"), { code: "ECONNRESET" })).status, 500);
});

test("pool agotado: la lectura no se reintenta y falla enseguida", async (context) => {
  context.mock.method(pool, "query", async () => { throw POOL_TIMEOUT(); });
  await assert.rejects(query("select 1"), /timeout exceeded/);
  assert.equal(pool.query.mock.callCount(), 1);
});

test("statement_timeout: la lectura lenta no se repite", async (context) => {
  context.mock.method(pool, "query", async () => { throw Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" }); });
  await assert.rejects(query("select pg_sleep(30)"), { code: "57014" });
  assert.equal(pool.query.mock.callCount(), 1);
});

test("corte de conexión: una lectura se reintenta una vez tras una espera; una escritura nunca", async (context) => {
  let calls = 0;
  context.mock.method(pool, "query", async () => {
    calls += 1;
    if (calls === 1) throw CONNECTION_LOST();
    return { rows: [{ ok: true }] };
  });
  context.mock.method(console, "warn", () => {});
  const startedAt = Date.now();
  const result = await query("select 1 as ok");
  assert.deepEqual(result.rows, [{ ok: true }]);
  assert.equal(calls, 2);
  assert.ok(Date.now() - startedAt >= 95, "espera antes de reintentar");

  calls = 0;
  context.mock.method(pool, "query", async () => { calls += 1; throw CONNECTION_LOST(); });
  await assert.rejects(query("select 1"));
  assert.equal(calls, 2, "como máximo un reintento");
  calls = 0;
  await assert.rejects(query("update public.projects set name = $1 where id = $2", ["x", 1]));
  assert.equal(calls, 1, "una escritura no se repite");
});

test("cola de espera llena: 503 inmediato sin pedir conexión ni ejecutar la consulta", async (context) => {
  context.mock.method(pool, "waitingCount", () => 200, { getter: true });
  context.mock.method(pool, "query", async () => ({ rows: [] }));
  context.mock.method(pool, "connect", async () => { throw new Error("no debería pedir conexión"); });
  const error = await query("select 1").catch((caught) => caught);
  assert.equal(error.code, "POOL_QUEUE_FULL");
  assert.equal(normalizeError(error).status, 503);
  assert.equal(pool.query.mock.callCount(), 0);
  await assert.rejects(withTransaction(async () => {}), { code: "POOL_QUEUE_FULL" });
  assert.equal(pool.connect.mock.callCount(), 0);
});

test("HTTP: con la base saturada, sesión y salud responden 503 con Retry-After", async (context) => {
  context.mock.method(pool, "query", async () => { throw POOL_TIMEOUT(); });
  context.mock.method(console, "error", () => {});
  const baseUrl = await startApp(context);

  const health = await fetch(`${baseUrl}/api/health/database`);
  assert.equal(health.status, 503);
  assert.equal(health.headers.get("retry-after"), "5");

  const token = createAuthToken(
    { sid: "00000000-0000-4000-8000-000000000001", sub: "1" },
    { expiresInSeconds: 60, secret: authConfig.tokenSecret },
  );
  const me = await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(me.status, 503);
  assert.equal(me.headers.get("retry-after"), "5");
  const body = await me.json();
  assert.deepEqual(body, {
    code: "DATABASE_UNAVAILABLE",
    message: "El servicio está temporalmente saturado. Intenta de nuevo en unos segundos.",
    retryAfter: 5,
  });
});

test("appError y su clasificación siguen siendo importables desde el navegador (sin `process` directo)", async () => {
  // El frontend importa appError.js a través de dominios compartidos (quoteTotals.js).
  const { readFile } = await import("node:fs/promises");
  for (const file of ["../src/errors/appError.js", "../src/config/databaseErrors.js"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source.replace(/^\s*(\/\/|\*).*$/gm, ""), /(^|[^.?\w])process\./m, file);
  }
});

test("un corte de una conexión inactiva no termina el proceso", (context) => {
  assert.ok(pool.listenerCount("error") >= 1);
  context.mock.method(console, "warn", () => {});
  assert.doesNotThrow(() => pool.emit("error", Object.assign(new Error("terminating connection"), { code: "57P01" })));
});
