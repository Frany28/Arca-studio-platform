import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPATIBILITY_SCORING_VERSION,
  describeCompatibilityEvidence,
  detectCompatibilityEvidence,
  evaluateProjectCompatibility,
  publicCompatibility,
} from "../src/domain/projectRequestCompatibility.js";
import { evaluateProjectRequestCompleteness } from "../src/domain/projectRequestCompleteness.js";
import { evaluateFinancialViability } from "../src/domain/projectRequestFinancialViability.js";

process.env.DATABASE_URL ||= "postgres://localhost/arca-contract-test";
const { pool } = await import("../src/config/db.js");
const { submitProjectRequest, toPublicProjectRequest } = await import("../src/services/projectRequestService.js");

// Residencial sin inmueble, preparado y coherente, sin material de referencia.
const RESIDENTIAL = Object.freeze({
  capitalAvailability: "available_now", decisionMaker: "self",
  description: "Remodelación integral de cocina y sala principal.", developmentMode: "full",
  experience: "first_time", hasMultipleOwners: null, hasPlans: null, investmentRange: "10k_50k",
  landStatus: "unavailable", legalDocumentationStatus: null, legalDocumentTypes: [],
  location: "Caracas, Venezuela", projectName: "Cocina Norte", projectSize: "small_lt_80",
  projectType: "residential", quality: "standard", referenceLink: null, startTime: "over_6_months",
});
const WITH_PROPERTY = Object.freeze({
  ...RESIDENTIAL, hasMultipleOwners: false, hasPlans: true, landStatus: "available",
  legalDocumentationStatus: "available", legalDocumentTypes: ["property_deed"],
});
const STAND = Object.freeze({
  ...RESIDENTIAL, landStatus: null, projectType: "advertising_stand",
  standRequirements: Object.freeze({ documentTypes: ["exhibitor_manual"], hasSpacePlans: true, requirementsStatus: "available", spaceStatus: "assigned" }),
});
const REFERENCES = Object.freeze({ hasFiles: true, referenceLink: "https://example.test/referencia" });
const RETIRED_CODES = ["referenceFilesMissing", "referenceLinkMissing"];

test("versión: las evaluaciones nuevas se identifican como 3.2", () => {
  assert.equal(COMPATIBILITY_SCORING_VERSION, "3.2");
  assert.equal(evaluateProjectCompatibility(RESIDENTIAL).version, "3.2");
});

test("1–2. con o sin archivos y enlace la compatibilidad es la misma y no aparecen sus causas", () => {
  for (const base of [RESIDENTIAL, WITH_PROPERTY, STAND]) {
    const without = evaluateProjectCompatibility({ ...base, hasFiles: false, referenceLink: null });
    const withReferences = evaluateProjectCompatibility({ ...base, ...REFERENCES });
    assert.equal(without.score, 100, base.projectType);
    assert.deepEqual(without, withReferences, base.projectType);
    assert.ok(!without.findings.some(({ code }) => code.startsWith("REFERENCE_")));
  }
  // Un enlace inválido guardado tampoco resta.
  assert.equal(evaluateProjectCompatibility({ ...RESIDENTIAL, referenceLink: "javascript:alert(1)" }).score, 100);
});

test("las evidencias retiradas nunca se detectan en evaluaciones nuevas", () => {
  for (const hasFiles of [true, false, undefined]) {
    for (const referenceLink of [null, "", "https://example.test", "ftp://x"]) {
      for (const base of [RESIDENTIAL, WITH_PROPERTY, STAND]) {
        const codes = detectCompatibilityEvidence({ ...base, hasFiles, referenceLink });
        assert.ok(!codes.some((code) => RETIRED_CODES.includes(code)));
      }
    }
  }
  // Siguen descritas para leer las evaluaciones guardadas.
  assert.equal(describeCompatibilityEvidence("referenceFilesMissing").cause, "REFERENCE_FILES_MISSING");
  assert.equal(describeCompatibilityEvidence("referenceLinkMissing").category, "INFORMATION");
});

test("3. solicitud sin inmueble: 100 y 13/13; las reglas de inmueble frente al inicio se conservan", () => {
  assert.equal(evaluateProjectCompatibility(RESIDENTIAL).score, 100);
  assert.deepEqual(evaluateProjectRequestCompleteness(RESIDENTIAL), { answered: 13, applicable: 13, missingFields: [], score: 100 });
  assert.equal(evaluateProjectCompatibility({ ...RESIDENTIAL, startTime: "immediate" }).score, 80);
});

