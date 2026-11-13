import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildAdminRequestDetails } from "../src/pages/admin-dashboard/utils/adminRequestDetails.js";
import { buildAdminRequestTeam } from "../src/pages/admin-project-request/utils/adminProjectRequestView.js";
import {
  countOutdatedReviews,
  describeOutdatedReviews,
  hasOutdatedReviews,
  withOutdatedReviewsDetected,
} from "../src/utils/projectRequestOutdatedReviews.js";
import { isStaleProjectRequestError } from "../src/utils/projectRequestSync.js";

const review = (outdated, updatedAt) => ({ note: "Viable.", outdated, recommendation: "approve", reviewer: { id: updatedAt.length, name: "Ana" }, updatedAt });

test("la marca de revisiones desactualizadas procede del backend, nunca de updatedAt", () => {
  const current = { hasOutdatedReviews: false, reviews: [review(false, "2026-10-02T12:00:00.000Z")], updatedAt: "2026-12-01T00:00:00.000Z" };
  assert.equal(hasOutdatedReviews(current), false, "una solicitud modificada después (responsables) no avisa");
  const outdated = { hasOutdatedReviews: true, reviews: [review(true, "2026-10-02T12:00:00.000Z"), review(false, "2026-10-05T12:00:00.000Z")] };
  assert.equal(hasOutdatedReviews(outdated), true);
  assert.equal(countOutdatedReviews(outdated), 1);
  assert.equal(describeOutdatedReviews(outdated), "1 revisión técnica es anterior a los últimos cambios de la solicitud.");
  assert.equal(describeOutdatedReviews({ reviews: [review(true, "a"), review(true, "bb")] }), "2 revisiones técnicas son anteriores a los últimos cambios de la solicitud.");
  assert.equal(hasOutdatedReviews(withOutdatedReviewsDetected({ id: 9, reviews: [] })), true, "un 409 de la aprobación marca la copia local");
  assert.equal(isStaleProjectRequestError({ code: "PROJECT_REQUEST_REVIEWS_OUTDATED" }), true, "y relee la solicitud");
});

test("la consulta y el resumen avisan y etiquetan solo las revisiones desactualizadas", () => {
  const request = { hasOutdatedReviews: true, id: 9, reviews: [review(true, "2026-10-02T12:00:00.000Z"), review(false, "2026-10-05T12:00:00.000Z")], status: "pending_review" };
  const team = buildAdminRequestTeam(request);
  assert.match(team.outdatedNotice, /1 revisión técnica/);
  assert.deepEqual(team.reviews.map((item) => item.outdated), [false, true], "ordenadas de la más reciente a la más antigua");
  assert.equal(buildAdminRequestTeam({ ...request, hasOutdatedReviews: false, reviews: [review(false, "x")] }).outdatedNotice, null);
  assert.match(buildAdminRequestDetails({ queueRequest: request, summary: request }).outdatedReviewsNotice, /anterior a los últimos cambios/);
  assert.equal(buildAdminRequestDetails({ queueRequest: null, summary: { id: 9 } }).outdatedReviewsNotice, null);
});

test("aprobar con revisiones desactualizadas exige confirmación y justificación antes de llamar a la API", async () => {
  const [modal, content, decision, team, drawer] = await Promise.all([
    "components/project-requests/ProjectRequestWorkflowModal.jsx",
    "components/project-requests/ProjectRequestOutdatedApprovalContent.jsx",
    "pages/admin-dashboard/utils/adminRequestDecision.js",
    "pages/admin-project-request/components/AdminProjectRequestTeam.jsx",
    "pages/admin-dashboard/components/admin-request-details/AdminRequestDetailsContent.jsx",
  ].map((path) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8")));
  assert.match(modal, /action === "approve" && hasOutdatedReviews\(projectRequest\) \?/);
  assert.match(modal, /acknowledgeOutdatedReviews: true,\s+action: "approve"/);
  assert.match(content, /disabled=\{submitting \|\| !confirmed\}/, "sin confirmación no se puede aprobar");
  assert.match(content, /OUTDATED_JUSTIFICATION_MIN_LENGTH/);
  assert.match(decision, /acknowledgeOutdatedReviews: approving && acknowledgeOutdatedReviews === true \? true : undefined/);
  assert.match(team, /theme="Warning"/);
  assert.match(drawer, /details\.outdatedReviewsNotice/);
});
