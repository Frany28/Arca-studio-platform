import assert from "node:assert/strict";
import test from "node:test";

import {
  getActionMenuPosition,
  getNextActionMenuIndex,
} from "../src/components/ui/ActionMenu/actionMenuPosition.js";
import { getPrototypeRequestIndicators } from "../src/pages/admin-dashboard/data/adminRequestDetailsPrototype.js";
import {
  buildAdminRequestDetails,
  findRequestById,
  getLatestRequestReview,
} from "../src/pages/admin-dashboard/utils/adminRequestDetails.js";
import {
  getCompatibilityLevelLabel,
  getCompatibilityPresentation,
} from "../src/utils/projectRequestCompatibility.js";
import { getProjectRequestStatus } from "../src/utils/projectRequestStatus.js";
import { getMeetingRecommendationPresentation } from "../src/utils/projectRequestMeetingRecommendation.js";

const SUMMARY = {
  assignees: [],
  createdAt: "2026-03-22T12:00:00.000Z",
  id: 7,
  projectName: "Apartamento Noventa y Uno",
  projectType: "residential",
  status: "pending_review",
};

const QUEUE_REQUEST = {
  clientId: 41,
  requestedBy: 52,
  compatibility: { level: "excellent", score: 92 },
  id: 7,
  location: "Maracaibo, Zulia",
  reviews: [
    { note: "Revisión anterior", recommendation: "reject", meetingRecommendation: "DO_NOT_SCHEDULE_MEETING", reviewer: { name: "Ana" }, updatedAt: "2026-03-20T10:00:00.000Z" },
    { note: "El cliente posee terreno y presupuesto adecuado.", recommendation: "approve", meetingRecommendation: "SCHEDULE_MEETING", reviewer: { name: "Luis" }, updatedAt: "2026-03-21T10:00:00.000Z" },
  ],
  status: "pending_review",
};

test("combina overview y cola técnica con datos reales", () => {
  const details = buildAdminRequestDetails({ queueRequest: QUEUE_REQUEST, summary: SUMMARY });

  assert.equal(details.isPartial, false);
  assert.equal(details.clientId, 41);
  assert.equal(details.clientUserId, 52);
  assert.equal(details.projectName, "Apartamento Noventa y Uno");
  assert.equal(details.projectTypeLabel, "Residencial");
  assert.equal(details.location, "Maracaibo, Zulia");
  assert.deepEqual(details.status, { label: "En revisión", theme: "Brand 2" });
  assert.deepEqual(details.compatibility, { label: "Excelente compatibilidad", score: 92, theme: "Success" });
  assert.equal(details.recommendation.label, "Agendar reunión");
  assert.equal(details.justification, "El cliente posee terreno y presupuesto adecuado.");
  assert.equal(details.reviewerName, "Luis");
});

test("sin entrada en la cola no inventa compatibilidad, revisión, ubicación ni cliente", () => {
  const details = buildAdminRequestDetails({ summary: SUMMARY });

  assert.equal(details.isPartial, true);
  assert.equal(details.compatibility, null);
  assert.equal(details.recommendation, null);
  assert.equal(details.justification, null);
  assert.equal(details.location, null);
  assert.equal(details.clientId, null);
  assert.equal(details.clientUserId, null);
  assert.equal(details.projectName, SUMMARY.projectName);
});

test("los indicadores de prototipo quedan separados, marcados e inmutables", () => {
  const details = buildAdminRequestDetails({ queueRequest: QUEUE_REQUEST, summary: SUMMARY });

  assert.ok(details.prototypeIndicators.length > 0);
  assert.ok(details.prototypeIndicators.every((indicator) => indicator.isPrototype === true));
  // Los datos reales no contienen ni sobrescriben campos de prototipo.
  assert.equal("financialViability" in details, false);
  details.prototypeIndicators[0].value = 0;
  assert.notEqual(getPrototypeRequestIndicators()[0].value, 0);
});

test("la revisión más reciente no depende del orden de la API", () => {
  assert.equal(getLatestRequestReview(QUEUE_REQUEST.reviews).recommendation, "approve");
  assert.equal(getLatestRequestReview([...QUEUE_REQUEST.reviews].reverse()).recommendation, "approve");
  assert.equal(
    getLatestRequestReview([{ recommendation: "reject", updatedAt: "inválida" }, { recommendation: "approve", updatedAt: "2026-01-01" }]).recommendation,
    "approve",
  );
  assert.equal(getLatestRequestReview([]), null);
  assert.equal(getLatestRequestReview(undefined), null);
});

test("las recomendaciones de reunión tienen etiquetas propias y no se derivan del workflow", () => {
  assert.deepEqual(getMeetingRecommendationPresentation("DO_NOT_SCHEDULE_MEETING"), { label: "No agendar reunión", theme: "Danger", value: "DO_NOT_SCHEDULE_MEETING" });
  assert.deepEqual(getMeetingRecommendationPresentation("SCHEDULE_MEETING"), { label: "Agendar reunión", theme: "Info", value: "SCHEDULE_MEETING" });
  for (const value of [null, undefined, "approve", "reject", "changes_requested", "schedule_meeting", "unknown", "constructor", "__proto__", "toString"]) {
    assert.equal(getMeetingRecommendationPresentation(value), null);
  }
});

