import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIENT_KIND,
  NO_ACKNOWLEDGED_MATCHES,
  PROJECT_KIND,
  acknowledgeClientMatches,
  isNewClient,
  isQuoteDraftDirty,
  pendingClientMatches,
  toQuotePayload,
  validateQuoteDraft,
} from "../src/pages/admin-services-quotes/quote-editor/utils/quoteDraft.js";

const LINE = { key: "service-1", quantity: "1", serviceId: 1, unitRate: "14" };
const NO_PREVIEW = { lines: [{ errors: {} }] };

/**
 * Borrador de alta con un cliente nuevo escrito y un proyecto nuevo.
 *
 * @param {Object} [client] - Ajustes del cliente nuevo.
 * @returns {Object} Borrador.
 */
function newClientDraft(client = {}) {
  return {
    client: { acknowledged: NO_ACKNOWLEDGED_MATCHES, kind: CLIENT_KIND.NEW, name: "  Constructora   Los Andes ", ...client },
    lines: [LINE],
    notes: "",
    project: { kind: PROJECT_KIND.NEW, name: "Torre Norte" },
  };
}

test("cliente nuevo: el cuerpo envía newClient normalizado con sus confirmaciones y nunca clientId", () => {
  const draft = newClientDraft({ acknowledged: { clientIds: [3], userIds: [8] } });
  assert.equal(isNewClient(draft.client), true);
  assert.deepEqual(toQuotePayload(draft), {
    items: [{ quantity: "1", serviceId: 1, unitRate: "14" }],
    newClient: { acknowledgedClientIds: [3], acknowledgedUserIds: [8], name: "Constructora Los Andes" },
    newProjectName: "Torre Norte",
    notes: null,
  });
  // Un cliente existente conserva el cuerpo anterior.
  const existing = { ...draft, client: { id: 3, name: "Leonel Pérez", profilePhotoUrl: "" }, project: { id: 9, kind: PROJECT_KIND.EXISTING, name: "Apto. 910" } };
  assert.equal(isNewClient(existing.client), false);
  assert.deepEqual(Object.keys(toQuotePayload(existing)).sort(), ["clientId", "items", "notes", "projectId"]);
});

test("cliente nuevo: se valida el nombre (persona o empresa, también de una palabra) sin pedir selección", () => {
  assert.deepEqual(validateQuoteDraft(newClientDraft(), NO_PREVIEW), {});
  assert.deepEqual(validateQuoteDraft(newClientDraft({ name: "Pepsi" }), NO_PREVIEW), {});
  assert.match(validateQuoteDraft(newClientDraft({ name: " a " }), NO_PREVIEW)["newClient.name"], /al menos 2/);
  assert.equal(validateQuoteDraft({ ...newClientDraft(), client: null }, NO_PREVIEW).clientId, "Selecciona el cliente de la cotización.");
});

test("coincidencias: solo las no confirmadas piden decisión y confirmar todas las separa por tipo", () => {
  const matches = [
    { exact: true, id: 3, kind: "client", name: "Leonel Pérez" },
    { exact: false, id: 8, kind: "user", name: "Leonel Pérez Ruiz" },
  ];
  assert.deepEqual(pendingClientMatches(matches), matches);
  const acknowledged = acknowledgeClientMatches(matches);
  assert.deepEqual(acknowledged, { clientIds: [3], userIds: [8] });
  assert.deepEqual(pendingClientMatches(matches, acknowledged), []);
  // Un id de cliente confirmado no confirma a un usuario con el mismo id.
  assert.deepEqual(pendingClientMatches([{ id: 3, kind: "user" }], { clientIds: [3], userIds: [] }), [{ id: 3, kind: "user" }]);
});

test("cambios sin guardar: escribir un cliente nuevo marca el borrador como modificado", () => {
  const initial = { client: null, lines: [], notes: "", project: null };
  assert.equal(isQuoteDraftDirty(initial, { ...initial, client: { acknowledged: NO_ACKNOWLEDGED_MATCHES, kind: CLIENT_KIND.NEW, name: "Ana" } }), true);
});
