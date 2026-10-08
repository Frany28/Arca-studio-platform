import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPATIBILITY_SCORING_VERSION,
  evaluateProjectCompatibility,
  publicCompatibility,
} from "../src/domain/projectRequestCompatibility.js";
import { buildProjectRequestMetrics } from "../src/domain/projectRequestEvaluation.js";
import { STAND_REQUIREMENTS_VALUES } from "../src/domain/projectRequestStand.js";
import { validate } from "../src/middlewares/validate.js";
import { createProjectRequestSchema, updateProjectRequestSchema } from "../src/validation/projectRequestSchemas.js";

process.env.DATABASE_URL ||= "postgres://localhost/arca-contract-test";
const { pool } = await import("../src/config/db.js");
const { submitProjectRequest, toPublicProjectRequest } = await import("../src/services/projectRequestService.js");
const { loadProjectRequestReviewQueue } = await import("../src/services/projectRequestWorkflowService.js");

// Registro de un stand preparado y coherente, con la forma que devuelve el repositorio.
const STAND = Object.freeze({
  capitalAvailability: "available_now",
  decisionMaker: "company_board",
  description: "Stand modular para feria con zona de demostración.",
  developmentMode: "full",
  experience: "positive",
  hasFiles: true,
  hasMultipleOwners: null,
  hasPlans: null,
  investmentRange: "10k_50k",
  landStatus: null,
  legalDocumentationStatus: null,
  legalDocumentTypes: [],
  location: "Maracaibo, Estado Zulia",
  projectName: "Stand Feria Norte",
  projectSize: "small_lt_80",
  projectType: "advertising_stand",
  quality: "standard",
  referenceLink: "https://example.test/stand",
  standRequirements: Object.freeze({
    documentTypes: ["exhibitor_manual"],
    hasSpacePlans: true,
    requirementsStatus: "available",
    spaceStatus: "assigned",
  }),
  startTime: "over_6_months",
});
// Mismas respuestas en un proyecto residencial sin inmueble (control de las reglas vigentes).
const RESIDENTIAL = Object.freeze({ ...STAND, landStatus: "unavailable", projectType: "residential", standRequirements: null });

/**
 * Sustituye respuestas del bloque del stand conservando las demás.
 *
 * @param {object} changes - Respuestas del bloque que cambian.
 * @returns {object} Registro del stand con el bloque actualizado.
 */
function standWith(changes) {
  return { ...STAND, standRequirements: { ...STAND.standRequirements, ...changes } };
}

/**
 * Ejecuta la cadena HTTP de validación y devuelve el error estandarizado, si existe.
 *
 * @param {object} schema - Esquema Zod de la ruta.
 * @param {object} request - Partes de la petición (body, params).
 * @returns {object|undefined} Error de validación entregado al siguiente middleware.
 */
function validationError(schema, request) {
  let error;
  validate(schema)(request, {}, (result) => { error = result; });
  return error;
}

const STAND_BODY = Object.freeze({
  capitalAvailability: "available_now", description: STAND.description, developmentMode: "full",
  investmentRange: "10k_50k", projectLocation: STAND.location, projectName: STAND.projectName,
  projectType: "advertising_stand", startTime: "immediate",
  standRequirements: { requirementsStatus: "unavailable", spaceStatus: "unassigned" },
});

test("stand con espacio asignado, en proceso o sin asignar: el espacio no puntúa ni hereda reglas del inmueble", () => {
  for (const spaceStatus of STAND_REQUIREMENTS_VALUES.spaceStatus) {
    const answers = standWith({ spaceStatus });
    const compatibility = evaluateProjectCompatibility(answers);
    assert.equal(compatibility.score, 100, spaceStatus);
    assert.deepEqual(compatibility.findings, [], spaceStatus);
    assert.equal(compatibility.version, COMPATIBILITY_SCORING_VERSION);
    const metrics = buildProjectRequestMetrics(answers);
    assert.deepEqual(metrics.completeness, { answered: 16, applicable: 16, missingFields: [], score: 100 });
    assert.equal(metrics.financialViability.status, "NO_OBVIOUS_CONFLICT");
  }
});

test("stand sin normativas: la documentación del evento es N/A y la respuesta negativa cuenta como respondida", () => {
  for (const requirementsStatus of ["unavailable", "in_process"]) {
    const answers = standWith({ documentTypes: [], hasSpacePlans: false, requirementsStatus });
    assert.deepEqual(buildProjectRequestMetrics(answers).completeness, { answered: 15, applicable: 15, missingFields: [], score: 100 });
    assert.equal(evaluateProjectCompatibility(answers).score, 100);
  }
});

