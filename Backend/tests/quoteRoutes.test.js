import assert from "node:assert/strict";
import test from "node:test";

import { startAdminRouterServer } from "./helpers/adminRouterServer.js";
import { createQuoteDatabaseMock } from "./helpers/quoteDatabaseMock.js";

// El transporte simulado nunca consulta la base configurada ni requiere dotenv.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.ROUTE_AUTH_DISABLED_FOR_TESTS = "false";
const { pool } = await import("../src/config/db.js");
const { default: quoteRouter } = await import("../src/routes/quotes.js");

const ADMIN = { id: 2, role: { code: "admin" } };
const VALID_CREATE = {
  clientId: 3,
  items: [
    { quantity: "200", serviceId: 1, unitRate: "12" },
    { quantity: "35", serviceId: 2, unitRate: "45" },
  ],
  notes: "Incluye dos visitas de obra.",
  projectId: 9,
};

/**
 * Levanta el router de cotizaciones con la base simulada y una sesión de administrador.
 *
 * @param {import("node:test").TestContext} context - Contexto que cierra el servidor y restaura mocks.
 * @param {object} [options] - Opciones.
 * @param {boolean} [options.authenticated=true] - Inicia la sesión de administrador.
 * @returns {Promise<object>} Cliente HTTP, base simulada y sentencias registradas.
 */
async function startServer(context, { authenticated = true } = {}) {
  const database = createQuoteDatabaseMock();
  const server = await startAdminRouterServer(context, { pool, respond: database.respond, routes: [["/api/admin/quotes", quoteRouter]] });
  if (authenticated) server.setUser(ADMIN);
  return {
    ...server,
    database,
    raw: (method, path, headers) => server.raw(method, `/api/admin/quotes${path}`, headers),
    send: (method, path, body) => server.send(method, `/api/admin/quotes${path}`, body),
  };
}

/**
 * Crea una cotización válida y devuelve la respuesta de la API.
 *
 * @param {object} server - Cliente de startServer.
 * @param {object} [overrides] - Campos del cuerpo que se sustituyen.
 * @returns {Promise<object>} Respuesta del alta.
 */
function createQuote(server, overrides = {}) {
  return server.send("POST", "", { ...VALID_CREATE, ...overrides });
}

test("sin sesión responde 401 y sin rol administrador 403, sin consultar PostgreSQL", async (context) => {
  const server = await startServer(context, { authenticated: false });
  const requests = [
    ["GET", ""], ["GET", "/summary"], ["GET", "/clients"], ["GET", "/clients/3/projects"], ["GET", "/1"],
    ["GET", "/1/pdf"], ["POST", "", VALID_CREATE], ["PATCH", "/1", { ...VALID_CREATE, expectedVersion: 1 }],
  ];
  for (const [method, path, body] of requests) {
    assert.equal((await server.send(method, path, body)).status, 401, `${method} ${path}`);
  }
  for (const role of ["client", "architect"]) {
    server.setUser({ id: 7, role: { code: role } });
    for (const [method, path, body] of requests) {
      const response = await server.send(method, path, body);
      assert.equal(response.status, 403, `${role} ${method} ${path}`);
      assert.equal(response.body.code, "FORBIDDEN");
    }
  }
  assert.deepEqual(server.database.statements, []);
});

test("alta: calcula importes en el servidor, genera COT-001 y bloquea cliente, proyecto y servicios", async (context) => {
  const server = await startServer(context);
  const response = await createQuote(server);
  assert.equal(response.status, 201);
  const { quote } = response.body;
  assert.equal(quote.code, "COT-001");
  assert.equal(quote.currentVersion, 1);
  assert.deepEqual(quote.client, { id: 3, name: "Leonel Pérez" });
  assert.deepEqual(quote.project, { id: 9, name: "Apto. 910" });
  assert.equal(quote.servicesTotal, "3975.00");
  assert.deepEqual(quote.items.map((item) => [item.service.code, item.unit.label, item.quantity, item.unitRate, item.subtotal]), [
    ["SERV-001", "m² de construcción", "200.000", "12.00", "2400.00"],
    ["SERV-002", "pt. eléctrico", "35.000", "45.00", "1575.00"],
  ]);
  assert.equal(quote.notes, "Incluye dos visitas de obra.");
  assert.deepEqual(quote.version.createdBy, { hasProfilePhoto: true, id: 2, name: "Leonel Peréz" });

  const statements = server.database.statements;
  assert.equal(statements[0], "begin");
  assert.equal(statements.at(-1), "commit");
  assert.ok(statements.some((sql) => sql.includes("from public.clients where id = $1 for share")), "Cliente FOR SHARE");
  assert.ok(statements.some((sql) => sql.includes("from public.projects where id = $1 for share")), "Proyecto FOR SHARE");
  assert.ok(statements.some((sql) => sql.includes("order by id for share")), "Servicios FOR SHARE en orden de id");
});

