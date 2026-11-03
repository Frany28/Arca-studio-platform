import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { startAdminRouterServer } from "./helpers/adminRouterServer.js";
import { createQuoteDatabaseMock } from "./helpers/quoteDatabaseMock.js";
import { mockQuotePdfStorage } from "./helpers/quotePdfMock.js";
import { objectStorage } from "../src/services/objectStorage.js";

// El transporte simulado nunca consulta la base configurada ni requiere dotenv.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.ROUTE_AUTH_DISABLED_FOR_TESTS = "false";
process.env.SUPABASE_QUOTE_PDF_BUCKET = "quotes-private-test";
process.env.SUPABASE_STORAGE_BUCKET = "general-test";
const { pool } = await import("../src/config/db.js");
const { default: quoteRouter } = await import("../src/routes/quotes.js");

const ADMIN = { id: 2, role: { code: "admin" } };
const VALID_CREATE = {
  clientId: 3,
  items: [
    { quantity: "200", serviceId: 1, unitRate: "14" },
    { quantity: "35", serviceId: 2, unitRate: "47" },
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
  const storage = mockQuotePdfStorage(context, objectStorage);
  const database = createQuoteDatabaseMock();
  const server = await startAdminRouterServer(context, { pool, respond: database.respond, routes: [["/api/admin/quotes", quoteRouter]] });
  if (authenticated) server.setUser(ADMIN);
  return {
    ...server,
    database,
    storage,
    raw: (method, path, headers) => server.raw(method, `/api/admin/quotes${path}`, headers),
    send: (method, path, body) => server.send(method, `/api/admin/quotes${path}`, body),
  };
}

/**
 * Crea una cotización válida con un identificador de envío nuevo y devuelve la respuesta de la API.
 *
 * @param {object} server - Cliente de startServer.
 * @param {object} [overrides] - Campos del cuerpo que se sustituyen.
 * @returns {Promise<object>} Respuesta del alta.
 */
function createQuote(server, overrides = {}) {
  return server.send("POST", "", { ...VALID_CREATE, submissionId: randomUUID(), ...overrides });
}

test("sin sesión responde 401 y sin rol administrador 403, sin consultar PostgreSQL", async (context) => {
  const server = await startServer(context, { authenticated: false });
  const requests = [
    ["GET", ""], ["GET", "/summary"], ["GET", "/clients"], ["GET", "/clients/3/projects"], ["GET", "/1"],
    ["GET", "/1/pdf"], ["POST", "/1/pdf/retry"], ["POST", "", VALID_CREATE], ["PATCH", "/1", { ...VALID_CREATE, expectedVersion: 1 }],
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
  assert.equal(quote.servicesTotal, "4445.00");
  assert.deepEqual(quote.items.map((item) => [item.service.code, item.unit.label, item.quantity, item.unitRate, item.subtotal]), [
    ["SERV-001", "m² de construcción", "200.000", "14.00", "2800.00"],
    ["SERV-002", "pt. eléctrico", "35.000", "47.00", "1645.00"],
  ]);
  assert.equal(quote.notes, "Incluye dos visitas de obra.");
  assert.deepEqual(quote.version.createdBy, { hasProfilePhoto: true, id: 2, name: "Leonel Peréz" });

  const statements = server.database.statements;
  assert.equal(statements[0], "begin");
  assert.ok(statements.indexOf("commit") < statements.findIndex((sql) => sql.includes("attempts = attempts + 1")), "El COMMIT precede a la generación y subida");
  assert.ok(statements.some((sql) => sql.includes("from public.clients where id = $1 for share")), "Cliente FOR SHARE");
  assert.ok(statements.some((sql) => sql.includes("from public.projects where id = $1 for share")), "Proyecto FOR SHARE");
  assert.ok(statements.some((sql) => sql.includes("order by id for share")), "Servicios FOR SHARE en orden de id");
});

test("unidad única: cotiza la unidad del servicio con su tarifa de referencia y la tarifa aplicada elegida", async (context) => {
  // Servicio 4 «Modelado 3D & Renders»: versión anterior a la unidad única, con proyecto ($320) y
  // una alternativa histórica (espacio). Solo se cotiza la unidad del servicio (posición 1).
  const server = await startServer(context);
  const line = { quantity: "1", serviceId: 4, unitRate: "300" };
  const rejected = await createQuote(server, { items: [{ ...line, unitOptionPosition: 2 }] });
  assert.equal(rejected.status, 400, "El concepto ya no elige unidad");
  assert.equal(rejected.body.code, "VALIDATION_ERROR");
  assert.deepEqual(server.database.statements, [], "Se rechaza antes de consultar PostgreSQL");

  const created = await createQuote(server, { items: [line] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const [item] = created.body.quote.items;
  // La tarifa aplicada la decide el administrador; la de referencia sigue siendo la del tabulador.
  assert.deepEqual([item.unit.label, item.unit.position, item.referenceRate, item.unitRate, item.subtotal], ["proy.", 1, "320.00", "300.00", "300.00"]);
  assert.equal(server.database.state.items[0].serviceVersionUnitOptionId, 400, "Se guarda la unidad copiada de la versión");

  const kept = await server.send("PATCH", "/1", { ...VALID_CREATE, expectedVersion: 1, items: [{ ...line, quantity: "2" }] });
  assert.equal(kept.status, 200, JSON.stringify(kept.body));
  assert.equal(kept.body.quote.items[0].unit.position, 1);
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
    [{ items: [{ quantity: "2.5", serviceId: 2, unitRate: "47" }] }, "items.0.quantity", "La unidad de este servicio solo admite cantidades enteras."],
    [{ items: [{ quantity: "0", serviceId: 1, unitRate: "14" }] }, "items.0.quantity", "Debe ser mayor que cero."],
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
    { quantity: "200.000", serviceId: 1, unitRate: "14.00" }, { quantity: "35", serviceId: 2, unitRate: "47.00" },
  ] });
  assert.equal(unchanged.status, 200);
  assert.equal(unchanged.body.changed, false);
  assert.equal(unchanged.body.quote.currentVersion, 1);
  assert.equal(server.database.state.versions.length, 1, "Sin cambios no hay versión nueva");

  const changed = await server.send("PATCH", `/${quote.id}`, { ...VALID_CREATE, expectedVersion: 1, items: [{ quantity: "100", serviceId: 1, unitRate: "14" }], notes: "" });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.changed, true);
  assert.equal(changed.body.quote.currentVersion, 2);
  assert.equal(changed.body.quote.servicesTotal, "1400.00");
  assert.equal(changed.body.quote.notes, null);
  assert.deepEqual(server.database.state.versions.map((version) => [version.versionNumber, version.isCurrent]), [[1, false], [2, true]]);

  const stale = await server.send("PATCH", `/${quote.id}`, { ...VALID_CREATE, expectedVersion: 1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "QUOTE_VERSION_CONFLICT");

  const missing = await server.send("PATCH", "/999", { ...VALID_CREATE, expectedVersion: 1 });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, "QUOTE_NOT_FOUND");
});

