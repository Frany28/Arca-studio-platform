import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const AUTHENTICATED_PAGE_FILES = [
  "src/pages/Home.jsx",
  "src/pages/ProjectRequestPage.jsx",
  "src/pages/projects/PublicProjectsGallery.jsx",
  "src/pages/examples/EmptyProjectsExample.jsx",
  "src/pages/examples/EmptyProjectRendersExample.jsx",
  "src/layouts/InternalDashboardLayout.jsx",
  "src/pages/admin-users/AdminUsersPage.jsx",
  "src/pages/architect-dashboard/NewArchitectProjectPage.jsx",
  "src/pages/projects/ProjectDetailsPage.jsx",
  "src/pages/settings/SettingsPage.jsx",
];

test("authenticated pages use the shared environment navbar without local overrides", async () => {
  for (const role of ["admin", "architect"]) {
    const source = await readFile(new URL(`../src/pages/${role}-dashboard/${role === "admin" ? "Admin" : "Architect"}Dashboard.jsx`, import.meta.url), "utf8");
    assert.match(source, /layouts\/InternalDashboardLayout\.jsx/);
    assert.match(source, /<InternalDashboardLayout/);
  }
  for (const filePath of AUTHENTICATED_PAGE_FILES) {
    const source = await readFile(new URL(`../${filePath}`, import.meta.url), "utf8");
    const navbarUsage = source.match(/<NavigationBar[\s\S]*?\/>/)?.[0] ?? "";

    assert.match(source, /components\/EnvironmentNavigationBar\.jsx/, filePath);
    assert.doesNotMatch(source, /ui\/NavigationBar\/NavigationBar\.jsx/, filePath);
    assert.ok(navbarUsage, `${filePath} debe renderizar el navbar compartido`);

    for (const forbiddenProp of [
      "variant=",
      "utilityText=",
      "showUtilityMenu=",
      "className=",
    ]) {
      assert.equal(
        navbarUsage.includes(forbiddenProp),
        false,
        `${filePath} no debe sobrescribir ${forbiddenProp}`,
      );
    }
  }
});

test("the environment navbar owns its shared visual configuration", async () => {
  const source = await readFile(
    new URL("../src/components/EnvironmentNavigationBar.jsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /variant="utility"/);
  assert.match(source, /utilityText=\{formatEnvironmentDate\(\)\}/);
  assert.match(source, /showUtilityMenu=\{Boolean\(props\.onMenuClick\)\}/);
  assert.match(source, /className=\{ENVIRONMENT_NAVBAR_CLASS_NAME\}/);
  assert.match(source, /useScrollDirectionVisibility\(navbarRef\)/);
  assert.match(source, /sticky top-0 z-30/);
  assert.match(source, /data-scroll-direction-navbar/);
});
