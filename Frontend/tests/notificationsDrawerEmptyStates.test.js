import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("comment and event drawers use the centered Figma CTA empty-state variant", async () => {
  const drawerSource = await readFile(
    new URL("../src/components/ui/NotificationsDrawer.jsx", import.meta.url),
    "utf8",
  );
  const emptyStateSource = await readFile(
    new URL("../src/components/ui/EmptyState/EmptyState.jsx", import.meta.url),
    "utf8",
  );

  assert.match(emptyStateSource, /ctas: "2061:24366"/);
  assert.match(
    drawerSource,
    /title="No hay comentarios"[\s\S]*size="S"[\s\S]*showFeaturedIcon=\{false\}[\s\S]*showActions[\s\S]*secondaryActionLabel="Añadir"[\s\S]*primaryActionLabel="Actualizar"/,
  );
  assert.match(
    drawerSource,
    /title="No hay eventos recientes"[\s\S]*size="S"[\s\S]*showFeaturedIcon=\{false\}[\s\S]*showActions[\s\S]*secondaryActionLabel="Cerrar"[\s\S]*primaryActionLabel="Actualizar"/,
  );
  assert.match(
    drawerSource,
    /activityOnly\s*&&\s*"flex min-h-0 flex-1 items-center justify-center"/,
  );
  assert.doesNotMatch(drawerSource, /min-h-\[320px\] flex-1/);
  assert.match(drawerSource, /document\.getElementById\(generalCommentInputId\)\?\.focus\(\)/);
});

test("drawer empty-state actions are connected to real refresh handlers", async () => {
  const environmentSource = await readFile(
    new URL("../src/components/EnvironmentNotificationsDrawer.jsx", import.meta.url),
    "utf8",
  );
  const dashboardSource = await readFile(
    new URL("../src/pages/architect-dashboard/ArchitectDashboard.jsx", import.meta.url),
    "utf8",
  );
  const adminActivityHookSource = await readFile(
    new URL("../src/hooks/useAdminRecentActivity.js", import.meta.url),
    "utf8",
  );

  assert.match(environmentSource, /refresh: refreshEnvironmentComments/);
  assert.match(
    environmentSource,
    /onRefreshComments=\{[\s\S]*policy\.observationsAllowed[\s\S]*refreshEnvironmentComments\(\)/,
  );
  assert.match(environmentSource, /isAdmin \? adminActivity\.refresh : onRefreshActivity/);
  assert.match(adminActivityHookSource, /loadAdminDashboardOverview\(\{ force, scopeKey \}\)/);
  assert.doesNotMatch(dashboardSource, /adminDrawerActivity/);
});

test("the shared environment drawer enforces the admin observation policy", async () => {
  const environmentSource = await readFile(
    new URL("../src/components/EnvironmentNotificationsDrawer.jsx", import.meta.url),
    "utf8",
  );
  const hookSource = await readFile(
    new URL("../src/hooks/useProjectComments.js", import.meta.url),
    "utf8",
  );
  const settingsSource = await readFile(
    new URL("../src/pages/settings/SettingsPage.jsx", import.meta.url),
    "utf8",
  );

  assert.match(environmentSource, /getEnvironmentNotificationsPolicy\(user, \{ activityOnly \}\)/);
  assert.match(environmentSource, /enabled: open && policy\.observationsAllowed/);
  assert.match(environmentSource, /activityOnly=\{policy\.activityOnly\}/);
  assert.match(environmentSource, /recentActivity=\{isAdmin \? adminActivity\.activity : recentActivity\}/);
  assert.match(environmentSource, /policy\.observationsAllowed[\s\S]*: \[\]/);
  assert.match(hookSource, /observationsAllowed = enabled && canAccessObservations\(user\)/);
  assert.match(settingsSource, /showObservationNotifications=\{canAccessObservations\(user\)\}/);
});