test("IVA referencial: 16 % fijo guardado con la versión; la edición conserva la tasa y los importes de su versión", async (context) => {
  const server = await startServer(context);
  const { quote } = (await createQuote(server)).body;
  assert.equal(quote.servicesTotal, "4445.00");
  assert.deepEqual(quote.referenceVat, { amount: "711.20", enabled: true, isReferenceOnly: true, rate: "16.00" });
  assert.equal(quote.estimatedTotalWithVat, "5156.20");
  assert.deepEqual(server.database.state.versions.map((version) => [version.referenceVatEnabled, version.referenceVatRate, version.referenceVatAmount]), [[true, "16.00", "711.20"]]);

  // Cambiar cantidades recalcula el IVA con la tasa guardada.
  const edited = await server.send("PATCH", `/${quote.id}`, { ...VALID_CREATE, expectedVersion: 1, items: [{ quantity: "100", serviceId: 1, unitRate: "14.05" }] });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.quote.servicesTotal, "1405.00");
  assert.deepEqual(edited.body.quote.referenceVat, { amount: "224.80", enabled: true, isReferenceOnly: true, rate: "16.00" });
  assert.equal(edited.body.quote.estimatedTotalWithVat, "1629.80");

  // Una versión guardada con otra tasa (histórica) la conserva al editarse.
  const historic = server.database.state.versions.find((version) => version.isCurrent);
  Object.assign(historic, { referenceVatAmount: "175.63", referenceVatRate: "12.50" });
  const kept = await server.send("PATCH", `/${quote.id}`, { ...VALID_CREATE, expectedVersion: 2, items: [{ quantity: "200", serviceId: 1, unitRate: "14" }] });
  assert.deepEqual([kept.body.quote.referenceVat.rate, kept.body.quote.referenceVat.amount, kept.body.quote.estimatedTotalWithVat], ["12.50", "350.00", "3150.00"]);

  // Una versión anterior al IVA referencial sigue sin IVA y guardarla sin cambios no crea versión.
  const legacy = server.database.state.versions.find((version) => version.isCurrent);
  Object.assign(legacy, { referenceVatAmount: "0.00", referenceVatEnabled: false, referenceVatRate: null });
  const unchanged = await server.send("PATCH", `/${quote.id}`, { ...VALID_CREATE, expectedVersion: 3, items: [{ quantity: "200", serviceId: 1, unitRate: "14" }] });
  assert.equal(unchanged.body.changed, false);
  assert.deepEqual(unchanged.body.quote.referenceVat, { amount: "0.00", enabled: false, isReferenceOnly: true, rate: null });
  assert.equal(unchanged.body.quote.estimatedTotalWithVat, "2800.00");
});

