import assert from "node:assert/strict";
import test from "node:test";

import {
  PROJECT_STATUS_GROUPS,
  groupProjectsByStatus,
} from "../src/utils/projectStatusGroups.js";

test("project status configuration exposes the four dashboard groups", () => {
  assert.deepEqual(
    PROJECT_STATUS_GROUPS.map((group) => group.id),
    ["in_process", "in_review", "pending_approval", "finished"],
  );
});

test("projects are grouped by status and unknown statuses use Otros", () => {
  const groups = groupProjectsByStatus([
    { id: 1, status: "in_process" },
    { id: 2, status: "finished" },
    { id: 3, status: "legacy_status" },
    { id: 4, status: "completed" },
  ]);

  assert.deepEqual(
    groups.map((group) => ({
      id: group.id,
      projectIds: group.projects.map((project) => project.id),
      status: group.status,
    })),
    [
      { id: "in_process", projectIds: [1], status: "En Progreso" },
      { id: "finished", projectIds: [2, 4], status: "Finalizados" },
      { id: "other", projectIds: [3], status: "Otros" },
    ],
  );
});
