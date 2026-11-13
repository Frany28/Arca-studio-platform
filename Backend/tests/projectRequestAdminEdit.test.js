import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_EDITABLE_PROJECT_REQUEST_STATUSES,
  isProjectRequestEditableByAdmin,
  isSameProjectRequestVersion,
  listChangedProjectRequestAnswers,
  listReviewRelevantChanges,
  REVIEW_RELEVANT_ANSWER_FIELDS,
} from "../src/domain/projectRequestAdminEdit.js";
import { adminUpdateProjectRequestSchema } from "../src/validation/projectRequestSchemas.js";
import { projectRequestDecisionSchema } from "../src/validation/projectRequestWorkflowSchemas.js";

test("solo las solicitudes en evaluación admiten edición administrativa", () => {
  assert.deepEqual(ADMIN_EDITABLE_PROJECT_REQUEST_STATUSES, ["pending_verification", "pending_review"]);
  for (const status of ["pending_verification", "pending_review"]) assert.equal(isProjectRequestEditableByAdmin(status), true, status);
  for (const status of ["draft", "changes_requested", "approved", "converted", "rejected", "cancelled", null, undefined]) {
    assert.equal(isProjectRequestEditableByAdmin(status), false, String(status));
  }
});

test("los cambios distinguen false, 0, null y arreglos, y solo nombran respuestas del formulario", () => {
  const before = {
    clientId: 1,
    hasMultipleOwners: false,
    hasPlans: null,
    legalDocumentTypes: ["property_deed"],
    locationCoordinates: { latitude: 10, longitude: -71 },
    status: "pending_review",
  };
  assert.deepEqual(listChangedProjectRequestAnswers(before, { ...before }), []);
  assert.deepEqual(listChangedProjectRequestAnswers(before, { ...before, hasMultipleOwners: null }), ["hasMultipleOwners"]);
  assert.deepEqual(listChangedProjectRequestAnswers(before, { ...before, hasPlans: false }), ["hasPlans"]);
  assert.deepEqual(listChangedProjectRequestAnswers(before, { ...before, legalDocumentTypes: ["property_deed", "cadastral_record"] }), ["legalDocumentTypes"]);
  assert.deepEqual(listChangedProjectRequestAnswers(before, { ...before, locationCoordinates: null }), ["locationCoordinates"]);
  assert.deepEqual(listChangedProjectRequestAnswers(before, { ...before, clientId: 2, status: "converted" }), [], "workflow y propiedad no son respuestas");
});

test("la versión se compara por instante, con la precisión del contrato JSON", () => {
  const stored = new Date("2026-11-13T10:00:00.123Z");
  assert.equal(isSameProjectRequestVersion(stored, "2026-11-13T10:00:00.123Z"), true);
  assert.equal(isSameProjectRequestVersion(stored, "2026-11-13T06:00:00.123-04:00"), true);
  assert.equal(isSameProjectRequestVersion(stored, "2026-11-13T10:00:00.124Z"), false);
  assert.equal(isSameProjectRequestVersion(null, "2026-11-13T10:00:00.123Z"), false);
});

test("el contrato exige la versión y rechaza campos de workflow", () => {
  const parse = (body) => adminUpdateProjectRequestSchema.safeParse({ body, params: { projectRequestId: "7" } });
  const missingVersion = parse({});
  assert.equal(missingVersion.success, false);
  assert.ok(missingVersion.error.issues.some((issue) => issue.path.join(".") === "body.expectedUpdatedAt"));
  const workflow = parse({ expectedUpdatedAt: "2026-11-13T10:00:00.123Z", status: "converted", clientId: 9 });
  assert.equal(workflow.success, false);
  assert.ok(workflow.error.issues.some((issue) => issue.code === "unrecognized_keys"));
});

test("solo los cambios que sustentan la revisión técnica la desactualizan", () => {
  assert.deepEqual(listReviewRelevantChanges(["projectName", "referenceLink", "decisionMaker", "experience", "formattedAddress", "locationCoordinates", "providerPlaceId"]), []);
  assert.deepEqual(listReviewRelevantChanges(["projectName", "investmentRange", "location", "hasPlans"]), ["investmentRange", "location", "hasPlans"]);
  // Todo lo que lee la compatibilidad es relevante.
  for (const field of ["projectType", "projectSize", "developmentMode", "landStatus", "legalDocumentationStatus", "legalDocumentTypes", "investmentRange", "capitalAvailability", "startTime", "quality"]) {
    assert.ok(REVIEW_RELEVANT_ANSWER_FIELDS.includes(field), field);
  }
});

test("la excepción de aprobación solo existe en «approve» y con sus límites", () => {
  const parse = (body) => projectRequestDecisionSchema.safeParse({ body, params: { projectRequestId: "7" } });
  assert.equal(parse({ acknowledgeOutdatedReviews: true, action: "approve", outdatedReviewsJustification: "Confirmado con el cliente." }).success, true);
  assert.equal(parse({ acknowledgeOutdatedReviews: false, action: "approve" }).success, false, "solo se acepta la confirmación explícita");
  assert.equal(parse({ action: "approve", outdatedReviewsJustification: "corta" }).success, false);
  assert.equal(parse({ acknowledgeOutdatedReviews: true, action: "reject", reason: "Fuera del alcance del estudio." }).success, false);
});
