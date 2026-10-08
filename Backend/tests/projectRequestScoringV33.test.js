import assert from "node:assert/strict";
import test from "node:test";

import { canEstimateProjectSize } from "../src/domain/projectRequest.js";
import {
  COMPATIBILITY_SCORING_VERSION,
  describeCompatibilityEvidence,
  detectCompatibilityEvidence,
  evaluateProjectCompatibility,
  publicCompatibility,
} from "../src/domain/projectRequestCompatibility.js";
import { evaluateProjectRequestCompleteness } from "../src/domain/projectRequestCompleteness.js";
import { evaluateFinancialViability } from "../src/domain/projectRequestFinancialViability.js";
import { buildProjectRequestReviewObservations, REVIEW_OBSERVATIONS } from "../src/domain/projectRequestReviewObservations.js";
import { STAND_REQUIREMENTS_VALUES } from "../src/domain/projectRequestStand.js";

process.env.DATABASE_URL ||= "postgres://localhost/arca-contract-test";
const { pool } = await import("../src/config/db.js");
const { submitProjectRequest, toPublicProjectRequest } = await import("../src/services/projectRequestService.js");
const { loadProjectRequestReviewQueue } = await import("../src/services/projectRequestWorkflowService.js");

// Residencial con inmueble disponible, preparado y coherente.
const WITH_PROPERTY = Object.freeze({
  capitalAvailability: "available_now", decisionMaker: "self",
  description: "Remodelación integral de cocina y sala principal.", developmentMode: "full",
  experience: "first_time", hasMultipleOwners: false, hasPlans: true, investmentRange: "10k_50k",
  landStatus: "available", legalDocumentationStatus: "available", legalDocumentTypes: ["property_deed"],
  location: "Caracas, Venezuela", projectName: "Cocina Norte", projectSize: "small_lt_80",
  projectType: "residential", quality: "standard", referenceLink: null, startTime: "over_6_months",
});
const WITHOUT_PROPERTY = Object.freeze({
  ...WITH_PROPERTY, hasMultipleOwners: null, hasPlans: null, landStatus: "unavailable",
  legalDocumentationStatus: null, legalDocumentTypes: [],
});
const STAND = Object.freeze({
  ...WITHOUT_PROPERTY, landStatus: null, projectType: "advertising_stand",
  standRequirements: Object.freeze({ documentTypes: [], hasSpacePlans: true, requirementsStatus: "unavailable", spaceStatus: "assigned" }),
});

/**
 * Devuelve el stand con un bloque de requisitos modificado.
 *
 * @param {object} changes - Respuestas del bloque que cambian.
 * @returns {object} Stand con el bloque actualizado.
 */
function standWith(changes) {
  return { ...STAND, standRequirements: { ...STAND.standRequirements, ...changes } };
}

/**
 * Evalúa y resume la compatibilidad como [puntuación, causas].
 *
 * @param {object} answers - Respuestas de la solicitud.
 * @returns {[number, Array<string>]} Puntuación y códigos de causa.
 */
function scoreAndCauses(answers) {
  const evaluation = evaluateProjectCompatibility(answers);
  return [evaluation.score, evaluation.findings.map(({ code }) => code)];
}

test("versión: las evaluaciones nuevas se guardan como 3.3", () => {
  assert.equal(COMPATIBILITY_SCORING_VERSION, "3.3");
  assert.equal(evaluateProjectCompatibility(WITH_PROPERTY).version, "3.3");
});

// --- Planos ---------------------------------------------------------------------------

const BLUEPRINT_CASES = [
  ["1. inmueble disponible con planos", { ...WITH_PROPERTY, hasPlans: true }, []],
  ["2. inmueble disponible sin planos", { ...WITH_PROPERTY, hasPlans: false }, ["propertyBlueprintsUnavailable"]],
  ["3. inmueble disponible sin respuesta", { ...WITH_PROPERTY, hasPlans: null }, ["propertyBlueprintsUnconfirmed"]],
  ["3b. inmueble disponible sin el campo", { ...WITH_PROPERTY, hasPlans: undefined }, ["propertyBlueprintsUnconfirmed"]],
  ["4. inmueble no disponible", { ...WITHOUT_PROPERTY, hasPlans: false }, []],
  ["4b. inmueble en adquisición", { ...WITHOUT_PROPERTY, landStatus: "acquiring", hasPlans: null }, []],
  ["5. stand publicitario (planos del inmueble N/A)", { ...STAND, landStatus: "available", hasPlans: false }, []],
];

