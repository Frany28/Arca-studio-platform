import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { startAdminRouterServer } from "./helpers/adminRouterServer.js";
import { addedColumns, readMigrationStatements } from "./helpers/migrationSchema.js";
import { createQuoteDatabaseMock } from "./helpers/quoteDatabaseMock.js";
import { mockQuotePdfStorage } from "./helpers/quotePdfMock.js";
import { collectRestoreReferenceConflicts, restoredAmountsMatch, toRestoredLines } from "../src/domain/quoteRestoration.js";
import { calculateQuoteTotals } from "../src/domain/quoteTotals.js";
import { objectStorage } from "../src/services/objectStorage.js";

// Restauración comercial de versiones de cotizaciones (POST /api/admin/quotes/:id/versions/:n/restore)
// con la base simulada. La concurrencia real y las restricciones se cubren en quotes.integration.test.js.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.ROUTE_AUTH_DISABLED_FOR_TESTS = "false";
process.env.SUPABASE_QUOTE_PDF_BUCKET = "quotes-private-test";
process.env.SUPABASE_STORAGE_BUCKET = "general-test";
const { pool } = await import("../src/config/db.js");
const { default: quoteRouter } = await import("../src/routes/quotes.js");

const ADMIN = { id: 2, role: { code: "admin" } };
const V1 = {
  clientId: 3,
  items: [
    { quantity: "200.5", serviceId: 1, unitRate: "14.33" },
    { quantity: "35", serviceId: 2, unitRate: "47" },
  ],
  notes: "Incluye dos visitas de obra.",
  projectId: 9,
};
const V2_ITEMS = [{ quantity: "10", serviceId: 2, unitRate: "50" }];
const MIGRATION_NAME = "20261124120000_quote_version_restorations";

/**
 * Levanta el router de cotizaciones con la base y el almacenamiento simulados.
 *
 * @param {import("node:test").TestContext} context - Contexto que cierra el servidor y restaura mocks.
 * @returns {Promise<object>} Cliente HTTP, base y almacenamiento simulados.
 */
async function startServer(context) {
  const storage = mockQuotePdfStorage(context, objectStorage);
  const database = createQuoteDatabaseMock();
  const server = await startAdminRouterServer(context, { pool, respond: database.respond, routes: [["/api/admin/quotes", quoteRouter]] });
  server.setUser(ADMIN);
  return { ...server, database, send: (method, path, body) => server.send(method, `/api/admin/quotes${path}`, body), storage };
}

/**
 * Crea la cotización 1 con tres versiones: V1 (dos servicios con decimales), V2 (otro contenido)
 * y V3 (otras observaciones sobre V2), que queda vigente.
 *
 * @param {object} server - Cliente de startServer.
 * @returns {Promise<void>}
 */
async function createThreeVersions(server) {
  assert.equal((await server.send("POST", "", { ...V1, submissionId: randomUUID() })).status, 201);
  assert.equal((await server.send("PATCH", "/1", { ...V1, expectedVersion: 1, items: V2_ITEMS, notes: null })).body.quote.currentVersion, 2);
  assert.equal((await server.send("PATCH", "/1", { ...V1, expectedVersion: 2, items: V2_ITEMS, notes: "Tercera" })).body.quote.currentVersion, 3);
}

/**
 * Envía una restauración con un identificador de envío nuevo salvo que se indique otro.
 *
 * @param {object} server - Cliente de startServer.
 * @param {number} versionNumber - Versión de origen.
 * @param {object} [body] - Campos del cuerpo que se sustituyen.
 * @returns {Promise<object>} Respuesta HTTP.
 */
function restore(server, versionNumber, body = {}) {
  return server.send("POST", `/1/versions/${versionNumber}/restore`, { expectedVersion: 3, reason: "Vuelve la propuesta aprobada", requestId: randomUUID(), ...body });
}