test("4. stand publicitario sin inmueble ni referencias: 100 y 16/16", () => {
  assert.equal(evaluateProjectCompatibility(STAND).score, 100);
  assert.deepEqual(evaluateProjectRequestCompleteness(STAND), { answered: 16, applicable: 16, missingFields: [], score: 100 });
});

test("5. stand con preguntas pendientes: baja la información completada, no la compatibilidad", () => {
  const pending = { ...STAND, standRequirements: { documentTypes: [], hasSpacePlans: null, requirementsStatus: "available", spaceStatus: "unassigned" } };
  assert.deepEqual(evaluateProjectRequestCompleteness(pending), {
    answered: 14, applicable: 16, missingFields: ["standRequirements.documentTypes", "standRequirements.hasSpacePlans"], score: 88,
  });
  assert.equal(evaluateProjectCompatibility(pending).score, 100);
});

test("6. tamaño sin definir conserva −15 en todos los tipos, sin respuesta o con «No lo sé aún»", () => {
  for (const base of [RESIDENTIAL, WITH_PROPERTY, STAND, { ...RESIDENTIAL, projectType: "commercial" }, { ...RESIDENTIAL, projectType: "corporate" }]) {
    for (const projectSize of ["unknown", null]) {
      const evaluation = evaluateProjectCompatibility({ ...base, projectSize });
      assert.equal(evaluation.score, 85, `${base.projectType}/${projectSize}`);
      assert.deepEqual(evaluation.findings.map(({ code }) => code), ["PROJECT_SIZE_UNDEFINED"]);
    }
  }
  // «No lo sé aún» cuenta como respondida; sin respuesta queda incompleta.
  assert.equal(evaluateProjectRequestCompleteness({ ...RESIDENTIAL, projectSize: "unknown" }).score, 100);
  assert.deepEqual(evaluateProjectRequestCompleteness({ ...RESIDENTIAL, projectSize: null }).missingFields, ["projectSize"]);
});

test("7. sin planos conserva −2 solo con inmueble aplicable y disponible", () => {
  for (const hasPlans of [false, null]) {
    const evaluation = evaluateProjectCompatibility({ ...WITH_PROPERTY, hasPlans });
    assert.equal(evaluation.score, 98, String(hasPlans));
    assert.deepEqual(evaluation.findings.map(({ code }) => code), ["BLUEPRINTS_UNAVAILABLE"]);
  }
  assert.equal(evaluateProjectCompatibility({ ...RESIDENTIAL, hasPlans: false }).score, 100);
  assert.equal(evaluateProjectCompatibility({ ...STAND, hasPlans: false }).score, 100);
});

test("8. varias evidencias de una misma causa descuentan una sola vez", () => {
  const scope = evaluateProjectCompatibility({ ...RESIDENTIAL, investmentRange: "under_10k", projectSize: "very_large_gt_500", quality: "luxury" });
  assert.equal(scope.score, 65);
  assert.deepEqual(scope.findings.map(({ code }) => code), ["FINANCIAL_SCOPE_MISMATCH"]);
  assert.deepEqual(scope.reasonCodes, ["veryLargeBudgetUnder10k", "luxuryBudgetUnder10k"]);

  const definition = evaluateProjectCompatibility({ ...STAND, investmentRange: "undefined", projectSize: "very_large_gt_500", startTime: "immediate" });
  assert.equal(definition.score, 80);
  assert.equal(definition.findings.length, 1);
  assert.equal(definition.reasonCodes.length, 3);
});

test("9. históricos 3.0 y 3.1 conservan puntuación, nivel y motivos de referencias retirados", () => {
  for (const version of ["3.0", "3.1"]) {
    const persisted = { level: "excellent", reasonCodes: ["referenceFilesMissing", "referenceLinkMissing"], score: 93, version };
    const publicResult = toPublicProjectRequest({ ...RESIDENTIAL, compatibility: persisted, id: 1, submissionId: "x" }).compatibility;
    assert.equal(publicResult.score, 93, version);
    assert.equal(publicResult.level, "excellent", version);
    assert.deepEqual(publicResult.findings.map(({ code, severity }) => [code, severity]), [
      ["REFERENCE_FILES_MISSING", "LOW"], ["REFERENCE_LINK_MISSING", "LOW"],
    ], version);
    assert.deepEqual(publicResult.observations, [
      "Adjuntar imágenes o archivos de referencia facilitará la evaluación del proyecto.",
      "Agregar un enlace de referencia ayudará a comprender el estilo buscado.",
    ], version);
    assert.ok(publicResult.findings.every((finding) => !("deduction" in finding)));
  }
  // Los motivos retirados conviven con los vigentes en el orden de impacto original.
  const mixed = publicCompatibility({ level: "high", reasonCodes: ["projectSizeUndefined", "referenceFilesMissing"], score: 80, version: "3.1" });
  assert.deepEqual(mixed.findings.map(({ code }) => code), ["PROJECT_SIZE_UNDEFINED", "REFERENCE_FILES_MISSING"]);
  assert.equal(mixed.score, 80);
});

