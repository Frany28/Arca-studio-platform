import assert from "node:assert/strict";
import test from "node:test";

import { startAdminRouterServer } from "./helpers/adminRouterServer.js";

// El transporte simulado nunca consulta la base configurada ni requiere dotenv.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.ROUTE_AUTH_DISABLED_FOR_TESTS = "false";
const { pool } = await import("../src/config/db.js");
const { measurementUnitDenominationRouter, measurementUnitRouter } = await import("../src/routes/measurementUnits.js");

const ADMIN = { id: 2, role: { code: "admin" } };
const ROUTES = [
  ["/api/admin/measurement-units", measurementUnitRouter],
  ["/api/admin/measurement-unit-denominations", measurementUnitDenominationRouter],
];
const UNITS = "/api/admin/measurement-units";
const DENOMINATIONS = "/api/admin/measurement-unit-denominations";

/**
 * Levanta los routers de unidades con el pool simulado.
 *
 * @param {import("node:test").TestContext} context - Contexto de la prueba.
 * @param {(sql: string) => object} [respond] - Respuesta a consultas que no son del rate limit.
 * @returns {Promise<object>} Cliente HTTP y estado.
 */
function startServer(context, respond) {
  return startAdminRouterServer(context, { pool, respond, routes: ROUTES });
}

const REQUESTS = [
  ["GET", UNITS], ["GET", DENOMINATIONS], ["GET", `${DENOMINATIONS}/1`],
  ["POST", DENOMINATIONS, { denomination: "de construcción", measurementUnitId: 1 }],
  ["PATCH", `${DENOMINATIONS}/1`, { denomination: "de obra" }], ["PATCH", `${DENOMINATIONS}/1/status`, { isActive: false }],
  ["DELETE", `${DENOMINATIONS}/1`], ["POST", UNITS, { code: "x" }],
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

test("datos inválidos responden 400 antes de consultar PostgreSQL", async (context) => {
  const server = await startServer(context);
  server.setUser(ADMIN);
  for (const [method, path, body, field] of [
    ["POST", DENOMINATIONS, { denomination: "   ", measurementUnitId: 1 }, "body.denomination"],
    ["POST", DENOMINATIONS, { denomination: "de obra" }, "body.measurementUnitId"],
    ["PATCH", `${DENOMINATIONS}/1`, { denomination: "de obra", measurementUnitId: 2 }, "body"],
    ["PATCH", `${DENOMINATIONS}/1/status`, { isActive: "no" }, "body.isActive"],
    ["GET", `${DENOMINATIONS}?status=deleted`, undefined, "query.status"],
    ["GET", `${UNITS}?includeInactive=yes`, undefined, "query.includeInactive"],
  ]) {
    const response = await server.send(method, path, body);
    assert.equal(response.status, 400, `${method} ${path}`);
    assert.equal(response.body.code, "VALIDATION_ERROR");
    assert.ok(Object.keys(response.body.fields).some((key) => key.startsWith(field)), `${field} en ${JSON.stringify(response.body.fields)}`);
  }
  assert.deepEqual(server.queries, []);
});

test("las unidades base son de solo lectura y las denominaciones no se eliminan (405)", async (context) => {
  const server = await startServer(context);
  server.setUser(ADMIN);
  for (const [method, path] of [["POST", UNITS], ["PATCH", `${UNITS}/1`], ["DELETE", `${UNITS}/1`]]) {
    const response = await server.send(method, path, {});
    assert.equal(response.status, 405, `${method} ${path}`);
    assert.equal(response.body.code, "MEASUREMENT_UNIT_READ_ONLY");
    assert.equal(response.headers.get("allow"), "GET");
  }
  const deletion = await server.send("DELETE", `${DENOMINATIONS}/1`);
  assert.equal(deletion.status, 405);
  assert.equal(deletion.body.code, "MEASUREMENT_UNIT_DELETION_NOT_ALLOWED");
  assert.equal(deletion.headers.get("allow"), "GET, PATCH");
  assert.deepEqual(server.queries, []);
});

test("una denominación inexistente responde 404 en consulta, edición y estado, revirtiendo la transacción", async (context) => {
  const server = await startServer(context, () => ({ rowCount: 0, rows: [] }));
  server.setUser(ADMIN);
  for (const [method, path, body] of [
    ["GET", `${DENOMINATIONS}/999`], ["PATCH", `${DENOMINATIONS}/999`, { denomination: "de obra" }], ["PATCH", `${DENOMINATIONS}/999/status`, { isActive: false }],
  ]) {
    const response = await server.send(method, path, body);
    assert.equal(response.status, 404, `${method} ${path}`);
    assert.equal(response.body.code, "MEASUREMENT_UNIT_DENOMINATION_NOT_FOUND");
  }
  assert.ok(server.queries.includes("rollback"));
  assert.ok(!server.queries.some((sql) => /update public\.measurement_unit_denominations/.test(sql)));
});

test("el Dropdown recibe las unidades base con abreviatura y nombre completo, sin caché", async (context) => {
  const server = await startServer(context, () => ({ rows: [
    { allows_decimals: true, code: "square_meter", id: "1", is_active: true, name: "Metro cuadrado", sort_order: 1, symbol: "m²" },
    { allows_decimals: false, code: "point", id: "3", is_active: true, name: "Punto", sort_order: 3, symbol: "pt." },
  ] }));
  server.setUser(ADMIN);
  const response = await server.send("GET", UNITS);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(response.body.measurementUnits[0], {
    allowsDecimals: true, code: "square_meter", id: 1, isActive: true, name: "Metro cuadrado", sortOrder: 1, symbol: "m²",
  });
  assert.deepEqual(response.body.measurementUnits.map((unit) => unit.symbol), ["m²", "pt."]);
});
