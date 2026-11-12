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

  // Acciones y destinos de «Mis proyectos» salen del helper por estado (probado en
  // projectRequestClientStatus.test.js), no de condiciones locales.
  assert.match(homeRows, /getProjectRequestRowActions/);
  assert.match(home, /getProjectRequestRowDestination/);
  assert.match(dashboard, /useProjectRequestWorkflow/);
  assert.match(requestWorkflow, /useProjectRequestWorkflow/);
  assert.match(sharedWorkflow, /listReviewQueue/);
  assert.match(adminDecision, /decideProjectRequest/);
  // El arquitecto recomienda con los modales de Figma; el administrador decide con los suyos.
  assert.match(modal, /ProjectRequestRecommendationContent/);
  assert.match(modal, /ProjectRequestClientContactContent/);
  assert.match(modal, /ProjectRequestRejectionContent/);
  assert.match(projectRequestsApi, /project-requests\/review-queue/);
  assert.match(adminApi, /project-requests\/\$\{encodeURIComponent\(projectRequestId\)\}\/decision/);
});
