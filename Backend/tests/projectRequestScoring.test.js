import assert from "node:assert/strict";
import test from "node:test";

import {
  compatibilityLevel,
  evaluateProjectCompatibility,
  publicCompatibility,
} from "../src/domain/projectRequestCompatibility.js";

// Solicitud con inmueble disponible, preparada y coherente.
const COMPLETE_PROJECT = {
  capitalAvailability: "available_now",
  decisionMaker: "self",
  description: "Proyecto residencial con remodelación integral, alcance definido y documentación legal disponible.",
  developmentMode: "full",
  experience: "first_time",
  hasFiles: true,
  hasMultipleOwners: false,
  hasPlans: true,
  investmentRange: "over_150k",
  landStatus: "available",
  legalDocumentationStatus: "available",
  legalDocumentTypes: ["property_deed"],
  location: "Caracas, Venezuela",
  projectName: "Apartamento Central",
  projectSize: "small_lt_80",
  projectType: "residential",
  quality: "standard",
  referenceLink: "https://example.com/referencia",
  startTime: "immediate",
};

// Misma solicitud sin inmueble: la sección legal no aplica y llega vacía, como exige el contrato.
const NO_PROPERTY_PROJECT = {
  ...COMPLETE_PROJECT,
  hasMultipleOwners: null,
  hasPlans: null,
  landStatus: "unavailable",
  legalDocumentationStatus: null,
  legalDocumentTypes: [],
  startTime: "over_6_months",
};

/**
 * Evalúa la solicitud completa con los cambios indicados y devuelve solo el score.
 *
 * @param {object} values - Respuestas que sustituyen a las de la solicitud completa.
 * @returns {number} Compatibilidad resultante.
 */
function scoreWith(values) {
  return evaluateProjectCompatibility({ ...COMPLETE_PROJECT, ...values }).score;
}

test("a complete, prepared and coherent request receives 100 points in version 3.2", () => {
  assert.deepEqual(evaluateProjectCompatibility(COMPLETE_PROJECT), {
    findings: [],
    level: "excellent",
    reasonCodes: [],
    score: 100,
    version: "3.2",
  });
});

test("caso A: a coherent request without property can reach 100 (D1, D2)", () => {
  // v2.2 limitaba este caso a 82: el inmueble sumaba 10 y la sección legal N/A contaba como 0.
  for (const landStatus of ["unavailable", "acquiring"]) {
    const result = evaluateProjectCompatibility({ ...NO_PROPERTY_PROJECT, landStatus });
    assert.equal(result.score, 100, landStatus);
    assert.deepEqual(result.findings, [], landStatus);
  }
});

test("caso B: with property the legal section participates without favoring document types", () => {
  assert.equal(scoreWith({ legalDocumentTypes: ["lease_contract"] }), 100);
  assert.equal(scoreWith({ legalDocumentTypes: ["property_deed", "purchase_contract", "other"] }), 100);
  assert.equal(scoreWith({ legalDocumentationStatus: "in_process", legalDocumentTypes: [] }), 97);
  assert.equal(scoreWith({ legalDocumentationStatus: "unavailable", legalDocumentTypes: [] }), 94);
  // Sin selección falta una declaración válida (el motor no depende de Zod, D3).
  assert.equal(scoreWith({ legalDocumentTypes: [] }), 94);
  assert.equal(scoreWith({ hasPlans: false }), 98);
  assert.equal(scoreWith({ hasPlans: null }), 98);

  const result = evaluateProjectCompatibility({
    ...COMPLETE_PROJECT,
    hasPlans: false,
    legalDocumentationStatus: "unavailable",
    legalDocumentTypes: [],
  });
  assert.deepEqual(
    result.findings.map(({ category, code, severity }) => ({ category, code, severity })),
    [
      { category: "LEGAL", code: "LEGAL_DOCUMENTATION_PENDING", severity: "LOW" },
      { category: "INFORMATION", code: "BLUEPRINTS_UNAVAILABLE", severity: "LOW" },
    ],
  );
});

test("caso C: higher budgets never add points", () => {
  const scores = ["under_10k", "10k_50k", "50k_150k", "over_150k"].map(
    (investmentRange) => scoreWith({ investmentRange }),
  );
  assert.deepEqual(scores, [100, 100, 100, 100]);
  assert.equal(scoreWith({ investmentRange: "over_150k", quality: "luxury" }), scoreWith({ investmentRange: "10k_50k" }));
});

