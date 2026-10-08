import assert from "node:assert/strict";
import test from "node:test";

import { PROJECT_REQUEST_VALUES } from "../src/domain/projectRequest.js";
import {
  detectCompatibilityEvidence,
  evaluateProjectCompatibility,
  publicCompatibility,
} from "../src/domain/projectRequestCompatibility.js";
import { evaluateProjectRequestCompleteness } from "../src/domain/projectRequestCompleteness.js";
import { buildProjectRequestMetrics } from "../src/domain/projectRequestEvaluation.js";
import {
  CAPITAL_TIMING_MATRIX,
  QUALITY_BUDGET_MATRIX,
  SCOPE_BUDGET_MATRIX,
} from "../src/domain/projectRequestFinancialMatrix.js";
import { evaluateFinancialViability } from "../src/domain/projectRequestFinancialViability.js";

// Solicitud coherente sin inmueble, con valores reales del dominio.
const COHERENT_REQUEST = {
  capitalAvailability: "available_now",
  decisionMaker: "self",
  description: "Remodelación integral de un local comercial.",
  developmentMode: "full",
  experience: "first_time",
  hasFiles: true,
  hasMultipleOwners: null,
  hasPlans: null,
  investmentRange: "10k_50k",
  landStatus: "unavailable",
  legalDocumentationStatus: null,
  legalDocumentTypes: [],
  location: "Caracas, Venezuela",
  projectName: "Local Centro",
  projectSize: "small_lt_80",
  projectType: "commercial",
  quality: "standard",
  referenceLink: "https://example.com/referencia",
  startTime: "3_6_months",
};

/**
 * Evalúa la coherencia financiera de la solicitud base con los cambios indicados.
 *
 * @param {object} values - Respuestas que sustituyen a las de la solicitud base.
 * @returns {{findings: Array<object>, score: null, status: string}} Evaluación financiera.
 */
function financialWith(values) {
  return evaluateFinancialViability({ ...COHERENT_REQUEST, ...values });
}

/**
 * Resume los hallazgos como pares [causa, efecto, evidencias] para comparar contra la matriz.
 *
 * @param {{findings: Array<object>}} evaluation - Evaluación financiera.
 * @returns {Array<Array<unknown>>} Resumen de hallazgos.
 */
function summary(evaluation) {
  return evaluation.findings.map(({ code, outcome, evidence }) => [code, outcome, evidence.map((item) => item.code)]);
}

test("1. small project with a low budget is not observed", () => {
  const result = financialWith({ investmentRange: "under_10k", quality: "functional_economic" });
  assert.deepEqual(result, { findings: [], score: null, status: "NO_OBVIOUS_CONFLICT" });
});

test("2. a large project with a high budget is not rewarded nor observed; score stays null", () => {
  for (const investmentRange of ["50k_150k", "over_150k"]) {
    const result = financialWith({ investmentRange, projectSize: "large_200_500" });
    assert.deepEqual(result, { findings: [], score: null, status: "NO_OBVIOUS_CONFLICT" }, investmentRange);
  }
  // Más presupuesto nunca cambia una celda sin conflicto.
  assert.deepEqual(financialWith({ investmentRange: "over_150k" }), financialWith({ investmentRange: "10k_50k" }));
});

test("3. a large project with a low budget requires review, not inviability", () => {
  const result = financialWith({ investmentRange: "under_10k", projectSize: "large_200_500" });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.score, null);
  assert.deepEqual(summary(result), [
    ["FINANCIAL_SCOPE_MISMATCH", "REVIEW_REQUIRED", ["largeBudgetUnder10k"]],
    ["BUDGET_COVERAGE_UNSPECIFIED", "INFORMATIVE", ["budgetCoverageUnspecified"]],
  ]);
});

test("4-5. without a design/execution option the budget coverage is reported as uncertain", () => {
  // El formulario no distingue diseño de ejecución: ninguna celda presupuesto–alcance es HIGH_RISK.
  for (const projectSize of ["medium_80_200", "large_200_500", "very_large_gt_500"]) {
    for (const developmentMode of ["phased", "full", "undecided"]) {
      const result = financialWith({ developmentMode, investmentRange: "under_10k", projectSize });
      assert.equal(result.status, "REVIEW_REQUIRED", `${projectSize}/${developmentMode}`);
    }
  }
  // Por fases, el presupuesto podría cubrir solo una etapa.
  const phased = financialWith({ developmentMode: "phased", investmentRange: "under_10k", projectSize: "large_200_500" });
  assert.deepEqual(phased.findings.at(-1).evidence.map(({ code }) => code), ["budgetMayCoverPhase"]);
});

