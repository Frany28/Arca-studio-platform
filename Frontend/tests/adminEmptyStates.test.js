import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("admin empty-state routes reuse the production pages without API data", async () => {
  const mainSource = await readFile(new URL("../src/main.jsx", import.meta.url), "utf8");
  const dashboardSource = await readFile(
    new URL("../src/pages/architect-dashboard/ArchitectDashboard.jsx", import.meta.url),
    "utf8",
  );
  const adminDashboardDataSource = await readFile(
    new URL("../src/pages/admin-dashboard/hooks/useAdminDashboardData.js", import.meta.url),
    "utf8",
  );
  const usersSource = await readFile(
    new URL("../src/pages/admin-users/AdminUsersPage.jsx", import.meta.url),
    "utf8",
  );

  const usersDataSource = await readFile(
    new URL("../src/pages/admin-users/hooks/useAdminUsersData.js", import.meta.url),
    "utf8",
  );

  assert.match(mainSource, /path="\/dashboard-admin-vacio"[\s\S]*<ArchitectDashboard empty/);
  assert.match(mainSource, /path="\/usuarios-vacio"[\s\S]*<AdminUsersPage empty/);
  assert.match(dashboardSource, /events=\{empty \? \[\] : undefined\}/);
  assert.match(adminDashboardDataSource, /roleCode !== "admin" \|\| empty/);
  assert.match(usersSource, /function AdminUsersPage\(\{ empty = false \}\)/);
  assert.match(usersDataSource, /if \(empty\) return undefined/);
  assert.match(usersSource, /title="No hay usuarios registrados"[\s\S]*size="M"/);
});

test("admin dashboard exposes every collection empty state", async () => {
  const operationsSource = await readFile(
    new URL("../src/pages/admin-dashboard/components/AdminDashboardOperations.jsx", import.meta.url),
    "utf8",
  );
  const overviewSource = await readFile(
    new URL("../src/pages/admin-dashboard/components/AdminDashboardOverview.jsx", import.meta.url),
    "utf8",
  );
  const projectsSource = await readFile(
    new URL("../src/pages/admin-dashboard/components/admin-active-projects/AdminActiveProjects.jsx", import.meta.url),
    "utf8",
  );

  for (const label of [
    "No hay eventos críticos",
    "No hay entregas próximas",
  ]) assert.match(operationsSource, new RegExp(label));
  for (const label of [
    "No hay actividad reciente",
    "No hay solicitudes nuevas",
  ]) assert.match(overviewSource, new RegExp(label));
  for (const label of [
    "No hay eventos críticos",
    "No hay entregas próximas",
  ]) assert.match(operationsSource, new RegExp(`${label}[\\s\\S]*?showFeaturedIcon`));
  for (const label of [
    "No hay actividad reciente",
    "No hay solicitudes nuevas",
  ]) assert.match(overviewSource, new RegExp(`${label}[\\s\\S]*?showFeaturedIcon`));
  assert.match(
    projectsSource,
    /title="No hay coincidencias"[\s\S]*showFeaturedIcon=\{false\}[\s\S]*showActions=\{false\}/,
  );
  assert.match(
    projectsSource,
    /title="No hay proyectos"[\s\S]*showFeaturedIcon[\s\S]*showActions=\{false\}/,
  );
});