for (const [name, answers, observationCodes] of BLUEPRINT_CASES) {
  test(`planos ${name}: sin deducción y observación solo si aplica`, () => {
    const evaluation = evaluateProjectCompatibility(answers);
    assert.equal(evaluation.score, 100);
    assert.ok(!evaluation.reasonCodes.includes("blueprintsUnavailable"));
    assert.deepEqual(buildProjectRequestReviewObservations(answers).map(({ code }) => code), observationCodes);
  });
}

test("6. observaciones de planos: textos acordados, sin puntos ni efecto en otras métricas", () => {
  assert.deepEqual(buildProjectRequestReviewObservations({ ...WITH_PROPERTY, hasPlans: false }), [{
    code: "propertyBlueprintsUnavailable",
    explanation: "El cliente no dispone de planos del inmueble. Durante la revisión inicial se deberá determinar si se requiere un levantamiento arquitectónico o la elaboración de planos.",
  }]);
  assert.equal(REVIEW_OBSERVATIONS.propertyBlueprintsUnconfirmed, "No se ha confirmado la disponibilidad de planos del inmueble. Se recomienda aclararlo durante la revisión inicial.");
  for (const hasPlans of [true, false, null]) {
    const answers = { ...WITH_PROPERTY, hasPlans };
    // La compatibilidad no cambia; la completitud mantiene su regla (sin respuesta = incompleta).
    assert.equal(evaluateProjectCompatibility(answers).score, 100);
    assert.deepEqual(evaluateFinancialViability(answers), evaluateFinancialViability(WITH_PROPERTY));
    assert.equal(evaluateProjectRequestCompleteness(answers).missingFields.includes("hasPlans"), hasPlans === null);
  }
  // El cliente no recibe estas observaciones en su compatibilidad pública.
  const publicRequest = toPublicProjectRequest({ ...WITH_PROPERTY, hasPlans: false, compatibility: evaluateProjectCompatibility({ ...WITH_PROPERTY, hasPlans: false }), id: 1, submissionId: "x" });
  assert.deepEqual(publicRequest.compatibility.observations, []);
  assert.equal("reviewObservations" in publicRequest, false);
  assert.deepEqual(buildProjectRequestReviewObservations(null), []);
});

test("7. evaluaciones históricas con deducción por planos conservan su lectura", () => {
  assert.equal(describeCompatibilityEvidence("blueprintsUnavailable").cause, "BLUEPRINTS_UNAVAILABLE");
  for (const version of ["3.0", "3.1", "3.2"]) {
    const persisted = { level: "excellent", reasonCodes: ["legalDocumentationInProcess", "blueprintsUnavailable"], score: 95, version };
    const result = publicCompatibility(persisted);
    assert.equal(result.score, 95, version);
    assert.equal(result.level, "excellent", version);
    assert.deepEqual(result.findings.map(({ code }) => code), ["LEGAL_DOCUMENTATION_PENDING", "BLUEPRINTS_UNAVAILABLE"], version);
    assert.ok(result.observations.includes("Disponer de planos del lugar agilizará el análisis del inmueble."), version);
  }
  // Nunca se genera como penalización nueva.
  for (const hasPlans of [false, null, undefined]) {
    assert.ok(!detectCompatibilityEvidence({ ...WITH_PROPERTY, hasPlans }).includes("blueprintsUnavailable"));
  }
});

// --- Tamaño ---------------------------------------------------------------------------

const SIZE_CASES = [
  ["8. residencial con inmueble disponible", { ...WITH_PROPERTY }, 85],
  ["9. residencial en adquisición", { ...WITHOUT_PROPERTY, landStatus: "acquiring" }, 100],
  ["10. residencial sin inmueble", { ...WITHOUT_PROPERTY }, 100],
  ["11. comercial con inmueble disponible", { ...WITH_PROPERTY, projectType: "commercial" }, 85],
  ["12. corporativo con inmueble disponible", { ...WITH_PROPERTY, projectType: "corporate" }, 85],
  ["12b. tipo histórico con inmueble disponible", { ...WITH_PROPERTY, projectType: "stands_exhibitions" }, 85],
  ["12c. tipo histórico sin inmueble", { ...WITHOUT_PROPERTY, projectType: "stands_exhibitions" }, 100],
  ["13. stand con espacio asignado y medidas", standWith({ spaceStatus: "assigned", hasSpacePlans: true }), 85],
  ["14. stand con espacio asignado sin medidas", standWith({ spaceStatus: "assigned", hasSpacePlans: false }), 100],
  ["14b. stand con espacio asignado sin responder medidas", standWith({ spaceStatus: "assigned", hasSpacePlans: null }), 100],
  ["15. stand con asignación en proceso", standWith({ spaceStatus: "in_process", hasSpacePlans: true }), 100],
  ["16. stand sin asignación", standWith({ spaceStatus: "unassigned", hasSpacePlans: true }), 100],
  ["16b. stand sin bloque guardado", { ...STAND, standRequirements: null }, 100],
];