test("edición: un servicio ya cotizado conserva su versión aunque se desactive; uno nuevo inactivo se rechaza", async (context) => {
  const server = await startServer(context);
  const { quote } = (await createQuote(server)).body;
  const { services, serviceVersions } = server.database.state;
  // El tabulador cambia después de cotizar: el servicio 1 pasa a la versión 11 y luego se desactiva.
  serviceVersions.set(11, { ...serviceVersions.get(10), id: 11, name: "Anteproyecto renombrado", referenceRate: "15.00" });
  services.set(1, { currentVersionId: 11, id: 1, isActive: false });

  const kept = await server.send("PATCH", `/${quote.id}`, { ...VALID_CREATE, expectedVersion: 1, items: [{ quantity: "50", serviceId: 1, unitRate: "14" }] });
  assert.equal(kept.status, 200);
  assert.deepEqual(kept.body.quote.items.map((item) => [item.service.versionId, item.service.name, item.referenceRate, item.service.isActive]), [
    [10, "Anteproyecto arquitectónico", "14.00", false],
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
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="COT-001-v1.pdf"');
  assert.match(response.headers.get("content-security-policy"), /sandbox/);
  assert.equal(response.headers.get("cache-control"), "private, no-cache");
  const etag = response.headers.get("etag");
  assert.match(etag, /^"[a-f0-9]{64}"$/);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");

  const cached = await server.raw("GET", `/${quote.id}/pdf?timeZone=America%2FCaracas`, { "If-None-Match": etag });
  assert.equal(cached.status, 304);
  // La zona del navegador no altera los bytes persistentes ni el ETag.
  assert.equal((await server.raw("GET", `/${quote.id}/pdf?timeZone=UTC`, { "If-None-Match": etag })).status, 304);
  assert.equal((await server.raw("GET", "/99/pdf")).status, 404);
});

// Alta sin proyecto existente: el nombre escrito crea un proyecto draft al guardar la cotización.
const { projectId: _existingProjectId, ...CREATE_WITHOUT_PROJECT } = VALID_CREATE;

/**
 * Crea una cotización sin proyecto existente (por defecto, con un proyecto nuevo) y un identificador
 * de envío nuevo salvo que se indique otro.
 *
 * @param {object} server - Cliente de startServer.
 * @param {object} [overrides] - Campos del cuerpo que se sustituyen.
 * @returns {Promise<object>} Respuesta del alta.
 */
function createDraftQuote(server, overrides = {}) {
  return server.send("POST", "", { ...CREATE_WITHOUT_PROJECT, submissionId: randomUUID(), ...overrides });
}

test("proyecto nuevo: el alta crea el draft del cliente en la misma transacción y lo vincula a la cotización", async (context) => {
  const server = await startServer(context);
  const response = await createDraftQuote(server, { newProjectName: "  Apartamento   Los Robles " });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const { quote } = response.body;
  const project = server.database.state.projects.get(quote.project.id);
  assert.deepEqual(quote.project, { id: 50, name: "Apartamento Los Robles" }, "Nombre normalizado en la versión");
  assert.deepEqual(
    [project.clientId, project.createdBy, project.status, project.publicSlug],
    [3, 2, "draft", "apartamento-los-robles-50"],
  );
  assert.deepEqual(server.database.state.auditLogs.map((log) => [log.action, log.entityType, log.entityId, log.newValues.quoteId]), [
    ["project.create_from_quote", "project", 50, quote.id],
  ]);

  const statements = server.database.statements;
  assert.equal(statements[0], "begin");
  assert.match(statements[1], /^select pg_advisory_xact_lock/, "El bloqueo del envío precede a cualquier comprobación");
  const projectInsert = statements.findIndex((sql) => sql.startsWith("insert into public.projects"));
  const quoteInsert = statements.findIndex((sql) => sql.startsWith("insert into public.quotes"));
  const versionInsert = statements.findIndex((sql) => sql.startsWith("insert into public.quote_versions"));
  assert.ok(projectInsert >= 0 && projectInsert < quoteInsert && quoteInsert < versionInsert, "Draft, cotización y versión en la misma transacción");
  assert.ok(statements.indexOf("commit") < statements.findIndex((sql) => sql.includes("attempts = attempts + 1")));
  assert.ok(!statements.some((sql) => sql.includes("from public.projects where id = $1 for share")), "No se bloquea un proyecto existente");
});

test("proyecto nuevo: coincidencia exacta, solicitud activa o cliente no disponible responden 400 sin crear nada", async (context) => {
  const server = await startServer(context);
  const cases = [
    [{ newProjectName: "APTO.  910" }, "newProjectName", "Ya existe el proyecto «Apto. 910» para este cliente. Selecciónalo en las sugerencias."],
    [{ newProjectName: "casa en revisión" }, "newProjectName", "Hay una solicitud de proyecto activa con este nombre para el cliente."],
    [{ clientId: 4, newProjectName: "Casa nueva" }, "clientId", "El cliente seleccionado está inactivo o fue eliminado."],
    [{ clientId: 99, newProjectName: "Casa nueva" }, "clientId", "El cliente seleccionado no existe."],
  ];
  for (const [overrides, field, message] of cases) {
    const response = await createDraftQuote(server, { ...overrides });
    assert.equal(response.status, 400, JSON.stringify(overrides));
    assert.equal(response.body.fields[field], message, JSON.stringify(response.body.fields));
  }
  assert.equal(server.database.state.quotes.length, 0);
  assert.equal(server.database.state.projects.size, 3, "Ningún draft creado");
  assert.equal(server.database.statements.filter((sql) => sql === "rollback").length, cases.length);
});

test("proyecto nuevo: un concepto inválido se rechaza antes de crear el draft", async (context) => {
  const server = await startServer(context);
  const response = await createDraftQuote(server, {
    items: [{ quantity: "1", serviceId: 3, unitRate: "8" }],
    newProjectName: "Casa nueva",
  });
  assert.equal(response.status, 400);
  assert.ok(response.body.fields["items.0.serviceId"]);
  assert.ok(!server.database.statements.some((sql) => sql.startsWith("insert into public.projects")));
  assert.equal(server.database.state.projects.size, 3);
});

test("proyecto: exactamente uno de projectId o newProjectName; la edición no crea proyectos", async (context) => {
  const server = await startServer(context);
  for (const [body, path] of [
    [{ ...VALID_CREATE, newProjectName: "Casa nueva" }, "body.newProjectName"],
    [CREATE_WITHOUT_PROJECT, "body.projectId"],
    [{ ...CREATE_WITHOUT_PROJECT, newProjectName: "ab" }, "body.newProjectName"],
    [{ ...CREATE_WITHOUT_PROJECT, newProjectName: "x".repeat(151) }, "body.newProjectName"],
    [{ ...VALID_CREATE, submissionId: "no-es-uuid" }, "body.submissionId"],
  ]) {
    const response = await server.send("POST", "", { submissionId: randomUUID(), ...body });
    assert.equal(response.status, 400, path);
    assert.ok(response.body.fields[path], `${path}: ${JSON.stringify(response.body.fields)}`);
  }
  assert.deepEqual(server.database.statements, [], "Se rechaza antes de consultar PostgreSQL");

  const { quote } = (await createQuote(server)).body;
  const edited = await server.send("PATCH", `/${quote.id}`, { ...CREATE_WITHOUT_PROJECT, expectedVersion: 1, newProjectName: "Casa nueva" });
  assert.equal(edited.status, 400);
  const withSubmission = await server.send("PATCH", `/${quote.id}`, { ...VALID_CREATE, expectedVersion: 1, submissionId: randomUUID() });
  assert.equal(withSubmission.status, 400);
});

test("edición: se puede elegir un proyecto draft existente del cliente", async (context) => {
  const server = await startServer(context);
  const draft = (await createDraftQuote(server, { newProjectName: "Casa del lago" })).body.quote.project;
  const { quote } = (await createQuote(server)).body;
  const edited = await server.send("PATCH", `/${quote.id}`, { ...VALID_CREATE, expectedVersion: 1, projectId: draft.id });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.deepEqual(edited.body.quote.project, draft);
  assert.equal(server.database.state.projects.size, 4, "La edición no crea proyectos");
});

test("idempotencia: el mismo envío devuelve la cotización registrada; otro contenido con el mismo id responde 409", async (context) => {
  const server = await startServer(context);
  const submissionId = randomUUID();
  const body = { newProjectName: "Casa del lago", submissionId };
  const first = await createDraftQuote(server, body);
  assert.equal(first.status, 201);

  // Mismo contenido expresado de otra forma (decimales y espacios): es el mismo envío.
  const retried = await createDraftQuote(server, {
    ...body,
    items: [{ quantity: "200.000", serviceId: 1, unitRate: "14.00" }, { quantity: "35", serviceId: 2, unitRate: "47" }],
    newProjectName: "Casa  del lago ",
  });
  assert.equal(retried.status, 200, JSON.stringify(retried.body));
  assert.equal(retried.body.replayed, true);
  assert.equal(retried.body.quote.id, first.body.quote.id);
  assert.deepEqual(retried.body.quote.project, first.body.quote.project);
  assert.equal(server.database.state.quotes.length, 1, "Sin cotizaciones adicionales");
  assert.equal(server.database.state.projects.size, 4, "Sin proyectos adicionales");
  assert.equal(server.database.state.auditLogs.length, 1);

  for (const changed of [{ notes: "Otra observación" }, { newProjectName: "Casa del Lago" }, { items: [VALID_CREATE.items[0]] }]) {
    const reused = await createDraftQuote(server, { ...body, ...changed });
    assert.equal(reused.status, 409, JSON.stringify(changed));
    assert.equal(reused.body.code, "QUOTE_SUBMISSION_REUSED");
  }
  assert.equal(server.database.state.quotes.length, 1);

  // El identificador es único por autor: otro administrador con el mismo id registra su alta.
  server.database.state.users.set(5, { firstName: "Ana", hasProfilePhoto: false, id: 5, lastName: "Gil" });
  server.setUser({ id: 5, role: { code: "admin" } });
  const other = await createQuote(server, { ...VALID_CREATE, submissionId });
  assert.equal(other.status, 201);
  assert.equal(server.database.state.quotes.length, 2);
});

test("errores de PostgreSQL: el nombre ocupado por un alta simultánea es un error del campo, no un 500", async () => {
  const { translateQuoteError } = await import("../src/services/quoteErrors.js");
  const nameTaken = translateQuoteError(Object.assign(new Error("dup"), { code: "23505", constraint: "uq_projects_client_active_name" }));
  assert.equal(nameTaken.code, "VALIDATION_ERROR");
  assert.ok(nameTaken.fields.newProjectName);
  const submission = translateQuoteError(Object.assign(new Error("dup"), { code: "23505", constraint: "uq_quotes_created_by_submission" }));
  assert.equal(submission.code, "QUOTE_CONCURRENT_UPDATE");
  const draftCheck = translateQuoteError(Object.assign(new Error("chk"), { code: "23514", constraint: "chk_projects_draft_requirements" }));
  assert.ok(draftCheck.fields.newProjectName);
});

test("compatibilidad: un cliente anterior sin submissionId crea la cotización como antes, sin idempotencia", async (context) => {
  const server = await startServer(context);
  // Cuerpo exacto del frontend publicado antes de la idempotencia: sin submissionId ni newProjectName.
  const first = await server.send("POST", "", VALID_CREATE);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.deepEqual(first.body.quote.project, { id: 9, name: "Apto. 910" });
  assert.equal(first.body.replayed, undefined);
  assert.ok(!server.database.statements.some((sql) => sql.startsWith("select pg_advisory_xact_lock")), "Sin bloqueo del envío");
  assert.ok(!server.database.statements.some((sql) => sql.includes("submission_fingerprint from public.quotes")), "Sin búsqueda de repetición");
  assert.deepEqual([server.database.state.quotes[0].submissionId, server.database.state.quotes[0].submissionFingerprint], [null, null]);
  // Como antes de la idempotencia, cada envío registra una cotización.
  assert.equal((await server.send("POST", "", VALID_CREATE)).status, 201);
  assert.equal(server.database.state.quotes.length, 2);
});

test("proyecto nuevo sin submissionId: 400 antes de consultar PostgreSQL y sin crear el draft", async (context) => {
  const server = await startServer(context);
  const response = await server.send("POST", "", { ...CREATE_WITHOUT_PROJECT, newProjectName: "Casa del Lago" });
  assert.equal(response.status, 400);
  assert.equal(response.body.fields["body.submissionId"], "Un proyecto nuevo requiere el identificador de envío.");
  assert.deepEqual(server.database.statements, []);
  assert.equal(server.database.state.projects.size, 3);
  // Con el identificador, la misma alta es válida e idempotente.
  assert.equal((await createDraftQuote(server, { newProjectName: "Casa del Lago" })).status, 201);
});

test("PDF automático: creación, edición, historial y cambios no efectivos", async (context) => {
  const server = await startServer(context);
  const created = await createQuote(server);
  assert.equal(created.body.quote.pdf.status, "available");
  assert.equal(server.storage.calls.put, 1, "Se almacena sin abrir el visor");
  const oldKey = "quotes/1/versions/v1/COT-001-v1.pdf";
  const oldBytes = server.storage.objects.get(oldKey).bytes;
  await server.send("PATCH", "/1", { ...VALID_CREATE, expectedVersion: 1 });
  assert.equal(server.storage.calls.put, 1, "changed:false no genera ni sube");
  const changed = await server.send("PATCH", "/1", { ...VALID_CREATE, expectedVersion: 1, notes: "Versión dos" });
  assert.equal(changed.body.quote.pdf.status, "available");
  assert.equal(server.storage.calls.put, 2);
  assert.equal(server.storage.objects.size, 2);
  assert.equal(server.storage.objects.get(oldKey).bytes, oldBytes);
  const historical = await server.raw("GET", "/1/pdf?version=1");
  assert.equal(historical.status, 200);
  assert.ok(Buffer.from(await historical.arrayBuffer()).equals(oldBytes));
  assert.equal((await server.raw("GET", "/1/pdf?version=99")).status, 404);
  assert.equal((await server.raw("GET", "/1/pdf?version=2147483648")).status, 400);
});

test("PDF: fallo de S3 conserva el Draft y replay recupera sin duplicar", async (context) => {
  const server = await startServer(context);
  server.storage.setFailPut(true);
  const body = { newProjectName: "Draft con PDF pendiente", submissionId: randomUUID() };
  const created = await createDraftQuote(server, body);
  assert.equal(created.status, 201);
  assert.equal(created.body.quote.pdf.status, "error");
  assert.equal(server.database.state.projects.size, 4);
  assert.equal((await server.raw("GET", "/1/pdf")).status, 409);
  assert.equal(server.storage.calls.get, 0, "El visor no genera ni lee un PDF no confirmado");
  server.storage.setFailPut(false);
  const replayed = await createDraftQuote(server, body);
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.replayed, true);
  assert.equal(replayed.body.quote.pdf.status, "available");
  assert.equal(server.database.pdf.rows.size, 1);
  assert.equal(server.database.state.quotes.length, 1);
  assert.equal(server.database.state.projects.size, 4);
  assert.equal(server.storage.objects.size, 1);
});

test("PDF: subida completada y confirmación fallida se adopta sin otro PUT", async (context) => {
  const server = await startServer(context);
  server.database.pdf.setFailComplete(true);
  const created = await createQuote(server);
  assert.equal(created.body.quote.pdf.status, "error");
  assert.equal(server.storage.objects.size, 1, "El objeto incierto conserva su reserva durable");
  server.database.pdf.setFailComplete(false);
  const retried = await server.send("POST", "/1/pdf/retry?version=1");
  assert.equal(retried.status, 200, JSON.stringify(retried.body));
  assert.equal(retried.body.pdf.status, "available");
  assert.equal(server.storage.calls.put, 1);
  assert.equal(server.database.state.versions.length, 1);
});

test("PDF: reserva interrumpida, solicitudes simultáneas y trabajador obsoleto", async (context) => {
  const server = await startServer(context);
  server.storage.setFailPut(true);
  await createQuote(server);
  server.storage.setFailPut(false);
  const row = server.database.pdf.rows.get(1);
  row.lease_token = randomUUID();
  row.lease_until = Date.now() + 600000;
  row.status = "pending";
  assert.equal((await server.send("POST", "/1/pdf/retry?version=1")).status, 202);
  assert.equal(server.storage.objects.size, 0);
  row.lease_until = Date.now() - 1;
  const before = server.storage.calls.put;
  const results = await Promise.all(Array.from({ length: 5 }, () => server.send("POST", "/1/pdf/retry?version=1")));
  assert.ok(results.some((response) => response.body.pdf.status === "available"));
  assert.equal(server.storage.calls.put, before + 1);
  assert.equal(server.database.pdf.rows.size, 1);
  const { completeQuotePdf, failQuotePdf } = await import("../src/repositories/quotePdfRepository.js");
  assert.equal(await completeQuotePdf(1, randomUUID()), null);
  await failQuotePdf(1, randomUUID(), "STALE");
  assert.equal(row.status, "available");
});

test("PDF: objeto perdido invalida el ETag y se reproduce exactamente desde su instantánea", async (context) => {
  const server = await startServer(context);
  await createQuote(server);
  const key = [...server.storage.objects.keys()][0];
  const original = server.storage.objects.get(key);
  const first = await server.raw("GET", "/1/pdf");
  await first.arrayBuffer();
  server.storage.objects.delete(key);
  const missing = await server.raw("GET", "/1/pdf", { "If-None-Match": first.headers.get("etag") });
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).code, "QUOTE_PDF_MISSING");
  server.database.state.clients.get(3).name = "Nombre cambiado";
  server.database.state.projects.get(9).name = "Proyecto cambiado";
  server.database.state.services.get(1).isActive = false;
  const retried = await server.send("POST", "/1/pdf/retry?version=1");
  assert.equal(retried.status, 200, JSON.stringify(retried.body));
  assert.ok(server.storage.objects.get(key).bytes.equals(original.bytes), "Regeneración binaria reproducible");
});