test("baja compatibilidad usa Danger y conserva indicadores de referencia identificados", () => {
  const details = buildAdminRequestDetails({ summary: SUMMARY, queueRequest: { ...QUEUE_REQUEST, compatibility: { level: "low", score: 28 } } });
  assert.deepEqual(details.compatibility, { label: "Baja compatibilidad", score: 28, theme: "Danger" });
  assert.deepEqual(details.prototypeIndicators.map(({ value, isPrototype }) => ({ value, isPrototype })), [{ value: 22, isPrototype: true }, { value: 61, isPrototype: true }]);
});

test("una revisión histórica reciente no hereda la reunión de una revisión anterior", () => {
  const details = buildAdminRequestDetails({ summary: SUMMARY, queueRequest: { ...QUEUE_REQUEST, reviews: [
    ...QUEUE_REQUEST.reviews,
    { note: "Justificación histórica, aunque mencione agendar reunión.", recommendation: "approve", updatedAt: "2026-03-24T10:00:00.000Z" },
  ] } });
  assert.equal(details.recommendation, null);
  assert.equal(details.justification, "Justificación histórica, aunque mencione agendar reunión.");
});

test("la reunión y justificación provienen de la misma revisión más reciente", () => {
  const reviews = [{ ...QUEUE_REQUEST.reviews[0], recommendation: "approve", updatedAt: "2026-03-25T10:00:00.000Z" }, QUEUE_REQUEST.reviews[1]];
  for (const orderedReviews of [reviews, [...reviews].reverse()]) {
    const details = buildAdminRequestDetails({ summary: SUMMARY, queueRequest: { ...QUEUE_REQUEST, reviews: orderedReviews } });
    assert.equal(details.recommendation.value, "DO_NOT_SCHEDULE_MEETING");
    assert.equal(details.justification, "Revisión anterior");
  }
});

test("busca solicitudes con IDs numéricos o de texto", () => {
  assert.equal(findRequestById([{ id: 7 }], "7").id, 7);
  assert.equal(findRequestById([{ id: "8" }], 8).id, "8");
  assert.equal(findRequestById([{ id: 7 }], null), null);
  assert.equal(findRequestById(undefined, 7), null);
});

test("la compatibilidad se limita a 0–100 y omite solicitudes sin evaluar", () => {
  assert.equal(getCompatibilityPresentation({ level: "excellent", score: 140 }).score, 100);
  assert.equal(getCompatibilityPresentation({ level: "low", score: -5 }).score, 0);
  assert.equal(getCompatibilityPresentation({ level: "low", score: 25 }).theme, "Danger");
  assert.equal(getCompatibilityPresentation({ level: "medium", score: 45 }).theme, "Warning");
  assert.equal(getCompatibilityPresentation({ level: "future", score: 50 }).label, "Evaluación disponible");
  assert.equal(getCompatibilityPresentation(null), null);
  assert.equal(getCompatibilityPresentation({ level: "excellent", score: null }), null);
  assert.equal(getCompatibilityLevelLabel("poorly_defined"), "Solicitud poco definida");
});

test("el estado de la solicitud expone un tema de Badge del sistema de diseño", () => {
  assert.equal(getProjectRequestStatus("pending_verification").badgeTheme, "Neutral");
  assert.equal(getProjectRequestStatus("rejected").badgeTheme, "Danger");
  assert.equal(getProjectRequestStatus("draft").badgeTheme, "Neutral");
});

test("el menú de acciones abre debajo si cabe y hacia arriba al pie del viewport", () => {
  const viewport = { height: 1000, width: 1440 };
  const menu = { height: 167, width: 230 };

  // Figma: borde derecho alineado con el botón y 12 px de separación.
  assert.deepEqual(getActionMenuPosition({ bottom: 144, right: 1424, top: 100 }, menu, viewport), { left: 1194, top: 156 });
  assert.deepEqual(getActionMenuPosition({ bottom: 974, right: 1424, top: 930 }, menu, viewport), { left: 1194, top: 751 });
  // Si no cabe ni arriba ni abajo, se fija al margen superior del viewport.
  assert.equal(getActionMenuPosition({ bottom: 150, right: 300, top: 106 }, menu, { height: 200, width: 375 }).top, 8);
  // En móvil el menú no sobresale por la izquierda.
  assert.equal(getActionMenuPosition({ bottom: 44, right: 100, top: 0 }, menu, { height: 700, width: 375 }).left, 8);
});

test("la navegación por teclado del menú es circular y admite Home/End", () => {
  assert.equal(getNextActionMenuIndex("ArrowDown", 2, 3), 0);
  assert.equal(getNextActionMenuIndex("ArrowUp", 0, 3), 2);
  assert.equal(getNextActionMenuIndex("ArrowUp", -1, 3), 2);
  assert.equal(getNextActionMenuIndex("Home", 2, 3), 0);
  assert.equal(getNextActionMenuIndex("End", 0, 3), 2);
  assert.equal(getNextActionMenuIndex("Enter", 0, 3), -1);
  assert.equal(getNextActionMenuIndex("ArrowDown", -1, 0), -1);
});
