import assert from "node:assert/strict";
import test from "node:test";

import {
  createUserSideNavigationItems,
  getDashboardPath,
  mergeRecentProjectNavigationItems,
} from "../src/utils/sideNavigationItems.js";
import {
  getRecentProjectsScope,
  toRecentProjectCacheEntries,
} from "../src/utils/recentProjects.js";

test("client navigation keeps requests in every environment", () => {
  const items = createUserSideNavigationItems([], "client");
  const ids = items.map(({ id }) => id);
  assert.deepEqual(ids, ["dashboard", "requests", "more-projects", "settings"]);
  assert.equal(items[0].label, "Dashboard");
});

test("architect navigation only exposes authorized shared destinations", () => {
  const items = createUserSideNavigationItems([], "architect");
  const ids = items.map(({ id }) => id);
  assert.deepEqual(ids, ["dashboard", "more-projects", "settings"]);
  assert.equal(items[0].label, "Dashboard");
});

test("admin navigation follows the dedicated management design", () => {
  const items = createUserSideNavigationItems(
    [{ id: 10, name: "Proyecto reciente" }],
    "admin",
  );

  assert.deepEqual(
    items.map(({ id }) => id),
    ["dashboard", "users", "projects", "files", "history", "services-quotes", "settings"],
  );
  assert.deepEqual(
    items.map(({ label }) => label),
    ["Dashboard", "Usuarios", "Proyectos", "Archivos", "Historial", "Servicios y cotizaciones", "Configuraciones"],
  );
  assert.equal(items.some(({ id }) => id.startsWith("project-")), false);
});

test("admin navigation does not receive recent project shortcuts", () => {
  const items = mergeRecentProjectNavigationItems(
    createUserSideNavigationItems([], "admin"),
    [{ id: 10, name: "Proyecto reciente" }],
    { includeProjectShortcuts: false },
  );

  assert.deepEqual(
    items.map(({ id }) => id),
    ["dashboard", "users", "projects", "files", "history", "services-quotes", "settings"],
  );
});

test("project shortcuts preserve the shared navigation actions", () => {
  const items = createUserSideNavigationItems(
    [{ id: 10, name: "Proyecto Norte", isPublic: true }],
    "client",
  );
  assert.equal(items[1].id, "project-10");
  assert.equal(items[1].trailingIcon, "window");
  assert.equal(items.at(-1).id, "settings");
});

test("navigation keeps exactly the three most recently updated projects", () => {
  const items = createUserSideNavigationItems(
    [
      { id: 1, name: "Uno", updatedAt: "2026-08-01T00:00:00.000Z" },
      { id: 2, name: "Dos", updatedAt: "2026-08-04T00:00:00.000Z" },
      { id: 3, name: "Tres", updatedAt: "2026-08-03T00:00:00.000Z" },
      { id: 4, name: "Cuatro", updatedAt: "2026-08-02T00:00:00.000Z" },
    ],
    "client",
  );
  const projectIds = items
    .filter(({ id }) => id.startsWith("project-"))
    .map(({ id }) => id);

  assert.deepEqual(projectIds, ["project-2", "project-3", "project-4"]);
});

test("shared recent projects replace a page-specific partial project list", () => {
  const pageItems = createUserSideNavigationItems(
    [{ id: 1, name: "Proyecto abierto" }],
    "client",
  );
  const items = mergeRecentProjectNavigationItems(pageItems, [
    { id: 3, name: "Reciente 3", updatedAt: "2026-08-03" },
    { id: 2, name: "Reciente 2", updatedAt: "2026-08-02" },
    { id: 1, name: "Reciente 1", updatedAt: "2026-08-01" },
  ]);

  assert.deepEqual(
    items.filter(({ id }) => id.startsWith("project-")).map(({ id }) => id),
    ["project-3", "project-2", "project-1"],
  );
  assert.equal(items.filter(({ id }) => id === "requests").length, 1);
  assert.equal(items.filter(({ id }) => id === "settings").length, 1);
});

test("recent project cache excludes unrelated and sensitive project fields", () => {
  const [cachedProject] = toRecentProjectCacheEntries([
    {
      id: 7,
      name: "Proyecto seguro",
      publicSlug: "proyecto-seguro",
      isPublic: true,
      status: "active",
      updatedAt: "2026-08-05T00:00:00.000Z",
      budget: 50000,
      client: { email: "cliente@example.com" },
      description: "InformaciÃ³n interna",
    },
  ]);

  assert.deepEqual(Object.keys(cachedProject).sort(), [
    "id",
    "isPublic",
    "name",
    "publicSlug",
    "status",
    "updatedAt",
  ]);
  assert.equal(JSON.stringify(cachedProject).includes("cliente@example.com"), false);
  assert.equal(JSON.stringify(cachedProject).includes("InformaciÃ³n interna"), false);
});

test("archived projects do not occupy recent project shortcuts", () => {
  const cachedProjects = toRecentProjectCacheEntries([
    { id: 9, name: "Archivado", status: "archived", updatedAt: "2026-08-09" },
    { id: 8, name: "Activo", status: "active", updatedAt: "2026-08-08" },
  ]);

  assert.deepEqual(cachedProjects.map(({ id }) => id), [8]);
});

test("client recent projects exclude public projects owned by other users", () => {
  assert.equal(getRecentProjectsScope("client"), "owned");
  assert.equal(getRecentProjectsScope("architect"), "accessible");
  assert.equal(getRecentProjectsScope("admin"), "accessible");
});

test("dashboard destinations follow the authenticated role", () => {
  assert.equal(getDashboardPath("client"), "/dashboard-clientes");
  assert.equal(getDashboardPath("architect"), "/dashboard-arquitecto");
  assert.equal(getDashboardPath("admin"), "/dashboard-arquitecto");
});
