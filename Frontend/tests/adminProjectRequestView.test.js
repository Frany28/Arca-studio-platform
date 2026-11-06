import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_REQUEST_RETURN_TARGET,
  buildAdminProjectRequestHeader,
  buildAdminProjectRequestMetrics,
  buildAdminRequestTeam,
  buildProjectRequestStages,
  getAdminProjectRequestFailure,
  getRequestReturnTarget,
} from "../src/pages/admin-project-request/utils/adminProjectRequestView.js";
import {
  ADMIN_PROJECT_REQUEST_ROUTE,
  getAdminProjectRequestPath,
  parseProjectRequestId,
} from "../src/utils/projectRequestRoutes.js";

// Detalle ficticio con la forma de GET /admin/project-requests/:id.
const REQUEST = Object.freeze({
  assignees: [{ hasProfilePhoto: true, id: 5, name: "Ana Pérez", profilePhotoUrl: "/api/admin/assignees/5/profile-photo", roleCode: "architect" }],
  compatibility: { level: "medium", score: 61.6 },
  completeness: { answered: 11, applicable: 13, missingFields: ["quality", "experience"], score: 84.6 },
  financialViability: { findings: [], score: null, status: "NO_OBVIOUS_CONFLICT" },
  id: 9,
  projectName: "Casa Prueba",
  projectType: "residential",
  reviews: [
    { note: "Primera revisión", recommendation: "changes_requested", reviewer: { id: 5, name: "Ana Pérez" }, updatedAt: "2026-10-01T10:00:00Z" },
    { note: " Viable. ", recommendation: "approve", reviewer: { id: 6, name: "Luis Gómez" }, updatedAt: "2026-10-02T10:00:00Z" },
  ],
  status: "pending_review",
});

test("las etapas reflejan el estado real y nunca completan etapas posteriores a la decisión", () => {
  const tones = (status) => buildProjectRequestStages(status).map((stage) => stage.tone);

  assert.deepEqual(buildProjectRequestStages("pending_review").map((stage) => stage.title), [
    "Solicitud enviada", "Evaluación preliminar", "Revisión", "Primer contacto", "Propuesta inicial",
  ]);
  assert.deepEqual(tones("pending_verification"), ["completed", "current", "upcoming", "upcoming", "upcoming"]);
  assert.deepEqual(tones("pending_review"), ["completed", "completed", "current", "upcoming", "upcoming"]);
  assert.deepEqual(tones("changes_requested"), ["completed", "completed", "current", "upcoming", "upcoming"]);
  assert.equal(buildProjectRequestStages("changes_requested")[2].status, "Correcciones solicitadas");
  assert.deepEqual(tones("converted"), ["completed", "completed", "completed", "upcoming", "upcoming"]);
  assert.equal(buildProjectRequestStages("converted")[2].status, "Aprobada");
  assert.equal(buildProjectRequestStages("rejected")[2].status, "Rechazada");
  assert.equal(buildProjectRequestStages("rejected")[3].status, "No aplica");
  assert.deepEqual(tones("estado_futuro"), ["completed", "upcoming", "upcoming", "upcoming", "upcoming"]);
});

test("la cabecera usa nombre, tipo y compatibilidad entera de la API, sin valores del prototipo", () => {
  const header = buildAdminProjectRequestHeader(REQUEST);

  assert.equal(header.project.title, "Casa Prueba");
  assert.equal(header.project.category, "Proyecto Residencial");
  assert.equal(header.project.stages.length, 5);
  assert.equal(header.indicator.value, 62);
  assert.equal(header.indicator.theme, "Warning");
  assert.match(header.indicator.ariaLabel, /^Compatibilidad: 62 de 100/);
});

test("sin compatibilidad ni tipo la cabecera no inventa un 0 % ni un tipo", () => {
  const header = buildAdminProjectRequestHeader({ id: 3, projectName: "", status: "pending_verification" });

  assert.equal(header.indicator, null);
  assert.equal(header.project.title, "Solicitud de proyecto");
  assert.equal(header.project.category, "Tipo de proyecto no registrado");
});