test("stand con normativas disponibles: la documentación aplica y sin selección queda incompleta", () => {
  const withoutDocuments = buildProjectRequestMetrics(standWith({ documentTypes: [] })).completeness;
  assert.deepEqual(withoutDocuments, { answered: 15, applicable: 16, missingFields: ["standRequirements.documentTypes"], score: 94 });
  assert.equal(evaluateProjectCompatibility(standWith({ documentTypes: [] })).score, 100);
});

test("stand con documentación del evento: cualquier selección válida cuenta igual y no suma puntos", () => {
  for (const documentTypes of [["exhibitor_manual"], [...STAND_REQUIREMENTS_VALUES.documentTypes]]) {
    const answers = standWith({ documentTypes });
    assert.equal(buildProjectRequestMetrics(answers).completeness.score, 100);
    assert.equal(evaluateProjectCompatibility(answers).score, 100);
  }
  // Listas inválidas guardadas (repetidas o de otro catálogo) no cuentan como respondidas.
  for (const documentTypes of [["other", "other"], ["property_deed"]]) {
    assert.deepEqual(buildProjectRequestMetrics(standWith({ documentTypes })).completeness.missingFields, ["standRequirements.documentTypes"]);
  }
});

test("stand con preguntas opcionales sin responder: quedan incompletas sin deducciones nuevas", () => {
  const answers = {
    ...standWith({ documentTypes: [], hasSpacePlans: null, requirementsStatus: null }),
    decisionMaker: null, experience: null, projectSize: null, quality: null,
  };
  assert.deepEqual(buildProjectRequestMetrics(answers).completeness, {
    answered: 9,
    applicable: 15,
    missingFields: [
      "projectSize", "standRequirements.requirementsStatus", "standRequirements.hasSpacePlans",
      "decisionMaker", "quality", "experience",
    ],
    score: 60,
  });
  // Solo descuenta la causa vigente de tamaño sin definir (−15); el stand no añade causas.
  const compatibility = evaluateProjectCompatibility(answers);
  assert.equal(compatibility.score, 85);
  assert.deepEqual(compatibility.findings.map(({ code }) => code), ["PROJECT_SIZE_UNDEFINED"]);
  // Un bloque sin respuestas también cuenta cada pregunta aplicable como incompleta.
  assert.deepEqual(buildProjectRequestMetrics({ ...STAND, standRequirements: {} }).completeness.missingFields, [
    "standRequirements.requirementsStatus", "standRequirements.spaceStatus", "standRequirements.hasSpacePlans",
  ]);
});

test("stand con inicio inmediato: sin deducción de inmueble, aunque un borrador anterior la conserve guardada", () => {
  for (const landStatus of [null, "unavailable", "acquiring", "available"]) {
    const answers = { ...STAND, landStatus, legalDocumentationStatus: landStatus === "available" ? "unavailable" : null, hasPlans: false, startTime: "immediate" };
    const compatibility = evaluateProjectCompatibility(answers);
    assert.equal(compatibility.score, 100, String(landStatus));
    assert.deepEqual(compatibility.reasonCodes, [], String(landStatus));
  }
  // Control: la misma respuesta en un proyecto residencial conserva la regla del inmueble.
  const residential = evaluateProjectCompatibility({ ...RESIDENTIAL, startTime: "immediate" });
  assert.equal(residential.score, 80);
  assert.deepEqual(residential.reasonCodes, ["landUnavailableImmediate"]);
});

test("stand: las deducciones de capital y presupuesto siguen aplicándose", () => {
  const capital = evaluateProjectCompatibility({ ...STAND, capitalAvailability: "undefined", startTime: "immediate" });
  assert.equal(capital.score, 80);
  assert.deepEqual(capital.reasonCodes, ["capitalUndefinedImmediate"]);
  assert.equal(buildProjectRequestMetrics({ ...STAND, capitalAvailability: "undefined", startTime: "immediate" }).financialViability.status, "HIGH_RISK");

  const budget = { ...STAND, investmentRange: "under_10k", projectSize: "very_large_gt_500", quality: "premium" };
  assert.equal(evaluateProjectCompatibility(budget).score, 65);
  assert.equal(buildProjectRequestMetrics(budget).financialViability.status, "REVIEW_REQUIRED");

  const undefinedBudget = { ...STAND, investmentRange: "undefined", startTime: "1_3_months", capitalAvailability: "seeking_financing" };
  assert.deepEqual(
    evaluateProjectCompatibility(undefinedBudget).findings.map(({ code, deduction }) => [code, deduction]),
    [["FINANCIAL_DEFINITION_INSUFFICIENT", 15], ["CAPITAL_TIMING_MISMATCH", 8]],
  );
});

test("stand sin inmueble: la pregunta del terreno no entra en el numerador ni en el denominador", () => {
  const completeness = buildProjectRequestMetrics(STAND).completeness;
  assert.equal(completeness.applicable, 16);
  assert.ok(!completeness.missingFields.includes("landStatus"));
  // Un valor heredado de un borrador anterior tampoco cuenta.
  assert.deepEqual(buildProjectRequestMetrics({ ...STAND, landStatus: "acquiring" }).completeness, completeness);
});