test("6. luxury quality with a high budget is not observed only for the quality", () => {
  for (const investmentRange of ["50k_150k", "over_150k"]) {
    assert.equal(financialWith({ investmentRange, quality: "luxury" }).status, "NO_OBVIOUS_CONFLICT");
  }
});

test("7. luxury quality with a reduced budget asks for review using the full context", () => {
  const result = financialWith({ investmentRange: "under_10k", projectSize: "very_large_gt_500", quality: "luxury" });
  assert.equal(result.status, "REVIEW_REQUIRED");
  // Tamaño y calidad son evidencias de una sola causa: un único hallazgo.
  assert.deepEqual(summary(result)[0], [
    "FINANCIAL_SCOPE_MISMATCH",
    "REVIEW_REQUIRED",
    ["veryLargeBudgetUnder10k", "luxuryBudgetUnder10k"],
  ]);
  assert.equal(result.findings.filter(({ code }) => code === "FINANCIAL_SCOPE_MISMATCH").length, 1);
});

test("8. pending financing with an immediate start produces a temporal warning", () => {
  const result = financialWith({ capitalAvailability: "seeking_financing", startTime: "immediate" });
  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.deepEqual(summary(result), [["CAPITAL_TIMING_MISMATCH", "REVIEW_REQUIRED", ["financingImmediate"]]]);
  assert.equal(result.findings[0].category, "TEMPORAL");
});

test("9. pending financing with a flexible start is not observed", () => {
  for (const startTime of ["3_6_months", "over_6_months"]) {
    assert.equal(financialWith({ capitalAvailability: "seeking_financing", startTime }).status, "NO_OBVIOUS_CONFLICT");
  }
});

test("10. undefined capital never assumes solvency or insolvency", () => {
  const flexible = financialWith({ capitalAvailability: "undefined", startTime: "over_6_months" });
  assert.equal(flexible.status, "NO_OBVIOUS_CONFLICT");
  assert.deepEqual(summary(flexible), [["FINANCIAL_CAPITAL_UNCERTAIN", "INFORMATIVE", ["capitalAvailabilityUncertain"]]]);

  // Inicio inmediato sin capital definido: dependencia económica fuerte, no inviabilidad.
  const immediate = financialWith({ capitalAvailability: "undefined", startTime: "immediate" });
  assert.equal(immediate.status, "HIGH_RISK");
  assert.equal(immediate.score, null);

  // Capital declarado con inicio inmediato no genera advertencia por sí solo.
  assert.equal(financialWith({ capitalAvailability: "available_now", startTime: "immediate" }).status, "NO_OBVIOUS_CONFLICT");
});

test("11. missing data returns an explicit status", () => {
  const undefinedBudget = financialWith({ investmentRange: "undefined" });
  assert.equal(undefinedBudget.status, "INSUFFICIENT_DATA");
  assert.deepEqual(summary(undefinedBudget), [["FINANCIAL_DEFINITION_INSUFFICIENT", "INSUFFICIENT_DATA", ["investmentRangeUndefined"]]]);

  const noScope = financialWith({ projectSize: "unknown", quality: null });
  assert.equal(noScope.status, "INSUFFICIENT_DATA");
  assert.deepEqual(summary(noScope), [["FINANCIAL_SCOPE_UNDEFINED", "INSUFFICIENT_DATA", ["financialScopeUndefined"]]]);

  // Con una sola referencia de alcance sí se puede contrastar.
  assert.equal(financialWith({ projectSize: "unknown", quality: "premium", investmentRange: "under_10k" }).status, "REVIEW_REQUIRED");

  // Una revisión pesa más que los datos faltantes, y ambos quedan explicados.
  const mixed = financialWith({ capitalAvailability: "seeking_financing", investmentRange: "undefined", startTime: "immediate" });
  assert.equal(mixed.status, "REVIEW_REQUIRED");
  assert.deepEqual(mixed.findings.map(({ code }) => code), ["CAPITAL_TIMING_MISMATCH", "FINANCIAL_DEFINITION_INSUFFICIENT"]);

  assert.equal(evaluateFinancialViability(null).status, "INSUFFICIENT_DATA");
});

test("12. property and legal answers do not participate", () => {
  const withProperty = financialWith({
    hasMultipleOwners: true,
    hasPlans: false,
    landStatus: "available",
    legalDocumentationStatus: "unavailable",
  });
  assert.deepEqual(withProperty, financialWith({}));
  for (const projectType of PROJECT_REQUEST_VALUES.projectType) {
    assert.deepEqual(financialWith({ projectType }), financialWith({}), projectType);
  }
});