for (const [name, answers, expectedScore] of SIZE_CASES) {
  test(`tamaño desconocido ${name}: ${expectedScore === 85 ? "−15" : "0"}`, () => {
    for (const projectSize of ["unknown", null]) {
      const [score, causes] = scoreAndCauses({ ...answers, projectSize });
      assert.equal(score, expectedScore, String(projectSize));
      assert.deepEqual(causes, expectedScore === 85 ? ["PROJECT_SIZE_UNDEFINED"] : [], String(projectSize));
    }
  });
}

test("17. con tamaño definido nunca resta por tamaño ni suma por mayor tamaño", () => {
  const estimable = [WITH_PROPERTY, standWith({ spaceStatus: "assigned", hasSpacePlans: true })];
  for (const base of [...estimable, WITHOUT_PROPERTY, standWith({ spaceStatus: "unassigned" })]) {
    for (const projectSize of ["small_lt_80", "medium_80_200", "large_200_500", "very_large_gt_500"]) {
      const [score, causes] = scoreAndCauses({ ...base, investmentRange: "over_150k", projectSize });
      assert.equal(score, 100, `${base.projectType}/${projectSize}`);
      assert.deepEqual(causes, []);
    }
  }
});

test("estimabilidad del tamaño: todas las combinaciones del stand y del inmueble", () => {
  for (const spaceStatus of [...STAND_REQUIREMENTS_VALUES.spaceStatus, undefined]) {
    for (const hasSpacePlans of [true, false, null]) {
      assert.equal(canEstimateProjectSize(standWith({ spaceStatus, hasSpacePlans })), spaceStatus === "assigned" && hasSpacePlans === true);
    }
  }
  for (const projectType of ["residential", "commercial", "corporate", "stands_exhibitions", null]) {
    for (const landStatus of ["available", "acquiring", "unavailable", null]) {
      assert.equal(canEstimateProjectSize({ landStatus, projectType }), landStatus === "available", `${projectType}/${landStatus}`);
    }
  }
});

test("18. varias causas simultáneas: una deducción máxima por cada causa", () => {
  const answers = {
    ...WITH_PROPERTY, capitalAvailability: "undefined", developmentMode: "undecided", hasPlans: false,
    investmentRange: "undefined", legalDocumentationStatus: "unavailable", legalDocumentTypes: [],
    projectSize: "unknown", quality: "luxury", startTime: "immediate",
  };
  const evaluation = evaluateProjectCompatibility(answers);
  assert.deepEqual(evaluation.findings.map(({ code, deduction }) => [code, deduction]), [
    ["FINANCIAL_DEFINITION_INSUFFICIENT", 20],
    ["CAPITAL_TIMING_MISMATCH", 20],
    ["PROJECT_SIZE_UNDEFINED", 15],
    ["EXECUTION_MODE_UNDEFINED", 10],
    ["LEGAL_DOCUMENTATION_PENDING", 6],
  ]);
  assert.equal(evaluation.score, 29);
  assert.equal(new Set(evaluation.findings.map(({ code }) => code)).size, evaluation.findings.length);
  assert.equal(evaluation.reasonCodes.filter((code) => code === "projectSizeUndefined").length, 1);
});

// --- Integridad -----------------------------------------------------------------------

test("19. compatibilidad histórica 3.0, 3.1 y 3.2 se conserva sin recalcular", () => {
  const historical = [
    { level: "high", reasonCodes: ["projectSizeUndefined", "referenceFilesMissing", "blueprintsUnavailable"], score: 78, version: "3.0" },
    { level: "excellent", reasonCodes: ["projectSizeUndefined"], score: 85, version: "3.1" },
    { level: "excellent", reasonCodes: ["projectSizeUndefined", "blueprintsUnavailable"], score: 83, version: "3.2" },
  ];
  for (const persisted of historical) {
    const snapshot = structuredClone(persisted);
    // Las respuestas actuales (sin inmueble) ya no restarían, pero el resultado guardado se mantiene.
    const publicRequest = toPublicProjectRequest({ ...WITHOUT_PROPERTY, projectSize: "unknown", compatibility: persisted, id: 2, submissionId: "x" });
    assert.equal(publicRequest.compatibility.score, persisted.score, persisted.version);
    assert.equal(publicRequest.compatibility.level, persisted.level, persisted.version);
    assert.equal(publicRequest.compatibility.findings.length, persisted.reasonCodes.length, persisted.version);
    assert.deepEqual(persisted, snapshot);
  }
});

