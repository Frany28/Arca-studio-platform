import assert from "node:assert/strict";
import test from "node:test";

import {
  getActionMenuPosition,
  getNextActionMenuIndex,
} from "../src/components/ui/ActionMenu/actionMenuPosition.js";
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
import {
  FINANCIAL_VIABILITY_PENDING_TEXT,
  getCompletenessPresentation,
  getFinancialViabilityPresentation,
} from "../src/utils/projectRequestMetrics.js";
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
  completeness: { answered: 13, applicable: 13, missingFields: [], score: 100 },
  financialViability: {
    findings: [{ category: "TEMPORAL", code: "CAPITAL_TIMING_MISMATCH", evidence: [{ code: "financingImmediate", explanation: "El financiamiento debe estar encaminado antes de plantear un inicio inmediato." }], explanation: "El financiamiento debe estar encaminado antes de plantear un inicio inmediato.", outcome: "REVIEW_REQUIRED", severity: "MEDIUM" }],
    score: null,
    status: "REVIEW_REQUIRED",
  },
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

test("completitud y viabilidad financiera llegan de la API, sin valores de prototipo", () => {
  const details = buildAdminRequestDetails({ queueRequest: QUEUE_REQUEST, summary: SUMMARY });

  assert.deepEqual(details.completeness, {
    answered: 13,
    applicable: 13,
    fillClassName: "bg-[var(--color-success-200)]",
    score: 100,
  });
  assert.deepEqual(details.financialViability, {
    hint: "",
    reasons: [{ code: "CAPITAL_TIMING_MISMATCH", explanation: "El financiamiento debe estar encaminado antes de plantear un inicio inmediato.", outcome: "REVIEW_REQUIRED" }],
    score: null,
    status: "REVIEW_REQUIRED",
    text: "Requiere revisión financiera",
    toneClassName: "text-[var(--color-warning-100)]",
  });
  assert.equal("prototypeIndicators" in details, false);

  // Las métricas son independientes: una compatibilidad baja no altera la completitud.
  const low = buildAdminRequestDetails({
    queueRequest: { ...QUEUE_REQUEST, compatibility: { level: "low", score: 28 } },
    summary: SUMMARY,
  });
  assert.equal(low.completeness.score, 100);
  assert.equal(low.financialViability.score, null);

  const partial = buildAdminRequestDetails({ summary: SUMMARY });
  assert.equal(partial.completeness, null);
  assert.equal(partial.financialViability, null);
});

test("la completitud solo distingue completa de incompleta y rechaza datos no numéricos", () => {
  assert.equal(getCompletenessPresentation({ answered: 12, applicable: 16, score: 75 }).fillClassName, "bg-[var(--color-warning-200)]");
  assert.equal(getCompletenessPresentation({ answered: 16, applicable: 16, score: 140 }).score, 100);
  assert.equal(getCompletenessPresentation({ score: "x", answered: 1, applicable: 2 }), null);
  assert.equal(getCompletenessPresentation(null), null);
});

test("la viabilidad financiera solo muestra porcentaje cuando la API lo calcula", () => {
  assert.equal(getFinancialViabilityPresentation({ score: null, status: "PENDING_RULES" }).text, FINANCIAL_VIABILITY_PENDING_TEXT);
  // "Sin incoherencias" no es una aprobación: tono neutral y aclaración explícita.
  const noConflict = getFinancialViabilityPresentation({ findings: [], score: null, status: "NO_OBVIOUS_CONFLICT" });
  assert.equal(noConflict.text, "Sin incoherencias financieras detectadas");
  assert.equal(noConflict.toneClassName, "");
  assert.equal(noConflict.hint, "No equivale a una aprobación financiera.");
  const highRisk = getFinancialViabilityPresentation({ score: null, status: "HIGH_RISK" });
  assert.equal(highRisk.text, "Riesgo financiero elevado");
  assert.equal(highRisk.toneClassName, "text-[var(--color-danger-100)]");
  assert.equal(highRisk.hint, "No demuestra que el proyecto sea inviable.");
  assert.equal(getFinancialViabilityPresentation({ score: null, status: "INSUFFICIENT_DATA" }).text, "Información financiera insuficiente");
  assert.equal(getFinancialViabilityPresentation({ score: null, status: "OTHER" }).text, "Evaluación no disponible");
  assert.deepEqual(getFinancialViabilityPresentation({ findings: [{ code: "X" }], score: null, status: "REVIEW_REQUIRED" }).reasons, []);
  assert.equal(getFinancialViabilityPresentation({ score: 64, status: "EVALUATED" }).score, 64);
  assert.equal(getFinancialViabilityPresentation(undefined), null);
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

test("baja compatibilidad usa Danger sin derivar de su nivel las demás métricas", () => {
  // Antes el nivel elegía valores fijos de prototipo (22/61); ahora cada métrica viene de la API.
  const details = buildAdminRequestDetails({ summary: SUMMARY, queueRequest: {
    ...QUEUE_REQUEST,
    compatibility: { level: "low", score: 28 },
    completeness: { answered: 11, applicable: 17, missingFields: [], score: 65 },
  } });
  assert.deepEqual(details.compatibility, { label: "Baja compatibilidad", score: 28, theme: "Danger" });
  assert.equal(details.completeness.score, 65);
  assert.equal(details.completeness.fillClassName, "bg-[var(--color-warning-200)]");
  assert.equal(details.financialViability.score, null);
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