test("restaurar V1 con V3 vigente crea V4 con los conceptos, cantidades, tarifas e importes exactos de V1", async (context) => {
  const server = await startServer(context);
  await createThreeVersions(server);
  const response = await restore(server, 1, { reason: "  Vuelve la propuesta aprobada  " });

  assert.equal(response.status, 201);
  assert.equal(response.body.replayed, false);
  const { quote } = response.body;
  assert.equal(quote.currentVersion, 4);
  assert.deepEqual(quote.version.restoredFrom, { reason: "Vuelve la propuesta aprobada", versionNumber: 1 });
  assert.equal(quote.notes, V1.notes);
  assert.deepEqual(quote.items.map((item) => [item.service.id, item.service.versionId, item.unit.optionId, item.quantity, item.unitRate, item.subtotal]), [
    [1, 10, 100, "200.500", "14.33", "2873.17"],
    [2, 20, 200, "35.000", "47.00", "1645.00"],
  ]);
  assert.equal(quote.servicesTotal, "4518.17");
  assert.deepEqual([quote.referenceVat.rate, quote.referenceVat.amount], ["16.00", "722.91"]);

  // Historial íntegro: V1–V3 sin cambios, solo V4 vigente.
  const versions = server.database.state.versions.filter((version) => version.quoteId === 1);
  assert.deepEqual(versions.map((version) => [version.versionNumber, version.isCurrent]), [[1, false], [2, false], [3, false], [4, true]]);
  assert.deepEqual(versions.slice(0, 3).map((version) => version.restoredFromVersionNumber ?? null), [null, null, null]);
  const v1 = versions[0];
  assert.deepEqual([versions[3].servicesTotal, versions[3].referenceVatAmount], [v1.servicesTotal, v1.referenceVatAmount]);
  assert.equal(versions[3].createdBy, ADMIN.id);

  // Auditoría con origen, motivo y responsable.
  const audit = server.database.state.auditLogs.at(-1);
  assert.equal(audit.action, "quote.version_restore");
  assert.equal(audit.userId, ADMIN.id);
  assert.deepEqual(audit.newValues, { reason: "Vuelve la propuesta aprobada", restoredFromVersion: 1, servicesTotal: "4518.17", versionNumber: 4 });
});

test("PDF: la versión restaurada genera su propio documento sin reemplazar el de V1", async (context) => {
  const server = await startServer(context);
  await createThreeVersions(server);
  const v1Key = "quotes/1/versions/v1/COT-001-v1.pdf";
  const v1Bytes = server.storage.objects.get(v1Key).bytes;
  const response = await restore(server, 1);

  assert.equal(response.body.quote.pdf.status, "available");
  assert.equal(response.body.quote.pdf.fileName, "COT-001-v4.pdf");
  assert.equal(server.storage.calls.put, 4, "Una subida por versión; no se copia ni renombra el PDF anterior");
  assert.ok(server.storage.objects.has("quotes/1/versions/v4/COT-001-v4.pdf"));
  assert.equal(server.storage.objects.get(v1Key).bytes, v1Bytes, "El PDF de V1 se conserva intacto");
  const v4Model = [...server.database.pdf.rows.values()].find((row) => row.file_name === "COT-001-v4.pdf").document_model;
  const v1Model = [...server.database.pdf.rows.values()].find((row) => row.file_name === "COT-001-v1.pdf").document_model;
  assert.deepEqual(v4Model.items, v1Model.items, "El documento nuevo presenta los conceptos de V1");
  assert.equal(v4Model.total, v1Model.total);

  const history = await server.send("GET", "/1/pdf/versions");
  assert.deepEqual(history.body.versions.map((version) => [version.versionNumber, version.isCurrent, version.restoredFrom]), [
    [4, true, { reason: "Vuelve la propuesta aprobada", versionNumber: 1 }],
    [3, false, null],
    [2, false, null],
    [1, false, null],
  ]);
});

test("PDF: un fallo de almacenamiento conserva la restauración y el PDF queda en error recuperable", async (context) => {
  const server = await startServer(context);
  await createThreeVersions(server);
  server.storage.setFailPut(true);
  const response = await restore(server, 1);
  assert.equal(response.status, 201);
  assert.equal(response.body.quote.currentVersion, 4);
  assert.equal(response.body.quote.pdf.status, "error");
  assert.equal((await server.send("GET", "/1/pdf?version=4")).status, 409, "No se declara disponible ni se sirve");

  server.storage.setFailPut(false);
  const retried = await server.send("POST", "/1/pdf/retry?version=4");
  assert.equal(retried.status, 200);
  assert.equal(retried.body.pdf.status, "available");
  assert.equal(server.database.state.versions.length, 4, "La recuperación no crea otra versión comercial");
});

