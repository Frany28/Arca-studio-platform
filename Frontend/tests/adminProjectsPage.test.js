import assert from "node:assert/strict";
import test from "node:test";
import { getAdminProjectMetrics } from "../src/pages/admin-projects/utils/adminProjectMetrics.js";
import { createUserSideNavigationItems } from "../src/utils/sideNavigationItems.js";
import { getStatus } from "../src/pages/admin-dashboard/components/admin-active-projects/utils/adminProjectPresentation.js";

test("Gestión: indicadores incluyen toda la colección y aliases históricos sin mutarla", () => {
  const projects = [{ status: "in_process" }, { status: "finished" }, { status: "completed" }, { status: "archived" }, { status: "pending" }];
  const snapshot = structuredClone(projects);
  assert.deepEqual(getAdminProjectMetrics(projects), { total: 5, inProgress: 1, finished: 2 });
  assert.deepEqual(projects, snapshot);
  assert.deepEqual(getAdminProjectMetrics([]), { total: 0, inProgress: 0, finished: 0 });
  // Los drafts cuentan como proyectos registrados, pero no en progreso.
  assert.deepEqual(getAdminProjectMetrics([...projects, { status: "draft" }]), { total: 6, inProgress: 1, finished: 2 });
});

test("Gestión: etiquetas específicas conservan los estados y la presentación del dashboard", () => {
  for (const [status, label] of [["pending", "En espera"], ["request", "Solicitud"], ["pending_approval", "Solicitud"]]) {
    const project = Object.freeze({ status });
    assert.equal(getStatus(project, "management").label, label);
    assert.deepEqual(getStatus(project), { label: "Solicitud", theme: "Neutral" });
  }
  assert.deepEqual(getStatus({ status: "finished" }, "management"), getStatus({ status: "finished" }));
  // draft es un estado real de PostgreSQL: «Drafts» en Gestión y en el dashboard.
  for (const variant of ["management", "dashboard"]) {
    assert.deepEqual(getStatus(Object.freeze({ status: "draft" }), variant), { label: "Drafts", theme: "Brand 1" });
  }
});

test("Gestión: administrador accede al módulo y otros roles conservan su galería", () => {
  assert.equal(createUserSideNavigationItems([], "admin").find(({ id }) => id === "projects").to, "/gestion-proyectos");
  for (const role of ["client", "architect"]) {
    assert.equal(createUserSideNavigationItems([], role).find(({ id }) => id === "more-projects").to, "/proyectos");
  }
});
