import assert from "node:assert/strict";
import test from "node:test";

import { buildAdminRequestDetails } from "../src/pages/admin-dashboard/utils/adminRequestDetails.js";
import {
  DEFAULT_REQUEST_ROW_MESSAGE,
  getProjectRequestRowActions,
  getProjectRequestRowDestination,
  getProjectRequestRowMessage,
} from "../src/pages/home/utils/projectRequestRowActions.js";
import {
  APPROVED_NEXT_STEP_MESSAGE,
  MISSING_CORRECTION_REASON_MESSAGE,
  MISSING_REJECTION_REASON_MESSAGE,
  getProjectRequestDecisionPresentation,
} from "../src/pages/project-request/utils/projectRequestDecision.js";
import { getClientProjectRequestFailure } from "../src/pages/project-request/utils/projectRequestFailure.js";
import { buildProjectRequestStages } from "../src/utils/projectRequestStages.js";
import { getClientProjectRequestPath, parseProjectRequestId } from "../src/utils/projectRequestRoutes.js";
import {
  getProjectRequestClientReason,
  isProjectRequestUnderEvaluation,
} from "../src/utils/projectRequestStatus.js";

const LONG_REASON = `El terreno no cuenta con la documentación requerida.\nAdemás, el presupuesto indicado ${"no cubre el alcance solicitado. ".repeat(20)}`.trim();

test("el motivo se elige por estado: un rechazo nunca muestra correcciones anteriores", () => {
  // El backend conserva correction_reason al rechazar una solicitud que antes recibió correcciones.
  const rejectedAfterCorrections = { status: "rejected", correctionReason: "Agrega fotos de la fachada.", rejectionReason: "  Fuera del alcance de ARCA.  " };
  assert.equal(getProjectRequestClientReason(rejectedAfterCorrections), "Fuera del alcance de ARCA.");
  assert.equal(getProjectRequestClientReason({ status: "changes_requested", correctionReason: "Agrega planos.", rejectionReason: "antiguo" }), "Agrega planos.");
  assert.equal(getProjectRequestClientReason({ status: "rejected", correctionReason: "Agrega planos.", rejectionReason: null }), null);
  for (const status of ["pending_verification", "pending_review", "converted", "draft"]) {
    assert.equal(getProjectRequestClientReason({ status, correctionReason: "x", rejectionReason: "y" }), null, status);
  }
  // Nunca lee notas internas aunque la respuesta las incluyera.
  assert.equal(getProjectRequestClientReason({ status: "rejected", internalReviewNotes: "nota interna" }), null);
});

test("solo pending_verification y pending_review son seguimiento («Solicitud recibida»)", () => {
  assert.equal(isProjectRequestUnderEvaluation("pending_verification"), true);
  assert.equal(isProjectRequestUnderEvaluation("pending_review"), true);
  for (const status of ["converted", "rejected", "changes_requested", "draft", undefined]) {
    assert.equal(isProjectRequestUnderEvaluation(status), false, String(status));
  }
});

test("«Estado de la solicitud»: aprobada describe el siguiente paso sin inventar comunicaciones", () => {
  const approved = getProjectRequestDecisionPresentation({ status: "converted", convertedProjectAvailable: true, convertedProjectId: 7 });
  assert.equal(approved.sectionTitle, "Primer contacto");
  assert.equal(approved.message, APPROVED_NEXT_STEP_MESSAGE);
  assert.doesNotMatch(approved.message, /hemos enviado|enviamos un correo/i);
  assert.deepEqual(approved.primaryAction, { kind: "viewProject", label: "Ver proyecto" });
  assert.equal(getProjectRequestDecisionPresentation({ status: "converted", convertedProjectId: null }).primaryAction, null);
  // Recién aprobada: el proyecto es un borrador interno y no se ofrece al cliente.
  assert.equal(getProjectRequestDecisionPresentation({ status: "converted", convertedProjectAvailable: false, convertedProjectId: 7 }).primaryAction, null);
  // Revisión aprobada; primer contacto y propuesta siguen pendientes.
  const stages = buildProjectRequestStages("converted");
  assert.equal(stages[2].status, "Aprobada");
  assert.deepEqual(stages.slice(3).map((stage) => [stage.status, stage.tone]), [["Pendiente", "upcoming"], ["Pendiente", "upcoming"]]);
});

test("«Estado de la solicitud»: rechazo con motivo completo, etapas «No aplica» y nueva solicitud", () => {
  const rejected = getProjectRequestDecisionPresentation({ status: "rejected", rejectionReason: LONG_REASON, correctionReason: "Corrección antigua." });
  assert.equal(rejected.sectionTitle, "Motivo del rechazo");
  assert.equal(rejected.message, LONG_REASON, "el motivo se conserva completo");
  assert.equal(rejected.isReasonMissing, false);
  assert.equal(rejected.primaryAction.kind, "createNew");
  const missing = getProjectRequestDecisionPresentation({ status: "rejected", rejectionReason: "  " });
  assert.equal(missing.message, MISSING_REJECTION_REASON_MESSAGE);
  assert.equal(missing.isReasonMissing, true);
  const stages = buildProjectRequestStages("rejected");
  assert.equal(stages[2].status, "Rechazada");
  assert.deepEqual(stages.slice(3).map((stage) => stage.status), ["No aplica", "No aplica"]);
});

