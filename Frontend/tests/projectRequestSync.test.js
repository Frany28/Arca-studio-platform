import assert from "node:assert/strict";
import test from "node:test";

import { api } from "../src/api/http.js";
import {
  invalidateAdminDashboardOverview,
  loadAdminDashboardOverview,
} from "../src/api/adminDashboardOverview.js";
import { shouldRevalidateOnResume } from "../src/hooks/useResumeRevalidation.js";
import { removeDecidedOverviewRequest } from "../src/pages/admin-dashboard/utils/adminRequestSync.js";
import {
  getExternalProjectRequestUpdateFeedback,
  getProjectRequestDecisionFeedback,
  getProjectRequestReviewFeedback,
  hasProjectRequestChanged,
  isStaleProjectRequestError,
} from "../src/utils/projectRequestSync.js";

const REQUEST = {
  assignees: [{ id: 9 }, { id: 3 }],
  compatibility: { level: "high", score: 81 },
  convertedProject: null,
  id: 7,
  projectName: "Casa Norte",
  reviewedAt: null,
  reviews: [{ reviewer: { id: 9 }, updatedAt: "2026-11-01T10:00:00.000Z" }],
  status: "pending_review",
  updatedAt: "2026-11-01T10:00:00.000Z",
};

test("solo los conflictos de estado obsoleto exigen releer la solicitud", () => {
  for (const code of ["PROJECT_REQUEST_CLOSED", "PROJECT_REQUEST_INVALID_STATE", "PROJECT_REQUEST_NOT_FOUND"]) {
    assert.equal(isStaleProjectRequestError({ code }), true, code);
  }
  for (const error of [{ code: "PROJECT_NAME_ALREADY_EXISTS" }, { code: "PROJECT_REQUEST_REVIEW_REQUIRED" }, { code: "NETWORK_ERROR" }, null, undefined]) {
    assert.equal(isStaleProjectRequestError(error), false, JSON.stringify(error));
  }
});

test("la huella detecta cambios de estado, responsables, revisiones y conversión, no de orden", () => {
  assert.equal(hasProjectRequestChanged(REQUEST, { ...REQUEST, files: [{ id: 1 }] }), false);
  assert.equal(hasProjectRequestChanged(REQUEST, { ...REQUEST, assignees: [{ id: 3 }, { id: 9 }] }), false);
  assert.equal(hasProjectRequestChanged(REQUEST, { ...REQUEST, status: "converted" }), true);
  assert.equal(hasProjectRequestChanged(REQUEST, { ...REQUEST, assignees: [{ id: 9 }] }), true);
  assert.equal(hasProjectRequestChanged(REQUEST, { ...REQUEST, reviews: [{ reviewer: { id: 9 }, updatedAt: "2026-11-02T10:00:00.000Z" }] }), true);
  assert.equal(hasProjectRequestChanged(REQUEST, { ...REQUEST, convertedProject: { id: 40 } }), true);
  assert.equal(hasProjectRequestChanged(REQUEST, { ...REQUEST, updatedAt: "2026-11-03T10:00:00.000Z" }), true);
  assert.equal(hasProjectRequestChanged(null, null), false);
});

test("los cambios de otras personas usan un aviso Info, distinto del éxito propio", () => {
  const statusChange = getExternalProjectRequestUpdateFeedback(REQUEST, { ...REQUEST, status: "converted" });
  assert.equal(statusChange.theme, "Info");
  assert.equal(statusChange.title, "Solicitud actualizada");
  assert.equal(statusChange.content, "Casa Norte");
  assert.match(statusChange.description, /«Proyecto creado»/);
  const teamChange = getExternalProjectRequestUpdateFeedback(REQUEST, { ...REQUEST, assignees: [] });
  assert.match(teamChange.description, /responsables o revisiones/);
});

