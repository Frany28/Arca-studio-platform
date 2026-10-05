import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BADGE_THEME_STYLES,
} from "../src/components/ui/Badge/badgeConfig.js";
import {
  badgeMatrixThemes,
  badgeStatusItems,
} from "../src/components/ui/Badge/badgeShowcaseData.js";

test("archived badges use their registered warning palette theme", async () => {
  assert.deepEqual(BADGE_THEME_STYLES.Archived, {
    container:
      "border-[var(--color-warning-10)] bg-[var(--color-warning-10)] text-[var(--color-warning-200)]",
    content: "text-[var(--color-warning-200)]",
    dot: "bg-[var(--color-warning-200)]",
  });
  assert.ok(badgeMatrixThemes.includes("Archived"));
  assert.ok(
    badgeStatusItems.some(
      ({ label, props }) => label === "archived" && props.theme === "Archived",
    ),
  );

  const adminProjectsSource = await readFile(
    new URL(
      "../src/pages/admin-dashboard/components/admin-active-projects/utils/adminProjectPresentation.js",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    adminProjectsSource,
    /archived: \{ label: "Archivado", theme: "Archived" \}/,
  );
});