test("caso D: seeking financing or any capital timing is not penalized by itself (D4)", () => {
  // v2.2 asignaba 25/20/10/0 según la disponibilidad del capital.
  for (const capitalAvailability of ["available_now", "within_3_months", "seeking_financing", "undefined"]) {
    assert.equal(scoreWith({ capitalAvailability, startTime: "3_6_months" }), 100, capitalAvailability);
    assert.equal(scoreWith({ capitalAvailability, startTime: "over_6_months" }), 100, capitalAvailability);
  }

  const immediate = evaluateProjectCompatibility({ ...COMPLETE_PROJECT, capitalAvailability: "seeking_financing" });
  assert.equal(immediate.score, 85);
  assert.deepEqual(immediate.findings.map(({ code }) => code), ["CAPITAL_TIMING_MISMATCH"]);
});

test("caso E: a fully answered but contradictory request loses compatibility", () => {
  const result = evaluateProjectCompatibility({
    ...NO_PROPERTY_PROJECT,
    capitalAvailability: "seeking_financing",
    decisionMaker: "company_board",
    investmentRange: "10k_50k",
    landStatus: "acquiring",
    projectSize: "very_large_gt_500",
    quality: "luxury",
    startTime: "immediate",
  });
  assert.equal(result.score, 50);
  assert.equal(result.level, "medium");
  assert.deepEqual(result.findings.map(({ code, deduction }) => [code, deduction]), [
    ["FINANCIAL_SCOPE_MISMATCH", 25],
    ["CAPITAL_TIMING_MISMATCH", 15],
    ["PROPERTY_TIMING_MISMATCH", 10],
  ]);
});

test("caso F: not-applicable legal data never changes the result", () => {
  const clean = evaluateProjectCompatibility(NO_PROPERTY_PROJECT);
  const withLeftovers = evaluateProjectCompatibility({
    ...NO_PROPERTY_PROJECT,
    hasPlans: false,
    legalDocumentationStatus: "unavailable",
  });
  assert.deepEqual(withLeftovers, clean);
});

test("caso G: description length does not change the score (D6)", () => {
  // v2.2 daba 10 puntos con 80+ caracteres y 4 entre 30 y 79.
  assert.equal(scoreWith({ description: "Remodelación de cocina pequeña." }), 100);
  assert.equal(scoreWith({ description: "x".repeat(100) }), 100);
  assert.equal(scoreWith({ description: null }), 100);
});

test("caso H: one financial cause produces a single consolidated deduction (D5)", () => {
  // v2.2 restaba 15 de base + 20 + 20 + 10 = 65 puntos por la misma inversión no definida.
  const undefinedBudget = evaluateProjectCompatibility({
    ...COMPLETE_PROJECT,
    investmentRange: "undefined",
    projectSize: "very_large_gt_500",
    quality: "luxury",
  });
  assert.equal(undefinedBudget.score, 80);
  assert.equal(undefinedBudget.findings.length, 1);
  const [finding] = undefinedBudget.findings;
  assert.equal(finding.code, "FINANCIAL_DEFINITION_INSUFFICIENT");
  assert.equal(finding.category, "FINANCIAL");
  assert.equal(finding.severity, "HIGH");
  assert.equal(finding.deduction, 20);
  assert.deepEqual(finding.evidence.map(({ code }) => code), [
    "veryLargeBudgetUndefined",
    "luxuryBudgetUndefined",
    "investmentRangeUndefined",
    "budgetUndefinedImmediate",
  ]);

  // v2.2 restaba 35 + 20 por la misma insuficiencia presupuestaria.
  const insufficientBudget = evaluateProjectCompatibility({
    ...COMPLETE_PROJECT,
    investmentRange: "under_10k",
    projectSize: "very_large_gt_500",
    quality: "premium",
  });
  assert.equal(insufficientBudget.score, 65);
  assert.deepEqual(insufficientBudget.findings.map(({ code }) => code), ["FINANCIAL_SCOPE_MISMATCH"]);
});

test("name, type, location, start time, experience, decision maker and owners add no points", () => {
  for (const values of [
    { projectName: null },
    { projectType: "stands_exhibitions" },
    { location: null },
    { startTime: "1_3_months" },
    { startTime: "3_6_months" },
    { startTime: "over_6_months" },
    { experience: "positive" },
    { experience: "negative" },
    { experience: null },
    { decisionMaker: "company_board" },
    { decisionMaker: null },
    { hasMultipleOwners: true },
  ]) {
    assert.equal(scoreWith(values), 100, JSON.stringify(values));
  }
});

test("every defined project size and development mode are treated equally", () => {
  for (const projectSize of ["small_lt_80", "medium_80_200", "large_200_500", "very_large_gt_500"]) {
    assert.equal(scoreWith({ projectSize }), 100, projectSize);
  }
  assert.equal(scoreWith({ developmentMode: "phased" }), 100);
});

