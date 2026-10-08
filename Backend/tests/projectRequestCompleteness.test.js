import assert from "node:assert/strict";
import test from "node:test";

import { evaluateProjectRequestCompleteness } from "../src/domain/projectRequestCompleteness.js";
import { evaluateFinancialViability } from "../src/domain/projectRequestFinancialViability.js";
import { buildProjectRequestMetrics } from "../src/domain/projectRequestEvaluation.js";

// El servicio importa la configuración de PostgreSQL; la prueba no ejecuta consultas.
process.env.DATABASE_URL ||= "postgres://localhost/arca-contract-test";
const { toPublicProjectRequest } = await import("../src/services/projectRequestService.js");

const ANSWERED_WITHOUT_PROPERTY = {
  capitalAvailability: "seeking_financing",
  decisionMaker: "partner",
  description: "Remodelación de cocina pequeña.",
  developmentMode: "undecided",
  experience: "first_time",
  hasMultipleOwners: null,
  hasPlans: null,
  investmentRange: "undefined",
  landStatus: "unavailable",
  legalDocumentationStatus: null,
  legalDocumentTypes: [],
  location: "Maracaibo, Zulia",
  projectName: "Cocina Norte",
  projectSize: "unknown",
  projectType: "residential",
  quality: "functional_economic",
  startTime: "over_6_months",
};

const ANSWERED_WITH_PROPERTY = {
  ...ANSWERED_WITHOUT_PROPERTY,
  hasMultipleOwners: true,
  hasPlans: false,
  landStatus: "available",
  legalDocumentationStatus: "available",
  legalDocumentTypes: ["lease_contract"],
};

test("unfavorable but valid answers count as answered; legal questions are N/A without property", () => {
  assert.deepEqual(evaluateProjectRequestCompleteness(ANSWERED_WITHOUT_PROPERTY), {
    answered: 13,
    applicable: 13,
    missingFields: [],
    score: 100,
  });
});

test("with property the legal questions enter the denominator", () => {
  assert.deepEqual(evaluateProjectRequestCompleteness(ANSWERED_WITH_PROPERTY), {
    answered: 17,
    applicable: 17,
    missingFields: [],
    score: 100,
  });

  // Los documentos solo aplican cuando la documentación está disponible.
  const inProcess = evaluateProjectRequestCompleteness({
    ...ANSWERED_WITH_PROPERTY,
    legalDocumentationStatus: "in_process",
    legalDocumentTypes: [],
  });
  assert.equal(inProcess.applicable, 16);
  assert.equal(inProcess.score, 100);
});

test("unanswered applicable questions reduce completeness and are listed", () => {
  const result = evaluateProjectRequestCompleteness({
    ...ANSWERED_WITH_PROPERTY,
    decisionMaker: null,
    experience: null,
    hasPlans: null,
    legalDocumentTypes: [],
  });
  assert.equal(result.applicable, 17);
  assert.equal(result.answered, 13);
  assert.equal(result.score, 76);
  assert.deepEqual(result.missingFields, ["legalDocumentTypes", "hasPlans", "decisionMaker", "experience"]);
});

test("not-applicable leftovers do not affect numerator or denominator", () => {
  const leftovers = evaluateProjectRequestCompleteness({
    ...ANSWERED_WITHOUT_PROPERTY,
    hasPlans: true,
    legalDocumentationStatus: "unavailable",
  });
  assert.deepEqual(leftovers, evaluateProjectRequestCompleteness(ANSWERED_WITHOUT_PROPERTY));
});

test("invalid values are not counted as answered", () => {
  const result = evaluateProjectRequestCompleteness({
    ...ANSWERED_WITHOUT_PROPERTY,
    description: "corta",
    projectType: "castle",
  });
  assert.deepEqual(result.missingFields, ["projectType", "description"]);
  assert.equal(evaluateProjectRequestCompleteness(null).answered, 0);
});

test("financial viability never reports an invented percentage", () => {
  // Antes era un PENDING_RULES fijo; ahora es un estado derivado de la matriz relativa.
  const metrics = buildProjectRequestMetrics(ANSWERED_WITHOUT_PROPERTY);
  assert.equal(metrics.financialViability.score, null);
  assert.equal(metrics.financialViability.status, "INSUFFICIENT_DATA");
  assert.deepEqual(metrics.financialViability, evaluateFinancialViability(ANSWERED_WITHOUT_PROPERTY));
});

test("public project request keeps compatibility and adds independent metrics", () => {
  const publicRequest = toPublicProjectRequest({
    ...ANSWERED_WITHOUT_PROPERTY,
    compatibility: { level: "high", reasonCodes: ["companyImmediate"], score: 70, version: "2.2" },
    id: 3,
    submissionId: "secret-submission",
  });

  assert.equal(publicRequest.submissionId, undefined);
  assert.deepEqual(publicRequest.compatibility, {
    findings: null,
    level: "high",
    observations: ["Un inicio inmediato debe coordinarse con el proceso de decisión de la empresa o junta."],
    score: 70,
  });
  assert.equal(publicRequest.completeness.score, 100);
  assert.equal(publicRequest.financialViability.score, null);
  assert.equal(publicRequest.financialViability.status, "INSUFFICIENT_DATA");
});