test("10. la coherencia financiera no cambia con referencias ni con la nueva versión", () => {
  const scenarios = [
    [RESIDENTIAL, "NO_OBVIOUS_CONFLICT"],
    [{ ...RESIDENTIAL, capitalAvailability: "undefined", startTime: "immediate" }, "HIGH_RISK"],
    [{ ...RESIDENTIAL, investmentRange: "under_10k", projectSize: "large_200_500" }, "REVIEW_REQUIRED"],
    [{ ...RESIDENTIAL, investmentRange: "undefined" }, "INSUFFICIENT_DATA"],
    [STAND, "NO_OBVIOUS_CONFLICT"],
  ];
  for (const [answers, status] of scenarios) {
    const result = evaluateFinancialViability(answers);
    assert.equal(result.status, status);
    assert.equal(result.score, null);
    assert.deepEqual(evaluateFinancialViability({ ...answers, hasFiles: false, referenceLink: null }), result);
    assert.deepEqual(evaluateFinancialViability({ ...answers, ...REFERENCES }), result);
  }
});

test("11. información completada sin regresiones: referencias excluidas y conteos condicionales", () => {
  for (const base of [RESIDENTIAL, WITH_PROPERTY, STAND]) {
    assert.deepEqual(
      evaluateProjectRequestCompleteness({ ...base, hasFiles: false, referenceLink: null }),
      evaluateProjectRequestCompleteness({ ...base, ...REFERENCES }),
    );
  }
  const counts = [
    [RESIDENTIAL, 13],
    [{ ...WITH_PROPERTY, legalDocumentationStatus: "in_process", legalDocumentTypes: [] }, 16],
    [WITH_PROPERTY, 17],
    [{ ...STAND, standRequirements: { ...STAND.standRequirements, documentTypes: [], requirementsStatus: "unavailable" } }, 15],
    [STAND, 16],
  ];
  for (const [answers, applicable] of counts) assert.equal(evaluateProjectRequestCompleteness(answers).applicable, applicable);
});

test("envío: evalúa 3.2 sin consultar el uso de archivos ni restar por su ausencia", async (context) => {
  const statements = [];
  let evaluationValues;
  const row = {
    id: "5", client_id: "2", requested_by: "1", status: "draft", project_name: RESIDENTIAL.projectName,
    project_type: "residential", stand_requirements: null, location: RESIDENTIAL.location, description: RESIDENTIAL.description,
    project_size: "small_lt_80", development_mode: "full", land_status: "unavailable", legal_documentation_status: null,
    legal_document_types: [], has_multiple_owners: null, has_plans: null, investment_range: "10k_50k",
    capital_availability: "available_now", expected_start_time: "over_6_months", decision_maker: "self",
    quality_expectation: "standard", prior_design_experience: "first_time", reference_link: null, compatibility_score: null,
  };
  context.mock.method(pool, "query", async (sql, values) => {
    statements.push(sql);
    if (/existing_names/.test(sql)) return { rows: [] };
    if (/with target as/.test(sql)) {
      evaluationValues = values;
      return { rows: [{ ...row, status: "pending_verification", compatibility_score: values[3], compatibility_level: values[4], compatibility_reason_codes: JSON.parse(values[5]), compatibility_scoring_version: values[6] }] };
    }
    return { rows: [{ ...row }] };
  });
  const result = await submitProjectRequest({ projectRequestId: 5, user: { id: 1, clientId: 2 } });
  assert.ok(!statements.some((sql) => /as file_count/.test(sql)));
  assert.equal(evaluationValues[3], 100);
  assert.equal(evaluationValues[5], "[]");
  assert.equal(evaluationValues[6], "3.2");
  assert.deepEqual(result.compatibility, { findings: [], level: "excellent", observations: [], score: 100 });
});