test("varias unidades: exige elegir, rechaza la tarifa pendiente y cotiza la confirmada con su referencia", async (context) => {
  // Servicio 4 «Modelado 3D & Renders»: proyecto ($450) y espacio (pendiente de validación comercial).
  const server = await startServer(context);
  const line = { quantity: "1", serviceId: 4, unitRate: "450" };
  for (const [item, message] of [
    [line, /Elige la unidad/],
    [{ ...line, unitOptionPosition: 2 }, /pendiente de validación comercial/],
    [{ ...line, unitOptionPosition: 3 }, /no existe/],
  ]) {
    const rejected = await createQuote(server, { items: [item] });
    assert.equal(rejected.status, 400, JSON.stringify(item));
    assert.match(rejected.body.fields["items.0.unitOptionPosition"], message);
  }
  assert.ok(!server.database.statements.some((sql) => sql.startsWith("insert into")), "Ningún rechazo escribe");

  const created = await createQuote(server, { items: [{ ...line, unitOptionPosition: 1 }] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const [item] = created.body.quote.items;
  assert.deepEqual([item.unit.label, item.unit.position, item.referenceRate, item.subtotal], ["proy.", 1, "450.00", "450.00"]);
  assert.equal(server.database.state.items[0].serviceVersionUnitOptionId, 400, "Se guarda la unidad copiada de la versión");

  // Editar sin reenviar la posición conserva la unidad cotizada; cambiar a la pendiente se rechaza.
  const kept = await server.send("PATCH", "/1", { ...VALID_CREATE, expectedVersion: 1, items: [{ ...line, quantity: "2" }] });
  assert.equal(kept.status, 200, JSON.stringify(kept.body));
  assert.equal(kept.body.quote.items[0].unit.position, 1);
  const pending = await server.send("PATCH", "/1", { ...VALID_CREATE, expectedVersion: 2, items: [{ ...line, unitOptionPosition: 2 }] });
  assert.equal(pending.status, 400);
});

test("alta: rechaza cliente inactivo, proyecto ajeno o eliminado y servicios inactivos o repetidos sin escribir", async (context) => {
  const server = await startServer(context);
  const cases = [
    [{ clientId: 4, projectId: 10 }, "clientId", "El cliente seleccionado está inactivo o fue eliminado."],
    [{ clientId: 99 }, "clientId", "El cliente seleccionado no existe."],
    [{ projectId: 10 }, "projectId", "El proyecto no pertenece al cliente seleccionado."],
    [{ projectId: 11 }, "projectId", "El proyecto seleccionado fue eliminado."],
    [{ items: [{ quantity: "1", serviceId: 3, unitRate: "8" }] }, "items.0.serviceId", "El servicio está inactivo y no puede añadirse a la cotización."],
    [{ items: [{ quantity: "1", serviceId: 404, unitRate: "8" }] }, "items.0.serviceId", "El servicio seleccionado no existe."],
    [{ items: [VALID_CREATE.items[0], VALID_CREATE.items[0]] }, "items.1.serviceId", "Este servicio ya está incluido en la cotización."],
    [{ items: [{ quantity: "2.5", serviceId: 2, unitRate: "45" }] }, "items.0.quantity", "La unidad de este servicio solo admite cantidades enteras."],
    [{ items: [{ quantity: "0", serviceId: 1, unitRate: "12" }] }, "items.0.quantity", "Debe ser mayor que cero."],
  ];
  for (const [overrides, field, message] of cases) {
    const response = await createQuote(server, overrides);
    assert.equal(response.status, 400, JSON.stringify(overrides));
    assert.equal(response.body.code, "VALIDATION_ERROR");
    assert.equal(response.body.fields[field], message, JSON.stringify(response.body.fields));
  }
  assert.equal(server.database.state.quotes.length, 0, "Ningún rechazo deja una cotización");
  assert.equal(server.database.statements.filter((sql) => sql === "rollback").length, cases.length);
});

test("alta: entradas mal formadas responden 400 antes de consultar PostgreSQL", async (context) => {
  const server = await startServer(context);
  for (const body of [{ ...VALID_CREATE, items: [] }, { ...VALID_CREATE, items: [{ quantity: "1.2345", serviceId: 1, unitRate: "1" }] }, { ...VALID_CREATE, total: "1" }]) {
    const response = await server.send("POST", "", body);
    assert.equal(response.status, 400);
    assert.equal(response.body.code, "VALIDATION_ERROR");
  }
  assert.deepEqual(server.database.statements, []);
});

test("edición: versiona solo cambios efectivos y respeta expectedVersion", async (context) => {
  const server = await startServer(context);
  const { quote } = (await createQuote(server)).body;

  const unchanged = await server.send("PATCH", `/${quote.id}`, { ...VALID_CREATE, expectedVersion: 1, items: [
    { quantity: "200.000", serviceId: 1, unitRate: "12.00" }, { quantity: "35", serviceId: 2, unitRate: "45.00" },
  ] });
  assert.equal(unchanged.status, 200);
  assert.equal(unchanged.body.changed, false);
  assert.equal(unchanged.body.quote.currentVersion, 1);
  assert.equal(server.database.state.versions.length, 1, "Sin cambios no hay versión nueva");

  const changed = await server.send("PATCH", `/${quote.id}`, { ...VALID_CREATE, expectedVersion: 1, items: [{ quantity: "100", serviceId: 1, unitRate: "12" }], notes: "" });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.changed, true);
  assert.equal(changed.body.quote.currentVersion, 2);
  assert.equal(changed.body.quote.servicesTotal, "1200.00");
  assert.equal(changed.body.quote.notes, null);
  assert.deepEqual(server.database.state.versions.map((version) => [version.versionNumber, version.isCurrent]), [[1, false], [2, true]]);

  const stale = await server.send("PATCH", `/${quote.id}`, { ...VALID_CREATE, expectedVersion: 1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "QUOTE_VERSION_CONFLICT");

  const missing = await server.send("PATCH", "/999", { ...VALID_CREATE, expectedVersion: 1 });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, "QUOTE_NOT_FOUND");
});

test("edición: un servicio ya cotizado conserva su versión aunque se desactive; uno nuevo inactivo se rechaza", async (context) => {
  const server = await startServer(context);
  const { quote } = (await createQuote(server)).body;
  const { services, serviceVersions } = server.database.state;
  // El tabulador cambia después de cotizar: el servicio 1 pasa a la versión 11 y luego se desactiva.
  serviceVersions.set(11, { ...serviceVersions.get(10), id: 11, name: "Anteproyecto renombrado", referenceRate: "15.00" });
  services.set(1, { currentVersionId: 11, id: 1, isActive: false });

  const kept = await server.send("PATCH", `/${quote.id}`, { ...VALID_CREATE, expectedVersion: 1, items: [{ quantity: "50", serviceId: 1, unitRate: "12" }] });
  assert.equal(kept.status, 200);
  assert.deepEqual(kept.body.quote.items.map((item) => [item.service.versionId, item.service.name, item.referenceRate, item.service.isActive]), [
    [10, "Anteproyecto arquitectónico", "12.00", false],
  ]);

  const added = await server.send("PATCH", `/${quote.id}`, { ...VALID_CREATE, expectedVersion: 2, items: [{ quantity: "1", serviceId: 3, unitRate: "8" }] });
  assert.equal(added.status, 400);
  assert.equal(added.body.fields["items.0.serviceId"], "El servicio está inactivo y no puede añadirse a la cotización.");
});

test("lecturas: detalle 404, resumen con el total y proyectos de un cliente inexistente 404", async (context) => {
  const server = await startServer(context);
  assert.equal((await server.send("GET", "/1")).body.code, "QUOTE_NOT_FOUND");
  await createQuote(server);
  await createQuote(server);
  assert.deepEqual((await server.send("GET", "/summary")).body, { summary: { total: 2 } });
  const detail = await server.send("GET", "/2");
  assert.equal(detail.status, 200);
  assert.equal(detail.headers.get("cache-control"), "no-store");
  assert.equal(detail.body.quote.code, "COT-002");
});

test("PDF: se transmite como descarga protegida con ETag por versión y responde 304 si no cambió", async (context) => {
  const server = await startServer(context);
  const { quote } = (await createQuote(server)).body;
  const response = await server.raw("GET", `/${quote.id}/pdf?timeZone=America%2FCaracas`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="COT-001.pdf"');
  assert.match(response.headers.get("content-security-policy"), /sandbox/);
  assert.equal(response.headers.get("cache-control"), "private, no-cache");
  const etag = response.headers.get("etag");
  assert.equal(etag, '"quote-1-v1-America%2FCaracas-r1"');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");

  const cached = await server.raw("GET", `/${quote.id}/pdf?timeZone=America%2FCaracas`, { "If-None-Match": etag });
  assert.equal(cached.status, 304);
  // Otra zona horaria cambia la fecha impresa y, por tanto, el documento.
  assert.equal((await server.raw("GET", `/${quote.id}/pdf?timeZone=UTC`, { "If-None-Match": etag })).status, 200);
  assert.equal((await server.raw("GET", "/99/pdf")).status, 404);
});