test("PDF: contenido corrupto se rechaza sin borrar ni sobrescribir", async (context) => {
  const server = await startServer(context);
  await createQuote(server);
  const stored = [...server.storage.objects.values()][0];
  stored.bytes = Buffer.from(stored.bytes);
  stored.bytes[100] ^= 1;
  const response = await server.raw("GET", "/1/pdf");
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "QUOTE_PDF_INTEGRITY_ERROR");
  assert.equal((await server.send("POST", "/1/pdf/retry?version=1")).status, 503);
  assert.equal(server.storage.calls.put, 1);
  assert.equal(server.storage.objects.size, 1);
});

test("PDF: un bucket público impide leer y subir e informa el fallo explícitamente", async (context) => {
  const server = await startServer(context);
  server.database.pdf.setPrivate(false);
  const created = await createQuote(server);
  assert.equal(created.status, 201);
  assert.equal(created.body.quote.pdf.errorCode, "QUOTE_PDF_STORAGE_PRIVATE_REQUIRED");
  assert.equal(server.storage.calls.put, 0);
  server.database.pdf.setPrivate(true);
  assert.equal((await server.send("POST", "/1/pdf/retry")).status, 200);
  server.database.pdf.setPrivate(false);
  assert.equal((await server.raw("GET", "/1/pdf")).status, 503);
  assert.equal(server.storage.calls.get, 0);
});

test("PDF: fallo de generación es recuperable sin nueva versión comercial", async (context) => {
  const server = await startServer(context);
  server.storage.setFailPut(true);
  await createQuote(server);
  server.storage.setFailPut(false);
  const row = server.database.pdf.rows.get(1);
  const model = row.document_model;
  row.document_model = { ...model, items: null };
  assert.equal((await server.send("POST", "/1/pdf/retry")).status, 503);
  assert.equal(row.status, "error");
  assert.equal(server.storage.objects.size, 0);
  row.document_model = model;
  assert.equal((await server.send("POST", "/1/pdf/retry")).status, 200);
  assert.equal(server.database.state.versions.length, 1);
});