test("información completada es entera y la coherencia financiera es cualitativa", () => {
  const metrics = buildAdminProjectRequestMetrics(REQUEST);

  assert.equal(metrics.completeness.score, 85);
  assert.equal(metrics.completeness.answered, 11);
  assert.equal(metrics.financialViability.score, null);
  assert.equal(metrics.financialViability.text, "Sin incoherencias financieras detectadas");
  assert.equal(metrics.financialViability.hint, "No equivale a una aprobación financiera.");

  const missing = buildAdminProjectRequestMetrics({});
  assert.equal(missing.completeness, null);
  assert.equal(missing.financialViability, null);
});

test("gestión: estado vigente, responsables con rol y revisiones de la más reciente a la más antigua", () => {
  const team = buildAdminRequestTeam(REQUEST);

  // El estado sale de la tarjeta del diseño y se presenta en la sección de gestión.
  assert.deepEqual(team.status, { badgeTheme: "Brand 2", label: "En revisión" });

  assert.deepEqual(team.assignees, [
    { id: 5, name: "Ana Pérez", profilePhotoUrl: "/api/admin/assignees/5/profile-photo", roleLabel: "Arquitecto" },
  ]);
  assert.deepEqual(team.reviews.map((review) => review.reviewerName), ["Luis Gómez", "Ana Pérez"]);
  assert.equal(team.reviews[0].recommendationLabel, "Recomienda aprobar");
  assert.equal(team.reviews[0].note, "Viable.");
  assert.deepEqual(buildAdminRequestTeam({}), { assignees: [], reviews: [], status: null });
});

test("los fallos de lectura distinguen inexistencia, permisos, conexión y error recuperable", () => {
  assert.equal(getAdminProjectRequestFailure({ errorStatus: 404 }).kind, "not_found");
  assert.equal(getAdminProjectRequestFailure({ errorStatus: 400 }).canRetry, false);
  assert.equal(getAdminProjectRequestFailure({ errorStatus: 403 }).kind, "forbidden");
  assert.equal(getAdminProjectRequestFailure({ errorStatus: 403 }).canRetry, false);
  const connection = getAdminProjectRequestFailure({ error: "Failed to fetch", errorStatus: null });
  assert.equal(connection.kind, "connection");
  assert.equal(connection.canRetry, true);
  const server = getAdminProjectRequestFailure({ error: "Servicio no disponible.", errorStatus: 503 });
  assert.equal(server.kind, "error");
  assert.equal(server.description, "Servicio no disponible.");
});

test("el regreso solo acepta rutas internas del estado de navegación", () => {
  assert.deepEqual(getRequestReturnTarget({ from: { label: "Dashboard", to: "/dashboard-arquitecto?tab=1" } }), {
    label: "Dashboard",
    to: "/dashboard-arquitecto?tab=1",
  });
  assert.equal(getRequestReturnTarget(null), DEFAULT_REQUEST_RETURN_TARGET);
  assert.equal(getRequestReturnTarget({ from: { label: "Externo", to: "https://example.com" } }), DEFAULT_REQUEST_RETURN_TARGET);
  assert.equal(getRequestReturnTarget({ from: { label: "Externo", to: "//example.com" } }), DEFAULT_REQUEST_RETURN_TARGET);
  assert.equal(getRequestReturnTarget({ from: { to: "/usuarios" } }).label, "Dashboard");
});

test("los enlaces directos usan IDs enteros positivos", () => {
  assert.equal(ADMIN_PROJECT_REQUEST_ROUTE, "/solicitudes-proyecto/:projectRequestId");
  assert.equal(getAdminProjectRequestPath(9), "/solicitudes-proyecto/9");
  assert.equal(parseProjectRequestId("9"), 9);
  for (const invalid of ["0", "-1", "1.5", "abc", "", undefined, "09", "99999999999999999999"]) {
    assert.equal(parseProjectRequestId(invalid), null, String(invalid));
  }
});
