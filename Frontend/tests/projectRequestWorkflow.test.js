import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getProjectRequestStatus,
  isProjectRequestClosed,
  isProjectRequestEditable,
} from "../src/utils/projectRequestStatus.js";

test("request status policy distinguishes corrections from final decisions", () => {
  assert.equal(isProjectRequestEditable("changes_requested"), true);
  assert.equal(isProjectRequestEditable("pending_review"), false);
  assert.equal(isProjectRequestClosed("rejected"), true);
  assert.equal(isProjectRequestClosed("converted"), true);
  assert.equal(getProjectRequestStatus("pending_verification").label, "En verificación");
});

test("client, architect and admin surfaces consume the shared workflow", async () => {
  const [home, homeRows, dashboard, requestWorkflow, sharedWorkflow, adminDecision, modal, projectRequestsApi, adminApi] = await Promise.all([
    readFile(new URL("../src/pages/Home.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/home/components/HomeProjectRows.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/architect-dashboard/ArchitectDashboard.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/architect-dashboard/hooks/useDashboardRequestWorkflow.js", import.meta.url), "utf8"),
    readFile(new URL("../src/hooks/useProjectRequestWorkflow.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/admin-dashboard/utils/adminRequestDecision.js", import.meta.url), "utf8"),
    readFile(new URL("../src/components/project-requests/ProjectRequestWorkflowModal.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/api/projectRequestsApi.js", import.meta.url), "utf8"),
    readFile(new URL("../src/api/adminApi.js", import.meta.url), "utf8"),
  ]);

  assert.match(homeRows, /Corregir solicitud/);
  assert.match(home, /convertedProjectId/);
  assert.match(dashboard, /useProjectRequestWorkflow/);
  assert.match(requestWorkflow, /useProjectRequestWorkflow/);
  assert.match(sharedWorkflow, /listReviewQueue/);
  assert.match(adminDecision, /decideProjectRequest/);
  assert.match(modal, /Guardar revisión/);
  assert.match(projectRequestsApi, /project-requests\/review-queue/);
  assert.match(adminApi, /project-requests\/\$\{encodeURIComponent\(projectRequestId\)\}\/decision/);
});
