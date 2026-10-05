import assert from "node:assert/strict";
import test from "node:test";
import { getAvatarPresentation } from "../src/utils/avatarPresentation.js";
import { getAssignees, getClient, getStatus, getStatusFilterId, STATUS_FILTER_ITEMS } from
  "../src/pages/admin-dashboard/components/admin-active-projects/utils/adminProjectPresentation.js";

test("presentación de estados conserva aliases, temas y fallback", () => {
  const expected = {
    completed: ["Finalizado", "Success"], finished: ["Finalizado", "Success"],
    archived: ["Archivado", "Archived"], in_process: ["En progreso", "Info"],
    in_review: ["En revisión", "Brand 2"], pending_approval: ["Solicitud", "Neutral"],
    request: ["Solicitud", "Neutral"], unknown: ["Solicitud", "Neutral"],
  };
  for (const [status, [label, theme]] of Object.entries(expected)) {
    assert.deepEqual(getStatus({ status }), { label, theme });
  }
  assert.deepEqual(getStatus({}), { label: "Solicitud", theme: "Neutral" });
});

test("catálogo de filtros conserva orden, IDs y aliases sin normalizar valores desconocidos", () => {
  assert.deepEqual(STATUS_FILTER_ITEMS, [
    { id: "in_process", label: "En progreso", type: "Checkbox" },
    { id: "in_review", label: "En revisión", type: "Checkbox" },
    { id: "pending_approval", label: "Solicitud", type: "Checkbox" },
    { id: "completed", label: "Finalizado", type: "Checkbox" },
    { id: "archived", label: "Archivado", type: "Checkbox" },
  ]);
  assert.equal(getStatusFilterId("finished"), "completed");
  assert.equal(getStatusFilterId("request"), "pending_approval");
  for (const value of ["completed", "archived", "other", "FINISHED", undefined, null]) {
    assert.equal(getStatusFilterId(value), value);
  }
});

test("cliente conserva prioridad de nombre, foto e identidad para el avatar compartido", () => {
  const client = { id: 5, name: "Ana", profilePhotoUrl: "foto.webp", avatarUrl: "otra.webp" };
  assert.deepEqual(getClient({ client, clientId: 6, clientName: "Luis" }), {
    name: "Ana", avatar: getAvatarPresentation({ identity: 5, name: "Ana", roleCode: "client", src: "foto.webp" }),
  });
  assert.deepEqual(getClient({ client: { name: "", avatarUrl: "otra.webp" }, clientId: 6, clientName: "Luis" }), {
    name: "Luis", avatar: getAvatarPresentation({ identity: 6, name: "Luis", roleCode: "client", src: "otra.webp" }),
  });
});

test("cliente ausente utiliza Sin cliente y avatar determinista", () => {
  const expected = { name: "Sin cliente", avatar: getAvatarPresentation({ identity: "Sin cliente", name: "Sin cliente", roleCode: "client", src: "" }) };
  assert.deepEqual(getClient({}), expected);
  assert.deepEqual(getClient({ client: null }), expected);
  assert.deepEqual(getClient({ client: {}, clientName: "" }), expected);
});

test("responsables conserva prioridad e identidad de listas y objetos históricos", () => {
  const current = [{ id: 1 }];
  const legacy = [{ id: 2 }];
  const person = { id: 3 };
  assert.equal(getAssignees({ assignees: current, assignedArchitects: legacy, assignedArchitect: person }), current);
  assert.equal(getAssignees({ assignees: [], assignedArchitects: legacy, assignedArchitect: person }), legacy);
  assert.equal(getAssignees({ assignees: null, assignedArchitects: legacy }), legacy);
  assert.equal(getAssignees({ assignedArchitect: person })[0], person);
  assert.deepEqual(getAssignees({ assignees: [], assignedArchitects: [] }), []);
  assert.deepEqual(getAssignees({}), []);
});
