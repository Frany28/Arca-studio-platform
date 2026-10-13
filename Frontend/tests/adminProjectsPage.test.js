import assert from "node:assert/strict";
import test from "node:test";
import { getAdminProjectMetrics } from "../src/pages/admin-projects/utils/adminProjectMetrics.js";
import { createUserSideNavigationItems } from "../src/utils/sideNavigationItems.js";
import { getStatus } from "../src/pages/admin-dashboard/components/admin-active-projects/utils/adminProjectPresentation.js";

test("Gestión: indicadores incluyen toda la colección y aliases históricos sin mutarla", () => {
  const projects = [{ status: "in_process" }, { status: "finished" }, { status: "completed" }, { status: "archived" }, { status: "pending" }];
  const snapshot = structuredClone(projects);
  assert.deepEqual(getAdminProjectMetrics(projects), { total: 5, inProgress: 1, completed: 2 });
  assert.deepEqual(projects, snapshot);
  assert.deepEqual(getAdminProjectMetrics([]), { total: 0, inProgress: 0, completed: 0 });
});

test("Gestión: etiquetas específicas conservan los estados y la presentación del dashboard", () => {
  for (const [status, label] of [["pending", "En espera"], ["draft", "Drafts"], ["request", "Solicitud"], ["pending_approval", "Solicitud"]]) {
    const project = Object.freeze({ status });
    assert.equal(getStatus(project, "management").label, label);
    assert.deepEqual(getStatus(project), { label: "Solicitud", theme: "Neutral" });
  }
  assert.deepEqual(getStatus({ status: "finished" }, "management"), getStatus({ status: "finished" }));
});

test("Gestión: administrador accede al módulo y otros roles conservan su galería", () => {
  assert.equal(createUserSideNavigationItems([], "admin").find(({ id }) => id === "projects").to, "/gestion-proyectos");
  for (const role of ["client", "architect"]) {
    assert.equal(createUserSideNavigationItems([], role).find(({ id }) => id === "more-projects").to, "/proyectos");
  }
});
