import assert from "node:assert/strict";
import test from "node:test";

import { api } from "../src/api/http.js";
import { loadAdminProjectRequest } from "../src/api/adminProjectRequestDetail.js";
import { draftFromProject, PROJECT_KIND } from "../src/pages/admin-services-quotes/quote-editor/utils/quoteDraft.js";
import {
  getQuoteCreatePathForProject,
  parseQuoteProjectParam,
} from "../src/pages/admin-services-quotes/utils/servicesQuotesTabs.js";
import {
  ADMIN_REQUEST_DECISION_ACTIONS,
  applyAdminDecisionResult,
  getAdminProjectRequestActions,
} from "../src/utils/projectRequestAdminActions.js";

const PROJECT = Object.freeze({ id: 40, name: "Casa Norte", publicSlug: "solicitud-7", status: "pending" });

test("las decisiones siguen el orden de Figma con la acción principal al final", () => {
  assert.deepEqual(ADMIN_REQUEST_DECISION_ACTIONS.map((action) => action.id), ["reject", "changes_requested", "approve"]);
  assert.deepEqual(ADMIN_REQUEST_DECISION_ACTIONS.map((action) => `${action.theme} ${action.type}`), ["Danger Outline", "Info Outline", "Primary Solid"]);
});

test("cada estado ofrece solo las acciones que el backend acepta", () => {
  const cases = [
    ["pending_review", { disabled: false, notice: "" }, false],
    ["pending_verification", { disabled: false, notice: "" }, false],
    ["changes_requested", null, false],
    ["rejected", null, false],
    ["draft", null, false],
    [undefined, null, false],
  ];
  for (const [status, decisions, canCreateQuote] of cases) {
    const actions = getAdminProjectRequestActions({ status, convertedProject: PROJECT });
    assert.deepEqual(actions.decisions, decisions, String(status));
    assert.equal(actions.canCreateQuote, canCreateQuote, String(status));
    assert.equal(actions.convertedProject, null, String(status));
  }
  assert.deepEqual(getAdminProjectRequestActions({ convertedProject: PROJECT, status: "converted" }), { canCreateQuote: true, convertedProject: PROJECT, decisions: null });
  // Sin proyecto vigente no hay destino ni cotización.
  assert.deepEqual(getAdminProjectRequestActions({ convertedProject: null, status: "converted" }), { canCreateQuote: false, convertedProject: null, decisions: null });
  assert.deepEqual(getAdminProjectRequestActions(null), { canCreateQuote: false, convertedProject: null, decisions: null });
});

test("la respuesta confirmada actualiza estado y motivos sin inventar el proyecto", () => {
  const shown = { convertedProject: null, id: 7, projectName: "Casa Norte", reviews: [{ note: "Viable." }], reviewedAt: null, status: "pending_review" };
  const rejected = applyAdminDecisionResult(shown, { project: null, projectRequest: { id: 7, rejectionReason: "Fuera de alcance.", reviewedAt: "2026-11-05T10:00:00.000Z", status: "rejected" } });
  assert.deepEqual(rejected, { ...shown, correctionReason: null, rejectionReason: "Fuera de alcance.", reviewedAt: "2026-11-05T10:00:00.000Z", status: "rejected" });
  // Al aprobar, el proyecto (con su slug real) llega con la relectura; el historial se conserva.
  const approved = applyAdminDecisionResult(shown, { project: { id: 40, name: "Casa Norte", status: "pending" }, projectRequest: { id: "7", status: "converted" } });
  assert.equal(approved.status, "converted");
  assert.equal(approved.convertedProject, null);
  assert.deepEqual(approved.reviews, shown.reviews);
  // Otra solicitud o una respuesta incompleta no cambian lo mostrado.
  assert.equal(applyAdminDecisionResult(shown, { projectRequest: { id: 8, status: "rejected" } }), shown);
  assert.equal(applyAdminDecisionResult(shown, {}), shown);
  assert.equal(applyAdminDecisionResult(shown, undefined), shown);
});

test("«Crear cotización» transporta solo el proyecto y el editor valida el parámetro", () => {
  assert.equal(getQuoteCreatePathForProject(40), "/servicios-cotizaciones/cotizaciones/nueva?proyecto=40");
  assert.equal(parseQuoteProjectParam(new URLSearchParams("proyecto=40")), "40");
  for (const value of ["", "0", "-1", "4.5", "abc", "40abc", "1".repeat(17)]) {
    assert.equal(parseQuoteProjectParam(new URLSearchParams({ proyecto: value })), null, value);
  }
  assert.equal(parseQuoteProjectParam(new URLSearchParams()), null);
});

test("el borrador precargado usa el cliente y el proyecto leídos del backend", () => {
  assert.deepEqual(draftFromProject({ ...PROJECT, client: { id: 3, name: "Cliente Comercial" } }), {
    client: { id: 3, name: "Cliente Comercial", profilePhotoUrl: "" },
    lines: [],
    notes: "",
    project: { id: 40, kind: PROJECT_KIND.EXISTING, name: "Casa Norte" },
  });
  assert.equal(draftFromProject({ ...PROJECT, client: null }), null);
  assert.equal(draftFromProject(null), null);
});

test("una lectura fresh del detalle no reutiliza la petición en curso iniciada antes de la decisión", async (context) => {
  const original = api.admin.getProjectRequest;
  context.after(() => { api.admin.getProjectRequest = original; });
  const pending = [];
  api.admin.getProjectRequest = () => new Promise((resolve) => pending.push(resolve));

  const stale = loadAdminProjectRequest(7, { scopeKey: 1 });
  const deduped = loadAdminProjectRequest(7, { scopeKey: 1 });
  assert.equal(pending.length, 1);
  const fresh = loadAdminProjectRequest(7, { fresh: true, scopeKey: 1 });
  assert.equal(pending.length, 2);
  // Una lectura normal posterior comparte la fresca, no la anterior.
  const afterFresh = loadAdminProjectRequest(7, { scopeKey: 1 });
  assert.equal(pending.length, 2);

  pending[0]({ projectRequest: { status: "pending_review" } });
  pending[1]({ projectRequest: { status: "rejected" } });
  assert.equal((await stale).projectRequest.status, "pending_review");
  assert.equal((await deduped).projectRequest.status, "pending_review");
  assert.equal((await fresh).projectRequest.status, "rejected");
  assert.equal((await afterFresh).projectRequest.status, "rejected");
  // Terminada la anterior, su limpieza no retira la entrada vigente; al terminar todas, se lee de nuevo.
  loadAdminProjectRequest(7, { scopeKey: 1 });
  assert.equal(pending.length, 3);
});
