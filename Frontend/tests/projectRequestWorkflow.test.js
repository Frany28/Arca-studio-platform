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
  const [home, dashboard, requestWorkflow, modal, api] = await Promise.all([
    readFile(new URL("../src/pages/Home.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/architect-dashboard/ArchitectDashboard.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/architect-dashboard/hooks/useDashboardRequestWorkflow.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/architect-dashboard/components/ProjectRequestWorkflowModal.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/api/http.js", import.meta.url), "utf8"),
  ]);

  assert.match(home, /Corregir solicitud/);
  assert.match(home, /convertedProjectId/);
  assert.match(dashboard, /useDashboardRequestWorkflow/);
  assert.match(requestWorkflow, /listReviewQueue/);
  assert.match(requestWorkflow, /decideProjectRequest/);
  assert.match(modal, /Guardar revisión/);
  assert.match(api, /project-requests\/review-queue/);
  assert.match(api, /project-requests\/\$\{encodeURIComponent\(projectRequestId\)\}\/decision/);
});
