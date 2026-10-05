import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { toAdminDrawerActivity } from "../src/utils/adminActivity.js";

test("admin activity keeps one navigable presentation across every drawer", () => {
  assert.deepEqual(
    toAdminDrawerActivity({
      createdAt: null,
      id: "file-42",
      projectId: 15,
      projectName: "Quinta Bella Vista",
      userName: "Administrador Sistema",
      userRoleCode: "admin",
    }),
    {
      action: "subió un archivo al proyecto",
      id: "file-42",
      name: "Administrador Sistema",
      projectId: 15,
      projectName: "Quinta Bella Vista",
      roleCode: "admin",
      timestamp: "Sin fecha",
      to: "/proyectos/15",
      type: "event",
    },
  );
});

test("admin drawer activity is centralized and isolated by authenticated scope", async () => {
  const environmentSource = await readFile(
    new URL(
      "../src/components/EnvironmentNotificationsDrawer.jsx",
      import.meta.url,
    ),
    "utf8",
  );
  const cacheSource = await readFile(
    new URL("../src/api/adminDashboardOverview.js", import.meta.url),
    "utf8",
  );

  assert.match(environmentSource, /useAdminRecentActivity/);
  assert.match(environmentSource, /enabled: open && isAdmin/);
  assert.match(cacheSource, /const cacheByScope = new Map\(\)/);
  assert.match(cacheSource, /String\(scopeKey \|\| "admin-session"\)/);
  assert.match(cacheSource, /if \(inFlightByScope\.has\(resolvedScopeKey\)\)/);
});

test("recent activity time matches the double-ring Figma component", async () => {
  const source = await readFile(
    new URL(
      "../src/pages/admin-dashboard/components/AdminDashboardOverview.jsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(source, /function ActivityTime\(\{ value \}\)/);
  assert.match(source, /h-\[34px\] w-\[73px\]/);
  assert.match(source, /border-\[var\(--color-text-300\)\]/);
  assert.match(
    source,
    /shadow-\[0_0_0_var\(--stroke-2\)_var\(--color-primary-10\)\]/,
  );
  assert.match(source, /replace\(\/\\s\*\(\[AP\]\)\\\.\\s\*M\\\.\$\/, " \$1M"\)/);
});