test("«Estado de la solicitud»: correcciones muestran correctionReason y permiten corregir", () => {
  const corrections = getProjectRequestDecisionPresentation({ status: "changes_requested", correctionReason: "Adjunta el plano.", rejectionReason: null });
  assert.equal(corrections.sectionTitle, "Información solicitada");
  assert.equal(corrections.message, "Adjunta el plano.");
  assert.equal(corrections.primaryAction.kind, "correct");
  assert.equal(getProjectRequestDecisionPresentation({ status: "changes_requested" }).message, MISSING_CORRECTION_REASON_MESSAGE);
  assert.equal(buildProjectRequestStages("changes_requested")[2].status, "Correcciones solicitadas");
  assert.equal(getProjectRequestDecisionPresentation({ status: "pending_review" }), null);
});

test("«Mis proyectos»: cada estado ofrece su acción y navega por id", () => {
  const labels = (request) => getProjectRequestRowActions(request).map((action) => `${action.label}:${action.type}`);
  assert.deepEqual(labels({ status: "pending_verification" }), ["Ver solicitud:Solid"]);
  assert.deepEqual(labels({ status: "pending_review" }), ["Ver solicitud:Solid"]);
  assert.deepEqual(labels({ status: "converted", convertedProjectAvailable: true, convertedProjectId: 9 }), ["Ver resultado:Outline", "Ver proyecto:Solid"]);
  assert.deepEqual(labels({ status: "converted", convertedProjectAvailable: false, convertedProjectId: 9 }), ["Ver resultado:Solid"], "draft: sin enlace al proyecto");
  assert.deepEqual(labels({ status: "converted", convertedProjectId: null }), ["Ver resultado:Solid"]);
  assert.deepEqual(labels({ status: "rejected" }), ["Ver motivo:Solid"]);
  assert.deepEqual(labels({ status: "changes_requested" }), ["Corregir solicitud:Solid"]);

  const rejected = { id: 41, status: "rejected", rejectionReason: "Fuera de alcance." };
  // «Ver motivo» abre «Estado de la solicitud» por id, nunca el formulario.
  assert.deepEqual(getProjectRequestRowDestination(rejected, "status"), { to: "/solicitudes/41" });
  assert.deepEqual(getProjectRequestRowDestination({ id: 5, status: "converted", convertedProjectId: 9 }, "viewProject"), { to: "/proyectos/9" });
  const corrections = { id: 6, status: "changes_requested" };
  assert.deepEqual(getProjectRequestRowDestination(corrections, "correct"), { state: { initialRequest: corrections }, to: "/solicitudes/nueva" });

  assert.equal(getProjectRequestRowMessage({ status: "rejected", correctionReason: "antigua", rejectionReason: "Fuera de alcance." }), "Fuera de alcance.");
  assert.equal(getProjectRequestRowMessage({ status: "pending_review", correctionReason: "antigua" }), DEFAULT_REQUEST_ROW_MESSAGE);
});

test("ruta persistente del cliente e identificación de fallos", () => {
  assert.equal(getClientProjectRequestPath(31), "/solicitudes/31");
  assert.equal(parseProjectRequestId("nueva"), null);
  assert.equal(parseProjectRequestId("31"), 31);
  // Otro cliente recibe 404 del backend: mismo mensaje que una solicitud inexistente, sin reintento.
  assert.equal(getClientProjectRequestFailure({ errorStatus: 404 }).kind, "not_found");
  assert.equal(getClientProjectRequestFailure({ errorStatus: 404 }).canRetry, false);
  assert.equal(getClientProjectRequestFailure({ errorStatus: 403 }).kind, "forbidden");
  assert.equal(getClientProjectRequestFailure({ errorStatus: null }).canRetry, true);
  assert.equal(getClientProjectRequestFailure({ error: "Error temporal.", errorStatus: 500 }).description, "Error temporal.");
});

test("drawer admin: «Motivo del rechazo» solo en rechazadas, sin inventar revisión técnica", () => {
  const rejected = { id: 3, status: "rejected", rejectionReason: " Presupuesto insuficiente. ", correctionReason: "Corrección antigua.", reviews: [] };
  const details = buildAdminRequestDetails({ queueRequest: rejected, summary: rejected });
  assert.equal(details.rejectionReason, "Presupuesto insuficiente.");
  assert.equal(details.justification, null, "sin revisión no hay justificación del arquitecto");
  assert.equal(details.recommendation, null);
  const pending = { id: 4, status: "pending_review", rejectionReason: "residuo", reviews: [] };
  assert.equal(buildAdminRequestDetails({ queueRequest: pending, summary: pending }).rejectionReason, null);
});
