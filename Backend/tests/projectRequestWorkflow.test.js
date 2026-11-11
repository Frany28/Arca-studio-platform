import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  projectRequestDecisionSchema,
  projectRequestReviewSchema,
} from "../src/validation/projectRequestWorkflowSchemas.js";

test("architect reviews require a supported recommendation and meaningful note", () => {
  assert.equal(projectRequestReviewSchema.safeParse({
    body: { recommendation: "approve", note: "La propuesta es técnicamente viable." },
    params: { projectRequestId: "12" },
  }).success, true);
  assert.equal(projectRequestReviewSchema.safeParse({
    body: { recommendation: "approve", note: "Muy corta" },
    params: { projectRequestId: "12" },
  }).success, false);
  assert.equal(projectRequestReviewSchema.safeParse({
    body: { recommendation: "unknown", note: "La propuesta requiere una revisión adicional." },
    params: { projectRequestId: "12" },
  }).success, false);
});

test("administrative rejection and corrections require a public reason", () => {
  for (const action of ["reject", "request_changes"]) {
    assert.equal(projectRequestDecisionSchema.safeParse({
      body: { action, reason: "Se necesita completar la documentación legal." },
      params: { projectRequestId: 3 },
    }).success, true);
    assert.equal(projectRequestDecisionSchema.safeParse({
      body: { action, reason: "No" },
      params: { projectRequestId: 3 },
    }).success, false);
  }
  assert.equal(projectRequestDecisionSchema.safeParse({
    body: { action: "approve" },
    params: { projectRequestId: 3 },
  }).success, true);
});

test("the request workflow supports optional assignment and atomic direct conversion", async () => {
  const [assignmentSource, repositorySource, routesSource, migrationSource, fileSource, seedSource] = await Promise.all([
    readFile(new URL("../src/repositories/adminDashboardRepository.js", import.meta.url), "utf8"),
    readFile(new URL("../src/repositories/projectRequestWorkflowRepository.js", import.meta.url), "utf8"),
    readFile(new URL("../src/routes/projectRequests.js", import.meta.url), "utf8"),
    readFile(new URL("../prisma/migrations/20260828160000_project_request_review_flow/migration.sql", import.meta.url), "utf8"),
    readFile(new URL("../src/repositories/fileRepository.js", import.meta.url), "utf8"),
    readFile(new URL("../scripts/seed-project-request-workflow-example.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(assignmentSource, /status in \('pending_verification', 'pending_review'\)/);
  assert.match(assignmentSource, /role_code = 'architect'/);
  assert.match(assignmentSource, /then 'pending_review'/);
  assert.match(assignmentSource, /else 'pending_verification'/);
  assert.doesNotMatch(assignmentSource, /mutable_target\.status = 'pending_verification'\s+or/);
  assert.match(repositorySource, /for update/);
  assert.doesNotMatch(repositorySource, /review_count|review_required/);
  assert.match(repositorySource, /\["pending_verification", "pending_review"\]\.includes\(request\.status\)/);
  assert.match(repositorySource, /insert into public\.projects/);
  assert.match(repositorySource, /status = \$2::public\.project_request_status/);
  assert.match(repositorySource, /insert into public\.notifications/);
  assert.match(routesSource, /requireRoles\("admin", "architect"\)/);
  assert.match(migrationSource, /changes_requested/);
  assert.match(migrationSource, /project_request_reviews/);
  assert.match(fileSource, /findProjectRequestFileForDownload/);
  assert.match(fileSource, /project_request_assignees/);
  assert.match(seedSource, /Café Mirador Solicitud Demo/);
  assert.match(seedSource, /pending_verification/);
  assert.match(seedSource, /DEMO_SUBMISSION_ID/);
});
