import assert from "node:assert/strict";
import test from "node:test";

import { startAdminRouterServer } from "./helpers/adminRouterServer.js";

// El transporte simulado nunca consulta la base configurada ni requiere dotenv.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.ROUTE_AUTH_DISABLED_FOR_TESTS = "false";
const { pool } = await import("../src/config/db.js");
const { default: adminRouter } = await import("../src/routes/admin.js");

const ADMIN = { id: 2, role: { code: "admin" } };
const PATH = "/api/admin/project-requests";

// Fila ficticia de una solicitud convertida: respuestas, relaciones y proyecto creado.
const REQUEST_ROW = Object.freeze({
  assignees: [{ hasProfilePhoto: false, id: 5, name: "Ana Pérez", roleCode: "architect" }],
  capital_availability: "available_now",
  client_id: "3",
  compatibility_level: "excellent",
  compatibility_score: "92",
  converted_project_id: "40",
  converted_project_name: "Casa Prueba",
  converted_project_public_slug: "solicitud-9",
  converted_project_status: "pending",
  created_at: "2026-10-01T12:00:00Z",
  decision_maker: "self",
  description: "Remodelación integral.",
  development_mode: "full",
  expected_start_time: "immediate",
  files: [{ fileType: "image/png", id: 31, name: "plano.png" }],
  formatted_address: "Maracaibo, Zulia, Venezuela",
  has_multiple_owners: false,
  has_plans: true,
  id: "9",
  investment_range: "10k_50k",
  land_status: "available",
  legal_document_types: ["property_deed"],
  legal_documentation_status: "available",
  location: "Maracaibo, Zulia",
  prior_design_experience: "positive",
  project_name: "Casa Prueba",
  project_size: "medium_80_200",
  project_type: "residential",
  quality_expectation: "standard",
  reference_link: "https://example.com/referencia",
  requested_by: "11",
  reviewed_at: "2026-10-03T12:00:00Z",
  reviews: [{
    meetingRecommendation: "SCHEDULE_MEETING",
    note: "Viable.",
    recommendation: "approve",
    reviewer: { hasProfilePhoto: false, id: 5, name: "Ana Pérez", roleCode: "architect" },
    updatedAt: "2026-10-02T12:00:00Z",
  }],
  stand_requirements: null,
  status: "converted",
  updated_at: "2026-10-03T12:00:00Z",
});

// Solo la lectura de adjuntos con tamaño (`listProjectRequestFiles`) usa el alias `fv`.
const FILES_QUERY = /fv\.file_size/;

const FILE_ROW = Object.freeze({
  created_at: "2026-10-01T12:05:00Z",
  file_size: "2048",
  file_type: "image/png",
  id: "31",
  name: "plano.png",
});

/**
 * Levanta el router administrativo con el pool simulado.
 *
 * @param {import("node:test").TestContext} context - Contexto de la prueba.
 * @param {(sql: string, params?: Array<unknown>) => object} [respond] - Respuesta a consultas.
 * @returns {Promise<object>} Cliente HTTP y estado.
 */
function startServer(context, respond) {
  return startAdminRouterServer(context, { pool, respond, routes: [["/api/admin", adminRouter]] });
}

test("sin sesión responde 401 y sin rol administrador 403, sin consultar PostgreSQL", async (context) => {
  const server = await startServer(context);

  const anonymous = await server.send("GET", `${PATH}/9`);
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.code, "UNAUTHENTICATED");

  for (const role of ["client", "architect"]) {
    server.setUser({ clientId: 3, id: 11, role: { code: role } });
    const response = await server.send("GET", `${PATH}/9`);
    assert.equal(response.status, 403, role);
    assert.equal(response.body.code, "FORBIDDEN");
  }
  assert.deepEqual(server.queries, []);
});

test("un ID inválido responde 400 sin consultar PostgreSQL", async (context) => {
  const server = await startServer(context);
  server.setUser(ADMIN);

  const response = await server.send("GET", `${PATH}/abc`);

  assert.equal(response.status, 400);
  assert.deepEqual(server.queries, []);
});

test("una solicitud inexistente, eliminada o en borrador responde 404 sin leer adjuntos", async (context) => {
  const server = await startServer(context, () => ({ rows: [] }));
  server.setUser(ADMIN);

  const response = await server.send("GET", `${PATH}/9`);

  assert.equal(response.status, 404);
  assert.equal(response.body.code, "PROJECT_REQUEST_NOT_FOUND");
  assert.equal(server.queries.length, 1);
  assert.match(server.queries[0], /request\.status <> 'draft'/);
  assert.match(server.queries[0], /request\.deleted_at is null/);
});

test("el detalle devuelve métricas, relaciones, adjuntos y proyecto convertido sin respuestas internas", async (context) => {
  const params = [];
  const server = await startServer(context, (sql, values) => {
    params.push(values);
    return { rows: [FILES_QUERY.test(sql) ? FILE_ROW : REQUEST_ROW] };
  });
  server.setUser(ADMIN);

  const response = await server.send("GET", `${PATH}/9`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(params, [[9], [9]]);
  const { projectRequest } = response.body;
  assert.equal(projectRequest.id, 9);
  assert.equal(projectRequest.status, "converted");
  assert.equal(projectRequest.requestedBy, 11);
  assert.equal("answers" in projectRequest, false);
  assert.deepEqual(projectRequest.compatibility, { level: "excellent", score: 92 });
  assert.equal(Number.isInteger(projectRequest.completeness.score), true);
  // La coherencia financiera es cualitativa: el contrato vigente no expone puntuación.
  assert.equal(projectRequest.financialViability.score, null);
  assert.equal(typeof projectRequest.financialViability.status, "string");
  assert.ok(Array.isArray(projectRequest.reviewObservations));
  assert.deepEqual(projectRequest.convertedProject, { id: 40, name: "Casa Prueba", publicSlug: "solicitud-9", status: "pending" });
  assert.equal(projectRequest.referenceLink, "https://example.com/referencia");
  assert.equal(projectRequest.formattedAddress, "Maracaibo, Zulia, Venezuela");
  assert.equal(projectRequest.reviews[0].reviewer.name, "Ana Pérez");
  assert.equal(projectRequest.assignees[0].id, 5);
  assert.deepEqual(projectRequest.files, [
    { createdAt: "2026-10-01T12:05:00Z", fileType: "image/png", id: 31, name: "plano.png", size: 2048 },
  ]);
});

test("un proyecto convertido eliminado no se enlaza en el detalle", async (context) => {
  const server = await startServer(context, (sql) => ({
    rows: FILES_QUERY.test(sql)
      ? []
      : [{ ...REQUEST_ROW, converted_project_name: null, converted_project_status: null }],
  }));
  server.setUser(ADMIN);

  const response = await server.send("GET", `${PATH}/9`);

  assert.equal(response.status, 200);
  assert.equal(response.body.projectRequest.convertedProject, null);
  assert.deepEqual(response.body.projectRequest.files, []);
});