test("idempotencia: repetir el envío devuelve V4 sin crear otra versión; reutilizar el id con otro contenido responde 409", async (context) => {
  const server = await startServer(context);
  await createThreeVersions(server);
  const requestId = randomUUID();
  assert.equal((await restore(server, 1, { requestId })).status, 201);
  const puts = server.storage.calls.put;

  const replayed = await restore(server, 1, { requestId });
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.replayed, true);
  assert.equal(replayed.body.quote.currentVersion, 4);
  assert.equal(server.database.state.versions.length, 4);
  assert.equal(server.storage.calls.put, puts);

  const reused = await restore(server, 2, { expectedVersion: 4, requestId });
  assert.equal(reused.status, 409);
  assert.equal(reused.body.code, "QUOTE_RESTORE_REQUEST_REUSED");
  const otherReason = await restore(server, 1, { reason: "Otro motivo", requestId });
  assert.equal(otherReason.body.code, "QUOTE_RESTORE_REQUEST_REUSED");
  assert.equal(server.database.state.versions.length, 4);
});

test("concurrencia: una restauración con una versión vigente obsoleta responde 409 sin escribir", async (context) => {
  const server = await startServer(context);
  await createThreeVersions(server);
  const [first, second] = [await restore(server, 1), await restore(server, 2)];
  assert.equal(first.status, 201);
  assert.equal(second.status, 409);
  assert.equal(second.body.code, "QUOTE_VERSION_CONFLICT");
  assert.equal(server.database.state.versions.length, 4);
  // Restaurar V2 sobre V4 con la versión correcta crea V5 consecutiva.
  const next = await restore(server, 2, { expectedVersion: 4 });
  assert.equal(next.body.quote.currentVersion, 5);
  assert.deepEqual(next.body.quote.version.restoredFrom.versionNumber, 2);
});

test("versión de origen: vigente, inexistente o igual a la vigente no crean versión", async (context) => {
  const server = await startServer(context);
  await createThreeVersions(server);
  const current = await restore(server, 3);
  assert.equal(current.status, 409);
  assert.equal(current.body.code, "QUOTE_RESTORE_SOURCE_CURRENT");
  assert.equal((await restore(server, 9)).body.code, "QUOTE_VERSION_NOT_FOUND");
  assert.equal((await server.send("POST", "/77/versions/1/restore", { expectedVersion: 1, reason: "x", requestId: randomUUID() })).body.code, "QUOTE_NOT_FOUND");

  // V4 = V2 con las observaciones nulas: restaurar V2 sobre V4 no tiene cambios.
  await server.send("PATCH", "/1", { ...V1, expectedVersion: 3, items: V2_ITEMS, notes: null });
  const same = await restore(server, 2, { expectedVersion: 4 });
  assert.equal(same.status, 409);
  assert.equal(same.body.code, "QUOTE_RESTORE_NO_CHANGES");
  assert.equal(server.database.state.versions.length, 4);
});

test("referencias históricas no disponibles: servicio inactivo o proyecto eliminado se informan sin sustituir ni escribir", async (context) => {
  const server = await startServer(context);
  await createThreeVersions(server);
  server.database.state.services.get(1).isActive = false;
  server.database.state.projects.get(9).isAvailable = false;
  const before = server.database.state.versions.length;
  const response = await restore(server, 1);

  assert.equal(response.status, 409);
  assert.equal(response.body.code, "QUOTE_RESTORE_REFERENCE_UNAVAILABLE");
  // El proyecto 9 es también el de la versión vigente: como en la edición, se conserva.
  assert.deepEqual(response.body.details.conflicts.map((conflict) => [conflict.type, conflict.id]), [["service", 1]]);
  assert.match(response.body.message, /Anteproyecto arquitectónico.*inactivo/);
  assert.equal(server.database.state.versions.length, before);
  assert.equal(server.database.state.versions.find((version) => version.versionNumber === 3).isCurrent, true);

  // Un servicio inactivo que la versión vigente también cotiza se conserva.
  server.database.state.services.get(1).isActive = true;
  server.database.state.services.get(2).isActive = false;
  assert.equal((await restore(server, 1)).status, 201);
});