test("undefined scope and budget lose only their definition weight once", () => {
  const cases = [
    [85, { projectSize: "unknown" }],
    [85, { projectSize: null }],
    [90, { developmentMode: "undecided", startTime: "3_6_months" }],
    // El cruce con inicio inmediato es la misma causa: no se resta dos veces.
    [90, { developmentMode: "undecided" }],
    [85, { investmentRange: "undefined", startTime: "3_6_months" }],
    [85, { investmentRange: "undefined" }],
  ];
  for (const [expectedScore, values] of cases) {
    assert.equal(scoreWith(values), expectedScore, JSON.stringify(values));
  }
});

test("3.2: files and reference links are optional material and never change the score", () => {
  for (const hasFiles of [true, false, undefined]) {
    for (const referenceLink of ["https://example.com/referencia", null, "", "javascript:alert(1)"]) {
      const evaluation = evaluateProjectCompatibility({ ...COMPLETE_PROJECT, hasFiles, referenceLink });
      assert.equal(evaluation.score, 100, `${hasFiles}/${referenceLink}`);
      assert.deepEqual(evaluation.reasonCodes, [], `${hasFiles}/${referenceLink}`);
    }
  }
});

// [evidencia, causa, score esperado, cambios]. Los valores de deducción son los aprobados en v2.2;
// solo cambia que cada causa descuenta una vez y que la base retirada (D1, D4, D6) ya no resta.
const COHERENCE_CASES = [
  ["mediumBudgetUnder10k", "FINANCIAL_SCOPE_MISMATCH", 90, { investmentRange: "under_10k", projectSize: "medium_80_200" }],
  ["largeBudgetUnder10k", "FINANCIAL_SCOPE_MISMATCH", 75, { investmentRange: "under_10k", projectSize: "large_200_500" }],
  ["veryLargeBudgetUnder10k", "FINANCIAL_SCOPE_MISMATCH", 65, { investmentRange: "under_10k", projectSize: "very_large_gt_500" }],
  ["veryLargeBudget10k50k", "FINANCIAL_SCOPE_MISMATCH", 75, { investmentRange: "10k_50k", projectSize: "very_large_gt_500" }],
  ["premiumBudgetUnder10k", "FINANCIAL_SCOPE_MISMATCH", 80, { investmentRange: "under_10k", quality: "premium" }],
  ["luxuryBudgetUnder10k", "FINANCIAL_SCOPE_MISMATCH", 70, { investmentRange: "under_10k", quality: "luxury" }],
  ["luxuryBudget10k50k", "FINANCIAL_SCOPE_MISMATCH", 80, { investmentRange: "10k_50k", quality: "luxury" }],
  ["largeBudgetUndefined", "FINANCIAL_DEFINITION_INSUFFICIENT", 85, { investmentRange: "undefined", projectSize: "large_200_500", startTime: "3_6_months" }],
  ["veryLargeBudgetUndefined", "FINANCIAL_DEFINITION_INSUFFICIENT", 80, { investmentRange: "undefined", projectSize: "very_large_gt_500", startTime: "3_6_months" }],
  ["premiumBudgetUndefined", "FINANCIAL_DEFINITION_INSUFFICIENT", 85, { investmentRange: "undefined", quality: "premium", startTime: "3_6_months" }],
  ["luxuryBudgetUndefined", "FINANCIAL_DEFINITION_INSUFFICIENT", 80, { investmentRange: "undefined", quality: "luxury", startTime: "3_6_months" }],
  ["budgetUndefinedImmediate", "FINANCIAL_DEFINITION_INSUFFICIENT", 85, { investmentRange: "undefined" }],
  ["budgetUndefinedSoon", "FINANCIAL_DEFINITION_INSUFFICIENT", 85, { investmentRange: "undefined", startTime: "1_3_months" }],
  ["landUnavailableImmediate", "PROPERTY_TIMING_MISMATCH", 80, { ...NO_PROPERTY_PROJECT, startTime: "immediate" }],
  ["landAcquiringImmediate", "PROPERTY_TIMING_MISMATCH", 90, { ...NO_PROPERTY_PROJECT, landStatus: "acquiring", startTime: "immediate" }],
  ["landUnavailableSoon", "PROPERTY_TIMING_MISMATCH", 90, { ...NO_PROPERTY_PROJECT, startTime: "1_3_months" }],
  ["capitalUndefinedImmediate", "CAPITAL_TIMING_MISMATCH", 80, { capitalAvailability: "undefined" }],
  ["financingImmediate", "CAPITAL_TIMING_MISMATCH", 85, { capitalAvailability: "seeking_financing" }],
  ["capitalWithin3MonthsImmediate", "CAPITAL_TIMING_MISMATCH", 90, { capitalAvailability: "within_3_months" }],
  ["capitalUndefinedSoon", "CAPITAL_TIMING_MISMATCH", 90, { capitalAvailability: "undefined", startTime: "1_3_months" }],
  ["financingSoon", "CAPITAL_TIMING_MISMATCH", 92, { capitalAvailability: "seeking_financing", startTime: "1_3_months" }],
  ["modeUndefinedImmediate", "EXECUTION_MODE_UNDEFINED", 90, { developmentMode: "undecided" }],
];

