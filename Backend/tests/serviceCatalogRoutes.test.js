import assert from "node:assert/strict";
import test from "node:test";

import { startAdminRouterServer } from "./helpers/adminRouterServer.js";

// El transporte simulado nunca consulta la base configurada ni requiere dotenv.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.ROUTE_AUTH_DISABLED_FOR_TESTS = "false";
const { pool } = await import("../src/config/db.js");
const { default: serviceCatalogRouter } = await import("../src/routes/serviceCatalog.js");

const ADMIN = { id: 2, role: { code: "admin" } };
const VALID_CREATE = { measurementUnitId: 1, name: "Anteproyecto", referenceRate: "12" };

/**
 * Levanta el router del catálogo y devuelve un cliente cuyas rutas son relativas a /api/admin/services.
 *
 * @param {import("node:test").TestContext} context - Contexto que cierra el servidor y restaura mocks.
 * @param {(sql: string) => object} [respond] - Respuesta a consultas que no son del rate limit.
 * @returns {Promise<{ send: Function, setUser: Function, queries: Array<string> }>} Cliente HTTP y estado.
 */
async function startServer(context, respond) {
  const server = await startAdminRouterServer(context, { pool, respond, routes: [["/api/admin/services", serviceCatalogRouter]] });
  return { ...server, send: (method, path, body) => server.send(method, `/api/admin/services${path}`, body) };
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
    // El código lo fija el sistema y la modalidad solo admite individual o turnkey.
    ["POST", "", { ...VALID_CREATE, code: "SERV-001" }, "body.code"],
    ["POST", "", { ...VALID_CREATE, kind: "bundle" }, "body.kind"],
    ["PATCH", "/1", { expectedVersion: 1, kind: "llave" }, "body.kind"],
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

const UNIT_ROWS = {
  1: { allows_decimals: true, code: "square_meter", id: "1", is_active: true, name: "Metro cuadrado", sort_order: 101, symbol: "m²" },
  6: { allows_decimals: true, code: "linear_meter", id: "6", is_active: true, name: "Metro lineal", sort_order: 201, symbol: "m.l." },
};

/**
 * Simula PostgreSQL en el alta: unidades por id, reserva del id 7 con su código libre, inserción
 * y lectura del servicio creado con la modalidad realmente insertada. Registra las inserciones.
 *
 * @returns {{ respond: (sql: string, params?: Array<unknown>) => object, inserts: Array<{ sql: string, params: Array<unknown> }> }} Mock.
 */
function createCatalogDatabase() {
  const inserts = [];
  let inserted = null;
  const respond = (sql, params = []) => {
    if (/from public\.measurement_units\s+where id = \$1/.test(sql)) {
      const row = UNIT_ROWS[params[0]];
      return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
    }
    if (sql.includes("nextval(")) return { rowCount: 1, rows: [{ id: "7" }] };
    if (sql.includes("select 1 from public.services where code")) return { rowCount: 0, rows: [] };
    if (sql.includes("insert into public.services")) {
      inserts.push({ params, sql });
      inserted = params;
      return { rowCount: 1, rows: [{ id: params[0] }] };
    }
    if (sql.includes("insert into public.service_versions")) {
      inserts.push({ params, sql });
      return { rowCount: 1, rows: [] };
    }
    if (inserted && /from public\.services s\b/.test(sql)) {
      const unit = UNIT_ROWS[inserted[5]];
      return {
        rowCount: 1,
        rows: [{
          code: inserted[1], created_at: "2026-10-22T00:00:00.000Z", currency_code: "USD", current_version: 1, denomination_id: null,
          description: inserted[3], id: inserted[0], is_active: inserted[8], kind: inserted[4], name: inserted[2], reference_rate: inserted[6],
          sort_order: inserted[9], unit_allows_decimals: unit.allows_decimals, unit_code: unit.code, unit_id: unit.id, unit_is_active: true,
          unit_name: unit.name, unit_symbol: unit.symbol, updated_at: "2026-10-22T00:00:00.000Z",
        }],
      };
    }
    return { rowCount: 0, rows: [] };
  };
  return { inserts, respond };
}

test("alta: crea servicios individuales y llave en mano con código generado y versión 1", async (context) => {
  for (const [body, expectedKind] of [
    [VALID_CREATE, "individual"],
    [{ ...VALID_CREATE, kind: "individual", measurementUnitId: 6 }, "individual"],
    [{ ...VALID_CREATE, kind: "turnkey", measurementUnitId: 1, referenceRate: "850.50" }, "turnkey"],
  ]) {
    const database = createCatalogDatabase();
    const server = await startServer(context, database.respond);
    server.setUser(ADMIN);
    const response = await server.send("POST", "", body);
    assert.equal(response.status, 201, JSON.stringify(body));
    assert.equal(response.body.service.kind, expectedKind);
    assert.equal(response.body.service.code, "SERV-007", "El código lo genera el sistema a partir del id");
    assert.equal(response.body.service.currentVersion, 1);
    assert.equal(response.body.service.referenceRate, body.referenceRate === "850.50" ? "850.50" : "12.00");
    // La modalidad elegida es la que se inserta y la versión 1 se escribe en la misma transacción.
    const [serviceInsert, versionInsert] = database.inserts;
    assert.equal(serviceInsert.params[4], expectedKind);
    assert.match(versionInsert.sql, /insert into public\.service_versions/);
    assert.equal(versionInsert.params.includes(1), true, "Versión 1");
    assert.ok(server.queries.includes("commit"));
  }
});

test("alta: llave en mano con una unidad que no es m² responde 400 y no inserta nada", async (context) => {
  const database = createCatalogDatabase();
  const server = await startServer(context, database.respond);
  server.setUser(ADMIN);
  const response = await server.send("POST", "", { ...VALID_CREATE, kind: "turnkey", measurementUnitId: 6 });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, "VALIDATION_ERROR");
  assert.equal(response.body.fields.measurementUnitId, "Las modalidades llave en mano requieren una unidad de superficie en metros cuadrados.");
  assert.deepEqual(database.inserts, []);
  assert.ok(server.queries.includes("rollback"));
  assert.ok(!server.queries.some((sql) => sql.includes("nextval(")), "No reserva código si la modalidad es incompatible");
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
  // Compatibilidad: sin denominación el servicio usa solo la base y la etiqueta es la abreviatura.
  assert.equal(response.body.services[0].unitDenomination, null);
  assert.equal(response.body.services[0].unitLabel, "m²");
  assert.deepEqual(JSON.parse(Buffer.from(response.body.nextCursor, "base64url").toString()), [2, "9"]);
});
