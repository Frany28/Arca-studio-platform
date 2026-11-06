import assert from "node:assert/strict";
import test from "node:test";

import { allowsProjectRequestTestVerification } from "../src/config/projectRequestTestVerification.js";
import {
  createProjectRequestDraftSchema,
  findIncompleteProjectRequestFields,
  isEmptyProjectRequestDraftBody,
} from "../src/validation/projectRequestSchemas.js";

test("validación temporal: activa por defecto; PROJECT_REQUEST_EMAIL_VERIFICATION=enabled exige el correo", () => {
  const user = { email: "cliente@arca.test" };
  assert.equal(allowsProjectRequestTestVerification(user, {}), true, "sin variables: cualquier código de 6 dígitos");
  assert.equal(allowsProjectRequestTestVerification(user, { PROJECT_REQUEST_EMAIL_VERIFICATION: "" }), true);
  assert.equal(allowsProjectRequestTestVerification(user, { PROJECT_REQUEST_EMAIL_VERIFICATION: "disabled" }), true);
  assert.equal(allowsProjectRequestTestVerification(user, { PROJECT_REQUEST_EMAIL_VERIFICATION: "enabled" }), false);
  assert.equal(allowsProjectRequestTestVerification(user, { PROJECT_REQUEST_EMAIL_VERIFICATION: " Enabled " }), false);
  assert.equal(allowsProjectRequestTestVerification({}, { PROJECT_REQUEST_EMAIL_VERIFICATION: "enabled" }), false);
});

test("borrador vacío: solo submissionId; cualquier otro dato exige la solicitud completa", () => {
  const submissionId = "6f1c1f5e-2f6f-4d8e-9d55-2b0a4d0f8c11";
  assert.equal(isEmptyProjectRequestDraftBody({ submissionId }), true);
  assert.equal(isEmptyProjectRequestDraftBody({ projectName: "Casa", submissionId }), false);
  assert.equal(isEmptyProjectRequestDraftBody(null), false);
  assert.equal(createProjectRequestDraftSchema.safeParse({ body: { submissionId } }).success, true);
  assert.equal(createProjectRequestDraftSchema.safeParse({ body: { submissionId: "no-uuid" } }).success, false);
});

test("envío: un borrador sin los datos obligatorios se detecta antes de verificar el código", () => {
  const complete = {
    capitalAvailability: "available_now", description: "Vivienda unifamiliar de dos plantas frente al lago.",
    developmentMode: "full", investmentRange: "10k_50k", location: "Maracaibo, Estado Zulia",
    projectName: "Casa Lago", projectType: "residential", startTime: "immediate",
  };
  assert.equal(findIncompleteProjectRequestFields(complete), null);
  const empty = findIncompleteProjectRequestFields({ status: "draft" });
  assert.deepEqual(Object.keys(empty).sort(), [
    "body.capitalAvailability", "body.description", "body.developmentMode", "body.investmentRange",
    "body.projectLocation", "body.projectName", "body.projectType", "body.startTime",
  ]);
  assert.deepEqual(Object.keys(findIncompleteProjectRequestFields({ ...complete, projectName: "  " })), ["body.projectName"]);
});