test("validación: motivo obligatorio y acotado, identificador de envío y versión válidos antes de consultar PostgreSQL", async (context) => {
  const server = await startServer(context);
  const invalid = [
    { reason: "   " },
    { reason: "x".repeat(501) },
    { reason: undefined },
    { requestId: "no-uuid" },
    { expectedVersion: 0 },
    { extra: true },
  ];
  for (const body of invalid) {
    const response = await restore(server, 1, body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal(response.body.code, "VALIDATION_ERROR");
  }
  assert.equal((await server.send("POST", "/1/versions/0/restore", { expectedVersion: 1, reason: "x", requestId: randomUUID() })).status, 400);
  assert.equal((await server.send("POST", "/1/versions/2147483648/restore", { expectedVersion: 1, reason: "x", requestId: randomUUID() })).status, 400);
  assert.deepEqual(server.database.statements.filter((sql) => !sql.includes("rate_limit")), []);
});

test("permisos: sin sesión 401; clientes y arquitectos 403 sin consultar PostgreSQL", async (context) => {
  const server = await startServer(context);
  server.setUser(null);
  const body = { expectedVersion: 1, reason: "Motivo", requestId: randomUUID() };
  assert.equal((await server.send("POST", "/1/versions/1/restore", body)).status, 401);
  for (const role of ["client", "architect"]) {
    server.setUser({ id: 7, role: { code: role } });
    const response = await server.send("POST", "/1/versions/1/restore", body);
    assert.equal(response.status, 403, role);
    assert.equal(response.body.code, "FORBIDDEN");
  }
  assert.deepEqual(server.database.statements, []);
});

test("dominio: conflictos de referencias en el orden del documento, admitiendo las que conserva la versión vigente", () => {
  const source = {
    client: { id: 3, name: "Leonel" },
    items: [{ service: { code: "SERV-001", id: 1, name: "Anteproyecto" } }, { service: { code: "SERV-009", id: 9, name: "Retirado" } }],
    project: { id: 9, name: "Apto" },
  };
  const current = { client: { id: 4, name: "Otro" }, items: [{ service: { id: 1 } }], project: { id: 10, name: "Otro" } };
  const conflicts = collectRestoreReferenceConflicts({
    clientRecord: { isAvailable: false },
    current,
    projectRecord: { clientId: 5, isAvailable: true },
    services: new Map([[1, { isActive: false }]]),
    source,
  });
  assert.deepEqual(conflicts.map((conflict) => [conflict.type, conflict.id]), [["client", 3], ["project", 9], ["service", 9]]);
  assert.match(conflicts[1].message, /ya no pertenece al cliente/);
  assert.match(conflicts[2].message, /ya no existe/);
});

test("dominio: los importes se reproducen con el motor y una diferencia de un céntimo se detecta", () => {
  const items = [{ quantity: "200.500", referenceRate: "14.00", service: { id: 1, versionId: 10 }, subtotal: "2873.17", unit: { allowsDecimals: true, optionId: 100 }, unitRate: "14.33" }];
  const lines = toRestoredLines(items);
  assert.deepEqual(lines, [{ quantity: "200.500", referenceRate: "14.00", serviceId: 1, serviceVersionId: 10, serviceVersionUnitOptionId: 100, unitAllowsDecimals: true, unitRate: "14.33" }]);
  const totals = calculateQuoteTotals({ items: lines, referenceVat: { enabled: true, rate: "16.00" } });
  const source = { items, referenceVat: { amount: "459.71" }, servicesTotal: "2873.17" };
  assert.equal(restoredAmountsMatch(source, totals), true);
  assert.equal(restoredAmountsMatch({ ...source, servicesTotal: "2873.18" }, totals), false);
  assert.equal(restoredAmountsMatch({ ...source, referenceVat: { amount: "459.70" } }, totals), false);
});

test("migración: añade solo columnas de trazabilidad con restricciones, sin modificar filas ni triggers", async () => {
  const sql = await readMigrationStatements(MIGRATION_NAME);
  assert.deepEqual(Object.fromEntries(addedColumns(sql, "quote_versions")), {
    restore_reason: "VARCHAR(500)",
    restore_request_id: "UUID",
    restored_from_version_number: "INTEGER",
  });
  const flat = sql.replace(/\s+/g, " ");
  assert.match(flat, /FOREIGN KEY \(quote_id, restored_from_version_number\) REFERENCES public\.quote_versions \(quote_id, version_number\)/);
  assert.match(flat, /restored_from_version_number < version_number/);
  assert.match(flat, /uq_quote_versions_restore_request UNIQUE \(quote_id, restore_request_id\)/);
  // El pooler de Supabase ignora `options`: los límites deben fijarse en la propia transacción.
  assert.match(flat, /BEGIN; SET LOCAL lock_timeout = '3s'; SET LOCAL statement_timeout = '60s';/);
  assert.doesNotMatch(sql, /\b(DROP\s|TRUNCATE\s|DELETE FROM|UPDATE public\.|INSERT INTO|DISABLE TRIGGER|ALTER SEQUENCE|setval)/i);
});
