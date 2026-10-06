import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProjectRequestPayload,
  getProjectRequestFieldErrors,
  getProjectRequestFileErrors,
  hasAvailableProperty,
} from "../src/utils/projectRequestValidation.js";

const VALID_VALUES = {
  capitalAvailability: "undefined",
  description: "Remodelación integral de cocina y sala principal.",
  developmentMode: "undecided",
  investmentRange: "undefined",
  landStatus: "available",
  legalDocumentationStatus: "available",
  legalDocumentTypes: ["property_deed"],
  location: "Maracaibo, Estado Zulia",
  projectName: "Casa Jardín",
  projectType: "residential",
  multipleOwners: "no",
  referenceLink: "",
  startTime: "over_6_months",
};

test("project request validation accepts configured stable values", () => {
  assert.deepEqual(getProjectRequestFieldErrors(VALID_VALUES), {});
});

test("project request validation reports field-specific errors", () => {
  const errors = getProjectRequestFieldErrors({ ...VALID_VALUES, projectName: "x", referenceLink: "javascript:test" });
  assert.match(errors.projectName, /3 caracteres/);
  assert.match(errors.referenceLink, /http/);
});

test("description is required between 30 and 100 characters", () => {
  assert.ok(getProjectRequestFieldErrors({ ...VALID_VALUES, description: "" }).description);
  assert.ok(getProjectRequestFieldErrors({ ...VALID_VALUES, description: "muy corta" }).description);
  assert.ok(getProjectRequestFieldErrors({ ...VALID_VALUES, description: "x".repeat(101) }).description);
  assert.equal(getProjectRequestFieldErrors({ ...VALID_VALUES, description: "x".repeat(30) }).description, undefined);
});

test("legal documentation requires coherent document selections and ownership data", () => {
  assert.ok(getProjectRequestFieldErrors({
    ...VALID_VALUES,
    legalDocumentTypes: [],
  }).legalDocumentTypes);
  assert.ok(getProjectRequestFieldErrors({
    ...VALID_VALUES,
    legalDocumentationStatus: "in_process",
    legalDocumentTypes: ["property_deed"],
  }).legalDocumentTypes);
  assert.ok(getProjectRequestFieldErrors({
    ...VALID_VALUES,
    multipleOwners: "",
  }).multipleOwners);
});

test("file validation enforces extension, mime, size and duplicate names", () => {
  const validFile = { name: "referencia.jpg", size: 100, type: "image/jpeg" };
  assert.deepEqual(getProjectRequestFileErrors([validFile]), []);
  const errors = getProjectRequestFileErrors([
    validFile,
    { ...validFile },
    { name: "script.jpg", size: 100, type: "application/javascript" },
  ]);
  assert.ok(errors.some((error) => error.includes("repetido")));
  assert.ok(errors.some((error) => error.includes("formato")));
});

test("payload never includes the temporary code or computed score", () => {
  const payload = buildProjectRequestPayload({
    ...VALID_VALUES,
    code: "123456",
    compatibilityScore: 100,
    hasBlueprints: "Indeterminate",
  }, "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(payload.code, undefined);
  assert.equal(payload.compatibilityScore, undefined);
  assert.equal(payload.hasBlueprints, null);
  assert.equal(payload.hasMultipleOwners, false);
  assert.deepEqual(payload.legalDocumentTypes, ["property_deed"]);
  assert.equal(payload.submissionId, "550e8400-e29b-41d4-a716-446655440000");
});

const NO_PROPERTY_VALUES = {
  ...VALID_VALUES,
  hasBlueprints: "Indeterminate",
  landStatus: "unavailable",
  legalDocumentationStatus: "",
  legalDocumentTypes: [],
  multipleOwners: "",
};

test("land status is required because it decides the property section", () => {
  assert.ok(getProjectRequestFieldErrors({ ...VALID_VALUES, landStatus: "" }).landStatus);
  assert.equal(hasAvailableProperty("available"), true);
  for (const status of ["acquiring", "unavailable", "", null, undefined]) {
    assert.equal(hasAvailableProperty(status), false, String(status));
  }
});

test("with available property the legal fields are validated", () => {
  const errors = getProjectRequestFieldErrors({ ...NO_PROPERTY_VALUES, landStatus: "available" });
  assert.ok(errors.legalDocumentationStatus);
  assert.ok(errors.multipleOwners);
});

test("without available property the hidden legal fields never produce errors", () => {
  for (const landStatus of ["unavailable", "acquiring"]) {
    assert.deepEqual(getProjectRequestFieldErrors({ ...NO_PROPERTY_VALUES, landStatus }), {}, landStatus);
  }
  // Valores residuales inválidos tampoco bloquean mientras la sección no aplica.
  assert.deepEqual(getProjectRequestFieldErrors({
    ...NO_PROPERTY_VALUES,
    legalDocumentationStatus: "in_process",
    legalDocumentTypes: ["property_deed", "property_deed"],
  }), {});
});

test("payload excludes legal data when the property is not available", () => {
  const payload = buildProjectRequestPayload({
    ...VALID_VALUES,
    hasBlueprints: "Yes",
    landStatus: "unavailable",
  });
  assert.equal(payload.landStatus, "unavailable");
  assert.equal(payload.legalDocumentationStatus, null);
  assert.deepEqual(payload.legalDocumentTypes, []);
  assert.equal(payload.hasMultipleOwners, null);
  assert.equal(payload.hasBlueprints, null);

  const withProperty = buildProjectRequestPayload({ ...VALID_VALUES, hasBlueprints: "Yes" });
  assert.equal(withProperty.legalDocumentationStatus, "available");
  assert.equal(withProperty.hasMultipleOwners, false);
  assert.equal(withProperty.hasBlueprints, true);
});
