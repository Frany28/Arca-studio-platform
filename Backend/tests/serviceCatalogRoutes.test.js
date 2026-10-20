import assert from "node:assert/strict";
import test from "node:test";

import { createRateLimitQueryMock } from "./helpers/rateLimitQueryMock.js";

// El transporte simulado nunca consulta la base configurada ni requiere dotenv.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.ROUTE_AUTH_DISABLED_FOR_TESTS = "false";
const { pool } = await import("../src/config/db.js");
const { default: express } = await import("express");
const { default: serviceCatalogRouter } = await import("../src/routes/serviceCatalog.js");
const { normalizeError } = await import("../src/errors/appError.js");

const ADMIN = { id: 2, role: { code: "admin" } };
const VALID_CREATE = { code: "ANTEPROYECTO", kind: "individual", measurementUnitId: 1, name: "Anteproyecto", referenceRate: "12" };

/**
 * Levanta el router del catálogo en un puerto efímero con una sesión controlada por la prueba.
 * El pool queda sustituido: el contador de rate limit se emula y cualquier otra consulta se
 * registra y responde con `respond`.
 *
 * @param {import("node:test").TestContext} context - Contexto que cierra el servidor y restaura mocks.
 * @param {(sql: string) => object} [respond] - Respuesta a consultas que no son del rate limit.
 * @returns {Promise<{ send: Function, setUser: Function, queries: Array<string> }>} Cliente HTTP y estado.
 */
async function startServer(context, respond = () => { throw new Error("No debe acceder a PostgreSQL"); }) {
  let user = null;
  const queries = [];
  const rateLimitQueries = createRateLimitQueryMock();
  const handle = async (sql, params) => {
    const rateLimit = rateLimitQueries.handle(sql, params);
    if (rateLimit) return rateLimit;
    queries.push(String(sql));
    return respond(String(sql));
  };
  context.mock.method(pool, "query", handle);
  context.mock.method(pool, "connect", async () => ({ query: handle, release() {} }));

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { isAuthenticated: Boolean(user) };
    req.user = user;
    next();
  });
  app.use("/api/admin/services", serviceCatalogRouter);
  app.use((error, _req, res, _next) => {
    const normalized = normalizeError(error);
    res.status(normalized.status).json({ code: normalized.code, message: normalized.publicMessage, fields: normalized.fields });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));

  const send = async (method, path, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/services${path}`, {
      method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
    });
    return { body: await response.json(), headers: response.headers, status: response.status };
  };
  return { queries, send, setUser: (value) => { user = value; } };
}

const REQUESTS = [
  ["GET", ""], ["GET", "/1"], ["POST", "", VALID_CREATE], ["PATCH", "/1", { expectedVersion: 1, referenceRate: "15" }],
  ["PATCH", "/1/status", { expectedVersion: 1, isActive: false }], ["DELETE", "/1"],
];

test("sin sesión responde 401 y sin rol administrador 403, sin consultar PostgreSQL", async (context) => {
  const server = await startServer(context);
  for (const [method, path, body] of REQUESTS) {
    const response = await server.send(method, path, body);
    assert.equal(response.status, 401, `${method} ${path}`);
    assert.equal(response.body.code, "UNAUTHENTICATED");
  }
  for (const role of ["client", "architect"]) {
    server.setUser({ id: 7, role: { code: role } });
    for (const [method, path, body] of REQUESTS) {
      const response = await server.send(method, path, body);
      assert.equal(response.status, 403, `${role} ${method} ${path}`);
      assert.equal(response.body.code, "FORBIDDEN");
    }
  }
  assert.deepEqual(server.queries, []);
});

test("datos inválidos responden 400 VALIDATION_ERROR antes de consultar el catálogo", async (context) => {
  const server = await startServer(context);
  server.setUser(ADMIN);
  const cases = [
    ["POST", "", { ...VALID_CREATE, referenceRate: "12.345" }, "body.referenceRate"],
    ["POST", "", { ...VALID_CREATE, referenceRate: "-5" }, "body.referenceRate"],
    ["POST", "", { ...VALID_CREATE, code: "con espacio" }, "body.code"],
    ["PATCH", "/1", { referenceRate: "15" }, "body.expectedVersion"],
    ["PATCH", "/abc", { expectedVersion: 1, name: "x" }, "params.serviceId"],
    ["PATCH", "/1/status", { expectedVersion: 1 }, "body.isActive"],
    ["GET", "?status=deleted", undefined, "query.status"],
  ];
  for (const [method, path, body, field] of cases) {
    const response = await server.send(method, path, body);
    assert.equal(response.status, 400, `${method} ${path}`);
    assert.equal(response.body.code, "VALIDATION_ERROR");
    assert.ok(field in response.body.fields, `${field} en ${JSON.stringify(response.body.fields)}`);
  }
  assert.deepEqual(server.queries, []);
});

test("un servicio inexistente responde 404 SERVICE_NOT_FOUND en consulta, edición y estado", async (context) => {
  const server = await startServer(context, () => ({ rowCount: 0, rows: [] }));
  server.setUser(ADMIN);
  for (const [method, path, body] of [
    ["GET", "/999"], ["PATCH", "/999", { expectedVersion: 1, name: "Otro" }], ["PATCH", "/999/status", { expectedVersion: 1, isActive: true }],
  ]) {
    const response = await server.send(method, path, body);
    assert.equal(response.status, 404, `${method} ${path}`);
    assert.equal(response.body.code, "SERVICE_NOT_FOUND");
  }
  // La edición de un servicio inexistente revierte su transacción.
  assert.ok(server.queries.includes("rollback"));
  assert.ok(!server.queries.some((sql) => /update public\.services|insert into public\.service_versions/.test(sql)));
});

test("eliminar un servicio responde 405 y no ejecuta SQL", async (context) => {
  const server = await startServer(context);
  server.setUser(ADMIN);
  const response = await server.send("DELETE", "/1");
  assert.equal(response.status, 405);
  assert.equal(response.body.code, "SERVICE_DELETION_NOT_ALLOWED");
  assert.equal(response.headers.get("allow"), "GET, PATCH");
  assert.deepEqual(server.queries, []);
});

test("el listado devuelve la página y el cursor siguiente con orden estable", async (context) => {
  const row = (id, sortOrder) => ({
    code: `SRV-${id}`, created_at: "2026-10-19T00:00:00.000Z", currency_code: "USD", current_version: 1, description: null,
    id: String(id), is_active: true, kind: "individual", name: `Servicio ${id}`, reference_rate: "12.00", sort_order: sortOrder,
    unit_allows_decimals: true, unit_code: "square_meter", unit_id: "1", unit_is_active: true, unit_name: "Metro cuadrado",
    unit_symbol: "m²", updated_at: "2026-10-19T00:00:00.000Z",
  });
  const server = await startServer(context, () => ({ rows: [row(4, 1), row(9, 2), row(3, 5)] }));
  server.setUser(ADMIN);
  const response = await server.send("GET", "?limit=2&search=SRV");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(response.body.services.map((service) => service.id), [4, 9]);
  assert.equal(response.body.services[0].referenceRate, "12.00");
  assert.deepEqual(response.body.services[0].measurementUnit, {
    allowsDecimals: true, code: "square_meter", id: 1, isActive: true, name: "Metro cuadrado", symbol: "m²",
  });
  assert.deepEqual(JSON.parse(Buffer.from(response.body.nextCursor, "base64url").toString()), [2, "9"]);
});
