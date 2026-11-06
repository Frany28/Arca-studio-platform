import assert from "node:assert/strict";
import test from "node:test";

import {
  allowsProjectRequestTestVerification,
  getProjectRequestTestVerificationConfig,
} from "../src/config/projectRequestTestVerification.js";
import {
  createProjectRequestDraftSchema,
  findIncompleteProjectRequestFields,
  isEmptyProjectRequestDraftBody,
} from "../src/validation/projectRequestSchemas.js";

const ENABLED = Object.freeze({
  ARCA_DEPLOYMENT_STAGE: "staging",
  PROJECT_REQUEST_TEST_VERIFICATION: "enabled",
  PROJECT_REQUEST_TEST_VERIFICATION_EMAILS: "demo@arca.test, Pruebas@Arca.test",
});

test("validación de pruebas: solo con el modo, una etapa de pruebas y la cuenta autorizada", () => {
  assert.equal(allowsProjectRequestTestVerification({ email: "demo@arca.test" }, ENABLED), true);
  assert.equal(allowsProjectRequestTestVerification({ email: "PRUEBAS@arca.test" }, ENABLED), true, "sin distinguir mayúsculas");
  assert.equal(allowsProjectRequestTestVerification({ email: "otro@arca.test" }, ENABLED), false, "cuenta no autorizada");
  assert.equal(allowsProjectRequestTestVerification({}, ENABLED), false);
  // Fail-closed: cualquier condición ausente deja la verificación por correo.
  for (const [name, value] of [
    ["PROJECT_REQUEST_TEST_VERIFICATION", ""],
    ["PROJECT_REQUEST_TEST_VERIFICATION", "true"],
    ["ARCA_DEPLOYMENT_STAGE", ""],
    ["ARCA_DEPLOYMENT_STAGE", "production"],
    ["PROJECT_REQUEST_TEST_VERIFICATION_EMAILS", ""],
  ]) {
    const environment = { ...ENABLED, [name]: value };
    assert.equal(getProjectRequestTestVerificationConfig(environment).active, false, `${name}=${value}`);
    assert.equal(allowsProjectRequestTestVerification({ email: "demo@arca.test" }, environment), false);
  }
  // NODE_ENV=production (staging en Vercel) no lo impide ni lo activa por sí solo.
  assert.equal(allowsProjectRequestTestVerification({ email: "demo@arca.test" }, { ...ENABLED, NODE_ENV: "production" }), true);
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