test("avisos de éxito de decisiones y revisión con los datos confirmados", () => {
  const approved = getProjectRequestDecisionFeedback(REQUEST, "approve", { project: { id: 40, name: "Casa Norte (proyecto)" } });
  assert.deepEqual(approved, { content: "Casa Norte (proyecto)", description: "Proyecto creado correctamente.", theme: "Success", title: "Solicitud aprobada" });
  assert.equal(getProjectRequestDecisionFeedback(REQUEST, "approve", {}).content, "Casa Norte");
  assert.equal(getProjectRequestDecisionFeedback(REQUEST, "reject").title, "Solicitud rechazada");
  assert.equal(getProjectRequestDecisionFeedback(REQUEST, "changes_requested").title, "Correcciones solicitadas");
  assert.deepEqual(getProjectRequestReviewFeedback(REQUEST), {
    content: "Casa Norte",
    description: "La administración ya puede consultar tu recomendación.",
    theme: "Success",
    title: "Revisión guardada",
  });
});

test("el overview retira la solicitud decidida y conserva el resto", () => {
  const overview = { newRequests: [{ id: 7, status: "pending_review" }, { id: 8, status: "pending_verification" }], recentActivity: [1] };
  for (const status of ["converted", "rejected", "changes_requested"]) {
    assert.deepEqual(removeDecidedOverviewRequest(overview, { id: "7", status }), { ...overview, newRequests: [{ id: 8, status: "pending_verification" }] });
  }
  assert.deepEqual(removeDecidedOverviewRequest(overview, { id: 8, status: "pending_review" }).newRequests[1], { id: 8, status: "pending_review" });
  assert.equal(removeDecidedOverviewRequest(overview, { id: 99, status: "rejected" }), overview);
  assert.equal(removeDecidedOverviewRequest(overview, undefined), overview);
  assert.equal(removeDecidedOverviewRequest(null, { id: 7, status: "rejected" }), null);
});

test("la reanudación respeta el intervalo mínimo salvo al recuperar la conexión", () => {
  assert.equal(shouldRevalidateOnResume({ lastRevalidatedAt: 0, minIntervalMs: 30000, now: 29999, reason: "visible" }), false);
  assert.equal(shouldRevalidateOnResume({ lastRevalidatedAt: 0, minIntervalMs: 30000, now: 30000, reason: "visible" }), true);
  assert.equal(shouldRevalidateOnResume({ lastRevalidatedAt: 0, minIntervalMs: 30000, now: 1, reason: "online" }), true);
});

test("invalidar el overview evita la caché y que una lectura anterior la repueble", async (context) => {
  const original = api.admin.getDashboardOverview;
  context.after(() => {
    api.admin.getDashboardOverview = original;
    invalidateAdminDashboardOverview();
  });
  const pending = [];
  api.admin.getDashboardOverview = () => new Promise((resolve) => pending.push(resolve));
  invalidateAdminDashboardOverview();

  // Lectura iniciada antes de la mutación: la invalidación deja de deduplicarla.
  const stale = loadAdminDashboardOverview({ scopeKey: 1 });
  invalidateAdminDashboardOverview();
  const fresh = loadAdminDashboardOverview({ scopeKey: 1 });
  assert.equal(pending.length, 2);
  pending[1]({ overview: { label: "vigente" } });
  pending[0]({ overview: { label: "anterior" } });
  assert.deepEqual(await fresh, { label: "vigente" });
  assert.deepEqual(await stale, { label: "anterior" });
  // La caché conserva la lectura vigente: la anterior no la sobrescribió.
  assert.deepEqual(await loadAdminDashboardOverview({ scopeKey: 1 }), { label: "vigente" });
  assert.equal(pending.length, 2);

  // Tras invalidar, la siguiente lectura ya no usa la caché, y los ámbitos se aíslan por usuario.
  invalidateAdminDashboardOverview();
  const reread = loadAdminDashboardOverview({ scopeKey: 1 });
  const otherUser = loadAdminDashboardOverview({ scopeKey: 2 });
  assert.equal(pending.length, 4);
  pending[2]({ overview: { label: "relectura" } });
  pending[3]({ overview: { label: "otro usuario" } });
  assert.deepEqual(await reread, { label: "relectura" });
  assert.deepEqual(await otherUser, { label: "otro usuario" });
});
