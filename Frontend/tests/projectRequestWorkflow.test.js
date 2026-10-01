import { readSources } from "./helpers/readSources.js";
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
  const [home, dashboard, modal, api] = await Promise.all([
    readSources(new URL("../src/pages/client-dashboard/ClientDashboard.jsx", import.meta.url), new URL("../src/pages/client-dashboard/components/ProjectRequestRow.jsx", import.meta.url)),
    readSources(new URL("../src/pages/architect-dashboard/ArchitectDashboard.jsx", import.meta.url), new URL("../src/pages/architect-dashboard/hooks/useProjectReviewQueue.js", import.meta.url), new URL("../src/pages/architect-dashboard/hooks/useProjectRequestWorkflow.js", import.meta.url)),
    readFile(new URL("../src/pages/architect-dashboard/components/ProjectRequestWorkflowModal.jsx", import.meta.url), "utf8"),
    readSources(new URL("../src/api/adminApi.js", import.meta.url), new URL("../src/api/projectRequestsApi.js", import.meta.url)),
  ]);

  assert.match(home, /Corregir solicitud/);
  assert.match(home, /convertedProjectId/);
  assert.match(dashboard, /listReviewQueue/);
  assert.match(dashboard, /decideProjectRequest/);
  assert.match(modal, /Guardar revisión/);
  assert.match(api, /project-requests\/review-queue/);
  assert.match(api, /project-requests\/\$\{encodeURIComponent\(projectRequestId\)\}\/decision/);
});