test("13. shared evidence is not deducted again: compatibility 3.0 keeps its score", () => {
  const request = { ...COHERENT_REQUEST, capitalAvailability: "undefined", investmentRange: "under_10k", projectSize: "very_large_gt_500", quality: "luxury", startTime: "immediate" };
  const before = evaluateProjectCompatibility(request);
  const financial = evaluateFinancialViability(request);
  const after = evaluateProjectCompatibility(request);
  assert.deepEqual(after, before);
  // −35 FINANCIAL_SCOPE_MISMATCH, −20 CAPITAL_TIMING_MISMATCH y −20 PROPERTY_TIMING_MISMATCH
  // (sin inmueble + inicio inmediato), una vez cada causa; la métrica financiera no añade nada.
  assert.equal(before.score, 25);
  assert.equal("deduction" in financial.findings[0], false);
  // Las causas compartidas usan el mismo código en ambas métricas.
  const compatibilityCauses = new Set(before.findings.map(({ code }) => code));
  for (const code of ["FINANCIAL_SCOPE_MISMATCH", "CAPITAL_TIMING_MISMATCH"]) {
    assert.ok(compatibilityCauses.has(code), code);
    assert.ok(financial.findings.some((finding) => finding.code === code), code);
  }
});

test("14. evidence of the same cause is grouped into one finding with the strongest outcome", () => {
  const result = financialWith({ investmentRange: "10k_50k", projectSize: "very_large_gt_500", quality: "luxury" });
  const scopeFindings = result.findings.filter(({ code }) => code === "FINANCIAL_SCOPE_MISMATCH");
  assert.equal(scopeFindings.length, 1);
  assert.deepEqual(scopeFindings[0].evidence.map(({ code }) => code), ["veryLargeBudget10k50k", "luxuryBudget10k50k"]);
  assert.equal(scopeFindings[0].severity, "HIGH");
  assert.equal(result.findings.filter(({ code }) => code === "BUDGET_COVERAGE_UNSPECIFIED").length, 1);
});

test("15. historical compatibility results keep their contract", () => {
  assert.deepEqual(
    publicCompatibility({ level: "high", reasonCodes: ["financingImmediate"], score: 70, version: "2.2" }),
    {
      findings: null,
      level: "high",
      observations: ["El financiamiento debe estar encaminado antes de plantear un inicio inmediato."],
      score: 70,
    },
  );
});

test("16. completeness does not change when the financial evaluation is computed", () => {
  for (const values of [{}, { investmentRange: "undefined" }, { capitalAvailability: "undefined", startTime: "immediate" }]) {
    const request = { ...COHERENT_REQUEST, ...values };
    const metrics = buildProjectRequestMetrics(request);
    assert.deepEqual(metrics.completeness, evaluateProjectRequestCompleteness(request));
    assert.equal(metrics.completeness.score, 100);
  }
});

test("matrix cells stay aligned with the evidence detected by compatibility 3.0", () => {
  // Recorre todas las combinaciones reales para que la matriz no diverja del motor.
  const matrixCodes = new Set();
  for (const matrix of [SCOPE_BUDGET_MATRIX, QUALITY_BUDGET_MATRIX, CAPITAL_TIMING_MATRIX]) {
    for (const row of Object.values(matrix)) {
      for (const cell of Object.values(row)) {
        if (cell && cell.outcome !== "INFORMATIVE") matrixCodes.add(cell.evidence);
      }
    }
  }
  assert.equal(matrixCodes.size, 12);

  for (const investmentRange of PROJECT_REQUEST_VALUES.investmentRange) {
    for (const projectSize of PROJECT_REQUEST_VALUES.projectSize) {
      for (const quality of [...PROJECT_REQUEST_VALUES.quality, null]) {
        for (const capitalAvailability of PROJECT_REQUEST_VALUES.capitalAvailability) {
          for (const startTime of PROJECT_REQUEST_VALUES.startTime) {
            const request = { ...COHERENT_REQUEST, capitalAvailability, investmentRange, projectSize, quality, startTime };
            const fromCompatibility = detectCompatibilityEvidence(request).filter((code) => matrixCodes.has(code)).sort();
            const fromMatrix = evaluateFinancialViability(request).findings
              .flatMap(({ evidence }) => evidence.map(({ code }) => code))
              .filter((code) => matrixCodes.has(code))
              .sort();
            assert.deepEqual(fromMatrix, fromCompatibility, JSON.stringify(request));
          }
        }
      }
    }
  }
});