test("residencial sin inmueble: conserva 13 preguntas y las reglas de inmueble frente al inicio", () => {
  for (const landStatus of ["unavailable", "acquiring"]) {
    assert.deepEqual(buildProjectRequestMetrics({ ...RESIDENTIAL, landStatus }).completeness, { answered: 13, applicable: 13, missingFields: [], score: 100 });
  }
  assert.equal(evaluateProjectCompatibility({ ...RESIDENTIAL, landStatus: "acquiring", startTime: "immediate" }).score, 90);
  assert.equal(evaluateProjectCompatibility({ ...RESIDENTIAL, startTime: "1_3_months" }).score, 90);
  assert.deepEqual(buildProjectRequestMetrics({ ...RESIDENTIAL, landStatus: null }).completeness.missingFields, ["landStatus"]);
});

test("residencial con inmueble: la sección legal participa con sus deducciones vigentes", () => {
  const withProperty = {
    ...RESIDENTIAL, hasMultipleOwners: false, hasPlans: false, landStatus: "available",
    legalDocumentationStatus: "in_process", legalDocumentTypes: [],
  };
  assert.equal(evaluateProjectCompatibility(withProperty).score, 95);
  assert.deepEqual(buildProjectRequestMetrics(withProperty).completeness, { answered: 16, applicable: 16, missingFields: [], score: 100 });
  const unavailable = { ...withProperty, legalDocumentationStatus: "unavailable", hasPlans: true };
  assert.equal(evaluateProjectCompatibility(unavailable).score, 94);
});

test("documentación legal no aplicable en un stand: datos guardados no se cuentan ni deducen", () => {
  const leftovers = {
    ...STAND, hasMultipleOwners: true, hasPlans: false, landStatus: "available",
    legalDocumentationStatus: "unavailable", legalDocumentTypes: ["property_deed"],
  };
  assert.deepEqual(buildProjectRequestMetrics(leftovers), buildProjectRequestMetrics(STAND));
  assert.equal(evaluateProjectCompatibility(leftovers).score, 100);
});

test("históricos: la compatibilidad 3.0 guardada conserva puntuación, nivel, versión y motivos", () => {
  // Un stand evaluado con 3.0 pudo recibir la deducción de inmueble; no se recalcula.
  const persisted = { level: "excellent", reasonCodes: ["landUnavailableImmediate"], score: 80, version: "3.0" };
  const record = { ...STAND, landStatus: "unavailable", startTime: "immediate", compatibility: persisted, id: 4, submissionId: "x" };
  const publicRequest = toPublicProjectRequest(record);
  assert.equal(publicRequest.compatibility.score, 80);
  assert.equal(publicRequest.compatibility.level, "excellent");
  assert.deepEqual(publicRequest.compatibility.findings.map(({ code }) => code), ["PROPERTY_TIMING_MISMATCH"]);
  assert.deepEqual(publicRequest.compatibility.observations, ["Se necesita definir el inmueble antes de iniciar de inmediato."]);
  assert.deepEqual(publicCompatibility(persisted), publicRequest.compatibility);
  assert.deepEqual(persisted, { level: "excellent", reasonCodes: ["landUnavailableImmediate"], score: 80, version: "3.0" });
  // La versión vigente usa el mismo catálogo de evidencias para reconstruir hallazgos.
  assert.deepEqual(publicCompatibility({ ...persisted, version: COMPATIBILITY_SCORING_VERSION }), publicRequest.compatibility);
});

test("históricos: un stand sin bloque guardado no recibe respuestas ficticias ni penalización", () => {
  const withoutSection = { ...STAND, standRequirements: null };
  assert.deepEqual(buildProjectRequestMetrics(withoutSection).completeness, { answered: 12, applicable: 12, missingFields: [], score: 100 });
  // El tipo retirado conserva su catálogo: inmueble aplicable y sin preguntas del stand.
  const legacy = { ...RESIDENTIAL, projectType: "stands_exhibitions" };
  assert.deepEqual(buildProjectRequestMetrics(legacy), buildProjectRequestMetrics(RESIDENTIAL));
  assert.deepEqual(evaluateProjectCompatibility({ ...legacy, startTime: "immediate" }), evaluateProjectCompatibility({ ...RESIDENTIAL, startTime: "immediate" }));
});

