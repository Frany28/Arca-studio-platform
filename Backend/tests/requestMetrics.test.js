import assert from "node:assert/strict";
import test from "node:test";

import express from "express";

// P1-3: métricas de ejecución. El transporte simulado nunca consulta la base configurada.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.RUNTIME_METRICS_INTERVAL_MS = "3600000";

const { collectRuntimeMetrics, requestMetrics } = await import("../src/middlewares/requestMetrics.js");

/**
 * Inicia una aplicación con el middleware real y rutas que responden distintos estados.
 *
 * @param {import("node:test").TestContext} context - Contexto que cierra el servidor.
 * @returns {Promise<string>} URL base.
 */
async function startApp(context) {
  const app = express();
  app.use(requestMetrics);
  const router = express.Router();
  router.get("/:projectId/comments", (_req, res) => res.json({ ok: true }));
  app.use("/api/projects", router);
  app.get("/limited", (_req, res) => res.status(429).json({}));
  app.get("/saturated", (_req, res) => res.status(503).json({}));
  app.get("/fails", (_req, res) => res.status(500).json({}));
  app.get("/slow", (_req, res) => setTimeout(() => res.json({}), 40));
  app.get("/hang", () => {});
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

/**
 * Captura las líneas JSON registradas con console.log durante la prueba.
 *
 * @param {import("node:test").TestContext} context - Contexto que restaura el mock.
 * @returns {Array<object>} Registros capturados.
 */
function captureLogs(context) {
  const logs = [];
  context.mock.method(console, "log", (line) => logs.push(JSON.parse(line)));
  return logs;
}

test("desactivadas: sin cabecera ni registros", async (context) => {
  process.env.REQUEST_METRICS_ENABLED = "false";
  const logs = captureLogs(context);
  const baseUrl = await startApp(context);
  const response = await fetch(`${baseUrl}/api/projects/7/comments`);
  assert.equal(response.headers.get("x-request-id"), null);
  assert.deepEqual(logs, []);
});

test("por petición: ruta sin ids ni consulta, sin cookies ni tokens, y X-Request-Id saneado", async (context) => {
  process.env.REQUEST_METRICS_ENABLED = "true";
  const logs = captureLogs(context);
  const baseUrl = await startApp(context);
  const response = await fetch(`${baseUrl}/api/projects/12345/comments?cursor=secreto-del-cursor`, {
    headers: { Authorization: "Bearer token-secreto", Cookie: "arca_session=cookie-secreta", "X-Request-Id": "req-1.ok" },
  });
  await response.json();
  assert.equal(response.headers.get("x-request-id"), "req-1.ok");
  const invalid = await fetch(`${baseUrl}/fails`, { headers: { "X-Request-Id": "<script>alert(1)</script>" } });
  assert.match(invalid.headers.get("x-request-id"), /^[0-9a-f-]{36}$/);

  const entry = logs.find((log) => log.type === "http_request" && log.status === 200);
  assert.equal(entry.route, "/api/projects/:projectId/comments");
  const serialized = JSON.stringify(logs);
  for (const secret of ["12345", "secreto-del-cursor", "token-secreto", "cookie-secreta", "<script>"]) {
    assert.ok(!serialized.includes(secret), `no registra ${secret}`);
  }
});

test("resumen: CPU, memoria, event loop, pool, percentiles, errores, 429 y 503; luego se reinicia", async (context) => {
  process.env.REQUEST_METRICS_ENABLED = "true";
  process.env.REQUEST_METRICS_LOG_REQUESTS = "false";
  context.after(() => { delete process.env.REQUEST_METRICS_LOG_REQUESTS; });
  const logs = captureLogs(context);
  const baseUrl = await startApp(context);
  collectRuntimeMetrics();

  for (const path of ["/slow", "/slow", "/limited", "/saturated", "/fails", "/api/projects/1/comments"]) {
    await (await fetch(`${baseUrl}${path}`)).text();
  }
  const aborted = new AbortController();
  const hanging = fetch(`${baseUrl}/hang`, { signal: aborted.signal }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 50));
  aborted.abort();
  await hanging;
  await new Promise((resolve) => setTimeout(resolve, 50));

  const summary = collectRuntimeMetrics();
  assert.equal(summary.type, "runtime_metrics");
  assert.equal(summary.requests.count, 6);
  assert.equal(summary.requests.aborted, 1);
  assert.deepEqual(summary.requests.byStatusClass, { "2xx": 3, "3xx": 0, "4xx": 1, "5xx": 2 });
  assert.equal(summary.requests.rateLimited, 1);
  assert.equal(summary.requests.saturated, 1);
  assert.ok(summary.requests.durationMs.max >= 40);
  assert.ok(summary.requests.durationMs.p50 <= summary.requests.durationMs.p95);
  assert.ok(summary.requests.durationMs.p95 <= summary.requests.durationMs.p99);
  assert.ok(summary.memory.rssBytes > 0 && summary.memory.heapUsedBytes > 0);
  assert.ok(summary.cpu.percent >= 0);
  assert.equal(typeof summary.eventLoopDelayMs.p99, "number");
  assert.deepEqual(Object.keys(summary.databasePool).sort(), ["active", "idle", "total", "waiting"]);
  assert.deepEqual(logs, [], "con REQUEST_METRICS_LOG_REQUESTS=false solo queda el resumen");

  const next = collectRuntimeMetrics();
  assert.equal(next.requests.count, 0, "cada resumen describe solo su intervalo");
});

test("el retraso del event loop refleja un bloqueo síncrono", async () => {
  process.env.REQUEST_METRICS_ENABLED = "true";
  collectRuntimeMetrics();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const blockUntil = Date.now() + 120;
  while (Date.now() < blockUntil) { /* bloquea el event loop a propósito */ }
  await new Promise((resolve) => setTimeout(resolve, 30));
  const summary = collectRuntimeMetrics();
  assert.ok(summary.eventLoopDelayMs.max >= 80, `max ${summary.eventLoopDelayMs.max} ms`);
});
