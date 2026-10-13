import assert from "node:assert/strict";
import test from "node:test";

import {
  getPendingProjectSettingIds,
  getProjectSettings,
  getProjectSettingsAvailability,
  getProjectSettingsOperation,
  PENDING_PROJECT_SETTINGS,
  updateProjectSettingsDraft,
} from "../src/pages/admin-projects/utils/projectSettings.js";
import {
  getProjectActionFeedback,
  getProjectRowActions,
} from "../src/pages/admin-projects/utils/projectRowActions.js";

const completedPublic = Object.freeze({ id: 1, name: "Casa Norte", status: "completed", isPublic: true });
const inProcess = Object.freeze({ id: 2, name: "Torre Sur", status: "in_process", isPublic: false });
const archived = Object.freeze({ id: 3, name: "Galpón", status: "archived", isPublic: false });

test("Configuración: inicializa con los valores reales confirmados por el servidor", () => {
  assert.deepEqual(getProjectSettings(completedPublic), { portfolio: true, archived: false });
  assert.deepEqual(getProjectSettings(archived), { portfolio: false, archived: true });
  assert.deepEqual(getProjectSettings({ id: 4, status: "pending" }), { portfolio: false, archived: false });
});

test("Configuración: sin cambios no hay operación ni pendientes", () => {
  const draft = getProjectSettings(completedPublic);
  assert.equal(getProjectSettingsOperation(completedPublic, draft), null);
  assert.equal(getPendingProjectSettingIds(completedPublic, draft).size, 0);
});

test("Configuración: portafolio usa change_visibility con isPublic explícito", () => {
  const draft = updateProjectSettingsDraft(completedPublic, getProjectSettings(completedPublic), "portfolio", false);
  assert.deepEqual(getProjectSettingsOperation(completedPublic, draft), { action: "change_visibility", isPublic: false });
  assert.deepEqual([...getPendingProjectSettingIds(completedPublic, draft)], ["portfolio"]);
});

test("Configuración: archivar apaga el portafolio y revertir restaura el original", () => {
  const original = getProjectSettings(completedPublic);
  const archivedDraft = updateProjectSettingsDraft(completedPublic, original, "archived", true);
  assert.deepEqual(archivedDraft, { archived: true, portfolio: false });
  assert.deepEqual(getProjectSettingsOperation(completedPublic, archivedDraft), { action: "archive" });
  assert.equal(getProjectSettingsAvailability(completedPublic, archivedDraft).portfolio.disabled, true);
  assert.deepEqual(updateProjectSettingsDraft(completedPublic, archivedDraft, "archived", false), original);
  assert.deepEqual(original, { portfolio: true, archived: false }, "el borrador no muta el original");
});

test("Configuración: reglas existentes del backend bloquean visibilidad no permitida", () => {
  const inProcessRules = getProjectSettingsAvailability(inProcess, getProjectSettings(inProcess));
  assert.equal(inProcessRules.portfolio.disabled, true);
  assert.match(inProcessRules.portfolio.reason, /finalizados/);
  assert.equal(inProcessRules.archived.disabled, false);

  const archivedRules = getProjectSettingsAvailability(archived, getProjectSettings(archived));
  assert.equal(archivedRules.portfolio.disabled, true);
  assert.match(archivedRules.portfolio.reason, /Desarchiva/);
  const unarchiveDraft = updateProjectSettingsDraft(archived, getProjectSettings(archived), "archived", false);
  assert.deepEqual(getProjectSettingsOperation(archived, unarchiveDraft), { action: "unarchive" });

  assert.equal(getProjectSettingsAvailability(completedPublic, getProjectSettings(completedPublic)).portfolio.disabled, false);
});

test("Configuración: opciones sin contrato quedan identificadas como pendientes y no generan operación", () => {
  assert.deepEqual(Object.keys(PENDING_PROJECT_SETTINGS).sort(), ["clientAccess", "featured"]);
  const draft = updateProjectSettingsDraft(completedPublic, getProjectSettings(completedPublic), "featured", true);
  assert.equal(getProjectSettingsOperation(completedPublic, draft), null);
});

test("Menú de fila: Cambiar visibilidad y Archivar; archivados ofrecen Desarchivar", () => {
  assert.deepEqual(getProjectRowActions(inProcess).map(({ id, label }) => [id, label]), [["settings", "Cambiar visibilidad"], ["archive", "Archivar"]]);
  assert.deepEqual(getProjectRowActions(archived).map(({ id, label }) => [id, label]), [["settings", "Cambiar visibilidad"], ["unarchive", "Desarchivar"]]);
  assert.ok(getProjectRowActions(inProcess).every((item) => typeof item.icon === "function" || typeof item.icon === "object"));
});

test("Feedback: éxito solo describe el resultado y el error conserva el mensaje del servidor", () => {
  assert.equal(getProjectActionFeedback({ action: "archive" }, inProcess).theme, "Success");
  assert.match(getProjectActionFeedback({ action: "change_visibility", isPublic: true }, completedPublic).description, /ahora se muestra/);
  const failure = getProjectActionFeedback({ action: "archive" }, inProcess, new Error("Proyecto no encontrado."));
  assert.deepEqual(failure, { theme: "Danger", title: "No se pudo archivar el proyecto", description: "Proyecto no encontrado." });
});