test("históricos: reenviar un borrador de stand con inmueble guardado evalúa con la versión vigente sin esa deducción", async (context) => {
  let evaluationValues;
  const row = {
    id: "9", client_id: "2", requested_by: "1", status: "changes_requested", project_name: STAND.projectName,
    project_type: "advertising_stand", stand_requirements: STAND.standRequirements, location: STAND.location,
    description: STAND.description, project_size: "small_lt_80", development_mode: "full", land_status: "unavailable",
    legal_documentation_status: null, legal_document_types: [], has_multiple_owners: null, has_plans: null,
    investment_range: "10k_50k", capital_availability: "available_now", expected_start_time: "immediate",
    decision_maker: "company_board", quality_expectation: "standard", prior_design_experience: "positive",
    reference_link: STAND.referenceLink, compatibility_score: null,
  };
  context.mock.method(pool, "query", async (sql, values) => {
    if (/existing_names/.test(sql)) return { rows: [] };
    if (/as file_count/.test(sql)) return { rows: [{ file_count: 1, total_bytes: "1024" }] };
    if (/with target as/.test(sql)) {
      evaluationValues = values;
      return { rows: [{ ...row, status: "pending_verification", compatibility_score: values[3], compatibility_level: values[4], compatibility_reason_codes: JSON.parse(values[5]), compatibility_scoring_version: values[6] }] };
    }
    return { rows: [{ ...row }] };
  });
  const result = await submitProjectRequest({ projectRequestId: 9, user: { id: 1, clientId: 2 } });
  assert.equal(evaluationValues[3], 100);
  assert.equal(evaluationValues[5], "[]");
  assert.equal(evaluationValues[6], COMPATIBILITY_SCORING_VERSION);
  assert.equal(result.compatibility.score, 100);
  assert.deepEqual(result.completeness, { answered: 16, applicable: 16, missingFields: [], score: 100 });
});

test("cola administrativa: la completitud del stand incluye sus preguntas sin exponer las respuestas internas", async (context) => {
  context.mock.method(pool, "query", async () => ({
    rows: [{
      id: "9", client_id: "2", requested_by: "1", status: "pending_review", project_name: STAND.projectName,
      project_type: "advertising_stand", stand_requirements: { requirementsStatus: "available", documentTypes: [], spaceStatus: "unassigned", hasSpacePlans: null },
      location: STAND.location, description: STAND.description, project_size: "small_lt_80", development_mode: "full",
      land_status: null, legal_document_types: [], investment_range: "10k_50k", capital_availability: "available_now",
      expected_start_time: "over_6_months", decision_maker: "self", quality_expectation: "standard",
      prior_design_experience: "first_time", compatibility_score: 100, compatibility_level: "excellent",
    }],
  }));
  const queue = await loadProjectRequestReviewQueue({ cursor: null, limit: 25, user: { id: 1, role: { code: "admin" } } });
  assert.deepEqual(queue.items[0].completeness, {
    answered: 14, applicable: 16, missingFields: ["standRequirements.documentTypes", "standRequirements.hasSpacePlans"], score: 88,
  });
  assert.equal("answers" in queue.items[0], false);
});

test("datos inválidos enviados directamente: stand con inmueble o sección legal, y otros tipos sin inmueble", () => {
  const cases = [
    [{ ...STAND_BODY, landStatus: "unavailable" }, "body.landStatus"],
    [{ ...STAND_BODY, landStatus: "available", legalDocumentationStatus: "available", legalDocumentTypes: ["property_deed"], hasMultipleOwners: false }, "body.landStatus"],
    [{ ...STAND_BODY, legalDocumentationStatus: "unavailable" }, "body.legalDocumentationStatus"],
    [{ ...STAND_BODY, hasMultipleOwners: true }, "body.hasMultipleOwners"],
    [{ ...STAND_BODY, hasBlueprints: false }, "body.hasBlueprints"],
    [{ ...STAND_BODY, legalDocumentTypes: ["lease_contract"] }, "body.legalDocumentTypes"],
    [{ ...STAND_BODY, standRequirements: { requirementsStatus: "in_process", documentTypes: ["other"], spaceStatus: "assigned" } }, "body.standRequirements.documentTypes"],
    [{ ...STAND_BODY, standRequirements: null }, "body.standRequirements.spaceStatus"],
    [{ ...STAND_BODY, projectType: "residential", standRequirements: null }, "body.landStatus"],
    [{ ...STAND_BODY, projectType: "commercial", standRequirements: null, landStatus: "rented" }, "body.landStatus"],
  ];
  for (const [body, field] of cases) {
    const error = validationError(updateProjectRequestSchema, { body, params: { projectRequestId: "9" } });
    assert.equal(error?.status, 400, field);
    assert.equal(error.code, "VALIDATION_ERROR", field);
    assert.ok(error.fields[field], `${field}: ${JSON.stringify(error.fields)}`);
    const created = createProjectRequestSchema.safeParse({ body: { ...body, submissionId: "550e8400-e29b-41d4-a716-446655440000" } });
    assert.equal(created.success, false, field);
  }
  assert.equal(validationError(updateProjectRequestSchema, { body: STAND_BODY, params: { projectRequestId: "9" } }), undefined);
});
