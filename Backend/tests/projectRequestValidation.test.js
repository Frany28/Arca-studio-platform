import assert from "node:assert/strict";
import test from "node:test";

import {
  createProjectRequestSchema,
  updateProjectRequestSchema,
} from "../src/validation/projectRequestSchemas.js";

const VALID_BODY = {
  capitalAvailability: "available_now",
  decisionMaker: null,
  description: "Remodelación integral de cocina y sala principal.",
  developmentMode: "full",
  experience: null,
  hasBlueprints: null,
  investmentRange: "10k_50k",
  landStatus: "available",
  legalDocumentationStatus: "available",
  legalDocumentTypes: ["property_deed"],
  hasMultipleOwners: false,
  projectLocation: "Caracas, Venezuela",
  projectLocationFormattedAddress: null,
  projectLocationLatitude: null,
  projectLocationLongitude: null,
  projectLocationProviderPlaceId: null,
  projectName: "Apartamento Central",
  projectSize: null,
  projectType: "residential",
  quality: null,
  referenceLink: null,
  startTime: "1_3_months",
};

test("create schema accepts the complete normalized contract", () => {
  const result = createProjectRequestSchema.safeParse({
    body: { ...VALID_BODY, submissionId: "550e8400-e29b-41d4-a716-446655440000" },
  });
  assert.equal(result.success, true);
});

test("description is required between 30 and 100 characters", () => {
  assert.equal(updateProjectRequestSchema.safeParse({ body: VALID_BODY, params: { projectRequestId: "1" } }).success, true);
  for (const description of [null, "corta", "x".repeat(101)]) {
    assert.equal(updateProjectRequestSchema.safeParse({ body: { ...VALID_BODY, description }, params: { projectRequestId: "1" } }).success, false);
  }
});

test("legal documentation enforces availability, types and ownership", () => {
  assert.equal(updateProjectRequestSchema.safeParse({
    body: { ...VALID_BODY, legalDocumentTypes: [] },
    params: { projectRequestId: "1" },
  }).success, false);
  assert.equal(updateProjectRequestSchema.safeParse({
    body: {
      ...VALID_BODY,
      legalDocumentationStatus: "in_process",
      legalDocumentTypes: [],
    },
    params: { projectRequestId: "1" },
  }).success, true);
  assert.equal(updateProjectRequestSchema.safeParse({
    body: { ...VALID_BODY, hasMultipleOwners: null },
    params: { projectRequestId: "1" },
  }).success, false);
});

test("coordinates must be paired and bounded", () => {
  assert.equal(createProjectRequestSchema.safeParse({ body: { ...VALID_BODY, projectLocationLatitude: 10, submissionId: "550e8400-e29b-41d4-a716-446655440000" } }).success, false);
  assert.equal(createProjectRequestSchema.safeParse({ body: { ...VALID_BODY, projectLocationLatitude: 91, projectLocationLongitude: -66, submissionId: "550e8400-e29b-41d4-a716-446655440000" } }).success, false);
});

test("unknown and sensitive fields are rejected", () => {
  for (const field of ["code", "compatibilityScore", "clientId", "status"]) {
    const result = createProjectRequestSchema.safeParse({
      body: { ...VALID_BODY, [field]: "123456", submissionId: "550e8400-e29b-41d4-a716-446655440000" },
    });
    assert.equal(result.success, false, field);
  }
});

test("only http and https reference links are accepted", () => {
  assert.equal(createProjectRequestSchema.safeParse({ body: { ...VALID_BODY, referenceLink: "javascript:alert(1)", submissionId: "550e8400-e29b-41d4-a716-446655440000" } }).success, false);
});

const updateBody = (body) => updateProjectRequestSchema.safeParse({ body, params: { projectRequestId: "1" } });
const NO_PROPERTY_BODY = {
  ...VALID_BODY,
  hasBlueprints: null,
  hasMultipleOwners: null,
  landStatus: "unavailable",
  legalDocumentationStatus: null,
  legalDocumentTypes: [],
};

test("land status is required because it decides the property fields", () => {
  assert.equal(updateBody({ ...VALID_BODY, landStatus: null }).success, false);
  assert.equal(updateBody({ ...VALID_BODY, landStatus: "invalid" }).success, false);
});

test("with available property, legal status and owners are required", () => {
  const missingStatus = updateBody({ ...VALID_BODY, legalDocumentationStatus: null, legalDocumentTypes: [] });
  assert.equal(missingStatus.success, false);
  assert.deepEqual(missingStatus.error.issues.map((issue) => issue.path.join(".")), ["body.legalDocumentationStatus"]);
  assert.equal(updateBody({ ...VALID_BODY, hasMultipleOwners: null }).success, false);
  assert.equal(updateBody({ ...VALID_BODY, hasBlueprints: true }).success, true);
});

test("without available property, legal fields are optional and default to empty", () => {
  for (const landStatus of ["unavailable", "acquiring"]) {
    const result = updateBody({ ...NO_PROPERTY_BODY, landStatus });
    assert.equal(result.success, true, landStatus);
  }
  const { hasBlueprints: _b, hasMultipleOwners: _o, legalDocumentationStatus: _s, legalDocumentTypes: _t, ...omitted } = NO_PROPERTY_BODY;
  const result = updateBody(omitted);
  assert.equal(result.success, true);
  assert.equal(result.data.body.legalDocumentationStatus, null);
  assert.deepEqual(result.data.body.legalDocumentTypes, []);
  assert.equal(result.data.body.hasMultipleOwners, null);
  assert.equal(result.data.body.hasBlueprints, null);
});

test("without available property, contradictory legal data is rejected", () => {
  for (const [field, value] of [
    ["legalDocumentationStatus", "available"],
    ["legalDocumentTypes", ["property_deed"]],
    ["hasMultipleOwners", false],
    ["hasBlueprints", true],
  ]) {
    const result = updateBody({ ...NO_PROPERTY_BODY, [field]: value });
    assert.equal(result.success, false, field);
    assert.ok(result.error.issues.some((issue) => issue.path.join(".") === `body.${field}`), field);
  }
});