test("20. completitud de stands no cambia: «No lo sé aún» responde y la ausencia queda pendiente", () => {
  assert.deepEqual(evaluateProjectRequestCompleteness({ ...STAND, projectSize: "unknown" }), { answered: 15, applicable: 15, missingFields: [], score: 100 });
  assert.deepEqual(evaluateProjectRequestCompleteness({ ...STAND, projectSize: null }).missingFields, ["projectSize"]);
  assert.deepEqual(evaluateProjectRequestCompleteness(standWith({ hasSpacePlans: null })).missingFields, ["standRequirements.hasSpacePlans"]);
  assert.deepEqual(evaluateProjectRequestCompleteness({ ...WITH_PROPERTY, projectSize: "unknown" }).score, 100);
});

test("22. coherencia financiera idéntica con planos y tamaño en cualquier estado", () => {
  for (const base of [WITH_PROPERTY, WITHOUT_PROPERTY, STAND]) {
    for (const projectSize of ["unknown", null, "small_lt_80"]) {
      const reference = evaluateFinancialViability({ ...base, projectSize });
      for (const hasPlans of [true, false, null]) {
        assert.deepEqual(evaluateFinancialViability({ ...base, projectSize, hasPlans }), reference);
      }
    }
  }
  assert.equal(evaluateFinancialViability({ ...STAND, investmentRange: "under_10k", projectSize: "large_200_500" }).status, "REVIEW_REQUIRED");
});

test("25. la cola administrativa expone las observaciones sin puntos solo donde aplican", async (context) => {
  const row = (overrides) => ({
    id: "9", client_id: "2", requested_by: "1", status: "pending_review", project_name: "Cocina Norte",
    project_type: "residential", stand_requirements: null, location: "Caracas, Venezuela",
    description: WITH_PROPERTY.description, project_size: "unknown", development_mode: "full",
    land_status: "available", legal_documentation_status: "available", legal_document_types: ["property_deed"],
    has_multiple_owners: false, has_plans: false, investment_range: "10k_50k", capital_availability: "available_now",
    expected_start_time: "over_6_months", decision_maker: "self", quality_expectation: "standard",
    prior_design_experience: "first_time", compatibility_score: 85, compatibility_level: "excellent", ...overrides,
  });
  context.mock.method(pool, "query", async () => ({
    rows: [
      row({}),
      row({ id: "10", has_plans: null }),
      row({ id: "11", land_status: "unavailable", legal_documentation_status: null, legal_document_types: [], has_multiple_owners: null, has_plans: null }),
      row({ id: "12", project_type: "advertising_stand", land_status: null, legal_documentation_status: null, legal_document_types: [], has_multiple_owners: null, has_plans: null, stand_requirements: STAND.standRequirements }),
    ],
  }));
  const queue = await loadProjectRequestReviewQueue({ cursor: null, limit: 25, user: { id: 1, role: { code: "admin" } } });
  assert.deepEqual(queue.items.map(({ reviewObservations }) => reviewObservations.map(({ code }) => code)), [
    ["propertyBlueprintsUnavailable"], ["propertyBlueprintsUnconfirmed"], [], [],
  ]);
  assert.ok(queue.items.every((item) => !("answers" in item)));
  // La compatibilidad guardada de la cola no se modifica.
  assert.deepEqual(queue.items[0].compatibility, { score: 85, level: "excellent" });
});

test("envío: guarda 3.3 sin deducción por planos ni por tamaño no estimable", async (context) => {
  let evaluationValues;
  const row = {
    id: "5", client_id: "2", requested_by: "1", status: "draft", project_name: "Stand Feria",
    project_type: "advertising_stand", stand_requirements: { spaceStatus: "in_process", hasSpacePlans: null, requirementsStatus: null, documentTypes: [] },
    location: "Caracas, Venezuela", description: WITH_PROPERTY.description, project_size: "unknown",
    development_mode: "full", land_status: null, legal_documentation_status: null, legal_document_types: [],
    has_multiple_owners: null, has_plans: null, investment_range: "10k_50k", capital_availability: "available_now",
    expected_start_time: "over_6_months", decision_maker: "self", quality_expectation: "standard",
    prior_design_experience: "first_time", reference_link: null, compatibility_score: null,
  };
  context.mock.method(pool, "query", async (sql, values) => {
    if (/existing_names/.test(sql)) return { rows: [] };
    if (/with target as/.test(sql)) {
      evaluationValues = values;
      return { rows: [{ ...row, status: "pending_verification", compatibility_score: values[3], compatibility_level: values[4], compatibility_reason_codes: JSON.parse(values[5]), compatibility_scoring_version: values[6] }] };
    }
    return { rows: [{ ...row }] };
  });
  await submitProjectRequest({ projectRequestId: 5, user: { id: 1, clientId: 2 } });
  assert.deepEqual([evaluationValues[3], evaluationValues[5], evaluationValues[6]], [100, "[]", "3.3"]);
});