test("every coherence rule is detected, traced to its cause and deducted once", () => {
  for (const [evidenceCode, cause, expectedScore, values] of COHERENCE_CASES) {
    const evaluation = evaluateProjectCompatibility({ ...COMPLETE_PROJECT, ...values });
    assert.ok(evaluation.reasonCodes.includes(evidenceCode), evidenceCode);
    assert.ok(evaluation.findings.some((finding) => finding.code === cause), evidenceCode);
    assert.equal(evaluation.score, expectedScore, evidenceCode);
  }
});

test("quality only changes the score through budget coherence rules", () => {
  for (const quality of ["functional_economic", "standard", "premium", "luxury", null]) {
    assert.equal(scoreWith({ quality }), 100, String(quality));
  }
  assert.equal(scoreWith({ investmentRange: "under_10k", quality: "luxury" }), 70);
});

test("all evidence is kept even when more than three findings exist (D9)", () => {
  const result = evaluateProjectCompatibility({
    ...NO_PROPERTY_PROJECT,
    capitalAvailability: "undefined",
    developmentMode: "undecided",
    hasFiles: false,
    investmentRange: "under_10k",
    projectSize: "unknown",
    quality: "luxury",
    referenceLink: null,
    startTime: "immediate",
  });
  // 3.2: sin archivos ni enlace ya no restan; 20 + 10 + 30 + 15 + 20 = 95.
  assert.equal(result.score, 5);
  assert.equal(result.level, "poorly_defined");
  assert.equal(result.findings.length, 5);
  assert.equal(result.reasonCodes.length, 6);
  for (const finding of result.findings) {
    assert.ok(["LOW", "MEDIUM", "HIGH"].includes(finding.severity), finding.code);
    assert.ok(finding.explanation, finding.code);
  }

  const publicResult = publicCompatibility(result);
  assert.equal(publicResult.findings.length, 5);
  assert.equal(publicResult.observations.length, 3);
  assert.deepEqual(
    publicResult.observations,
    result.findings.slice(0, 3).map(({ explanation }) => explanation),
  );
});

test("public findings are rebuilt from persisted evidence without exposing weights", () => {
  const evaluation = evaluateProjectCompatibility({
    ...COMPLETE_PROJECT,
    capitalAvailability: "seeking_financing",
    investmentRange: "undefined",
    quality: "premium",
  });
  const persisted = {
    level: evaluation.level,
    reasonCodes: [...evaluation.reasonCodes],
    score: evaluation.score,
    version: evaluation.version,
  };
  const publicResult = publicCompatibility(persisted);

  assert.equal(publicResult.score, evaluation.score);
  assert.deepEqual(
    publicResult.findings,
    evaluation.findings.map(({ deduction: _deduction, ...finding }) => finding),
  );
  assert.ok(publicResult.findings.every((finding) => !("deduction" in finding)));
});

test("score thresholds use 80, 60, 40 and 20", () => {
  const cases = [
    [100, "excellent"],
    [80, "excellent"],
    [79, "high"],
    [60, "high"],
    [59, "medium"],
    [40, "medium"],
    [39, "low"],
    [20, "low"],
    [19, "poorly_defined"],
    [0, "poorly_defined"],
  ];
  for (const [score, level] of cases) {
    assert.equal(compatibilityLevel(score), level);
  }
});

test("public compatibility preserves historical results without recalculating them", () => {
  for (const version of ["1.0", "2.0", "2.1", "2.2"]) {
    assert.deepEqual(
      publicCompatibility({
        level: "low",
        reasonCodes: ["companyImmediate", "financingImmediate", "descriptionWeak", "landAcquiringImmediate"],
        score: 22,
        version,
      }),
      {
        findings: null,
        level: "low",
        observations: [
          "Un inicio inmediato debe coordinarse con el proceso de decisión de la empresa o junta.",
          "El financiamiento debe estar encaminado antes de plantear un inicio inmediato.",
          "Una descripción más completa ayudará a evaluar mejor el alcance del proyecto.",
        ],
        score: 22,
      },
    );
  }
  assert.equal(publicCompatibility(null), null);
  assert.equal(publicCompatibility({ score: null }), null);
});
