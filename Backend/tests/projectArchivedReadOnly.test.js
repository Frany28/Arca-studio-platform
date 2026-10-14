import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertMutableProjectState,
  assertOperationallyMutableProjectState,
} from "../src/services/projectMutationPolicy.js";

test("archived projects are rejected by the shared mutation policy", async () => {
  await assert.rejects(
    Promise.resolve().then(() =>
      assertMutableProjectState({ id: 17, status: "archived" }),
    ),
    (error) => error.code === "PROJECT_ARCHIVED" && error.status === 409,
  );
});

test("active projects pass the shared mutation policy", async () => {
  const project = assertMutableProjectState({ id: 17, status: "in_progress" });

  assert.equal(project.id, 17);
});

test("finalized projects reject operational changes but still allow publication", async () => {
  const finalizedProject = { id: 18, status: "finished" };

  assert.equal(assertMutableProjectState(finalizedProject), finalizedProject);
  assert.throws(
    () => assertOperationallyMutableProjectState(finalizedProject),
    (error) => error.code === "PROJECT_FINALIZED" && error.status === 409,
  );
});

test("missing projects remain indistinguishable from deleted projects", async () => {
  await assert.rejects(
    Promise.resolve().then(() => assertMutableProjectState(null)),
    (error) => error.code === "PROJECT_NOT_FOUND" && error.status === 404,
  );
});

test("every operational mutation path enforces closed project states in depth", async () => {
  const [
    assignmentService,
    assignmentRepository,
    commentController,
    commentRepository,
    fileController,
    fileRepository,
    projectController,
    projectRepository,
    seedSource,
  ] = await Promise.all([
    readFile(new URL("../src/services/adminDashboardService.js", import.meta.url), "utf8"),
    readFile(new URL("../src/repositories/adminDashboardRepository.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/projectCommentController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/repositories/projectCommentRepository.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/fileController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/repositories/fileRepository.js", import.meta.url), "utf8"),
    readFile(new URL("../src/controllers/projectController.js", import.meta.url), "utf8"),
    readFile(new URL("../src/repositories/projectRepository.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/seed-project-visibility-examples.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(assignmentService, /assignEmployeesToProject[\s\S]*assertProjectOperationallyMutable\(projectId\)/);
  assert.match(assignmentRepository, /replaceProjectAssignees[\s\S]*status not in[\s\S]*PROJECT_STATUS\.FINISHED/);
  assert.match(commentController, /createProjectComment[\s\S]*assertProjectOperationallyMutable\(projectId\)/);
  assert.equal((commentRepository.match(/status not in/g) || []).length >= 2, true);
  assert.equal((fileController.match(/assertProjectOperationallyMutable\(projectId\)/g) || []).length >= 2, true);
  assert.match(fileRepository, /PROJECT_FINALIZED/);
  assert.match(projectController, /changeProjectPublication/);
  assert.match(projectRepository, /updateProjectVisibility[\s\S]*status = '\$\{PROJECT_STATUS\.FINISHED\}'/);
  assert.match(seedSource, /name: "Residencia Horizonte Finalizada"[\s\S]*status: PROJECT_STATUS\.FINISHED/);
});
