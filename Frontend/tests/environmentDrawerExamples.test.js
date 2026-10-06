import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ENVIRONMENT_DRAWER_RECENT_ACTIVITY } from "../src/data/environmentDrawerExamples.js";
import { CLIENT_DRAWER_RECENT_ACTIVITY } from "../src/data/clientDrawerData.js";

test("los ejemplos de actividad cubren eventos y archivos variados", () => {
  const eventTypes = new Set(
    ENVIRONMENT_DRAWER_RECENT_ACTIVITY.map(({ type }) => type),
  );
  const files = ENVIRONMENT_DRAWER_RECENT_ACTIVITY.filter(
    ({ type }) => type === "file",
  );

  assert.equal(ENVIRONMENT_DRAWER_RECENT_ACTIVITY.length, 8);
  assert.deepEqual(
    [...eventTypes].sort(),
    ["file", "registration", "request", "session", "status", "system"],
  );
  assert.deepEqual(
    files.map(({ fileType }) => fileType).sort(),
    ["DWG", "PDF", "XLSX"],
  );

  for (const file of files) {
    assert.ok(file.fileName);
    assert.ok(file.fileSize);
    assert.ok(file.projectName);
  }
});

test("cliente y arquitecto reutilizan los mismos ejemplos del drawer", async () => {
  assert.equal(
    CLIENT_DRAWER_RECENT_ACTIVITY,
    ENVIRONMENT_DRAWER_RECENT_ACTIVITY,
  );

  const architectDataSource = await readFile(
    new URL(
      "../src/pages/architect-dashboard/architectDashboardData.js",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    architectDataSource,
    /ARCHITECT_DRAWER_RECENT_ACTIVITY\s*=\s*\n?\s*ENVIRONMENT_DRAWER_RECENT_ACTIVITY/,
  );
});
