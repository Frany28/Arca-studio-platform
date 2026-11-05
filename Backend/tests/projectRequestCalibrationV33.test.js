import assert from "node:assert/strict";
import test from "node:test";

import { evaluateProjectCompatibility } from "../src/domain/projectRequestCompatibility.js";
import { evaluateProjectRequestCompleteness } from "../src/domain/projectRequestCompleteness.js";
import { evaluateFinancialViability } from "../src/domain/projectRequestFinancialViability.js";
import { buildProjectRequestReviewObservations } from "../src/domain/projectRequestReviewObservations.js";

/*
 * Calibración de la fórmula 3.3 frente a la «Propuesta de Algoritmo de Evaluación V3.3»
 * (9 oct 2026, aprobada por la dirección).
 *
 * - `PDF_EXAMPLES`: ejemplos oficiales de la sección 9 del PDF.
 * - `CALIBRATION_SCENARIOS`: los 30 escenarios de `docs/ANALISIS_EVALUACION_SOLICITUDES_V33.md`
 *   (perfiles base de la sección 8 y cambios de la sección 10). El PDF anuncia que los 30
 *   escenarios se incorporarán como anexo oficial cuando se ejecuten sobre el motor real; hasta
 *   entonces son calibración interna, no escenarios aprobados.
 *
 * Los valores esperados se calculan a mano con las tablas del PDF (secciones 5 a 8), no se copian
 * de la salida del motor: así la prueba detecta divergencias entre el motor y el documento. Las
 * respuestas que el perfil base no especifica (decisor, experiencia, propietarios, modalidad) usan
 * opciones que el PDF declara sin efecto (0) en la compatibilidad y en la coherencia financiera.
 */

const ARCHITECTURE_BASE = Object.freeze({
  capitalAvailability: "available_now",
  decisionMaker: "self",
  description: "Remodelación integral de la vivienda familiar con terraza.",
  developmentMode: "full",
  experience: "positive",
  hasMultipleOwners: false,
  hasPlans: true,
  investmentRange: "10k_50k",
  landStatus: "available",
  legalDocumentationStatus: "available",
  legalDocumentTypes: ["property_deed"],
  location: "Maracaibo, Estado Zulia",
  projectName: "Escenario de calibración",
  projectSize: "small_lt_80",
  projectType: "residential",
  quality: "standard",
  referenceLink: "https://es.pinterest.com/pin",
  standRequirements: null,
  startTime: "over_6_months",
});

// Sin inmueble disponible las preguntas legales y de planos son N/A y llegan vacías (contrato).
const WITHOUT_PROPERTY = Object.freeze({ hasMultipleOwners: null, hasPlans: null, legalDocumentationStatus: null, legalDocumentTypes: [] });

const STAND_BASE = Object.freeze({
  ...ARCHITECTURE_BASE,
  ...WITHOUT_PROPERTY,
  landStatus: null,
  projectType: "advertising_stand",
  standRequirements: Object.freeze({
    documentTypes: ["exhibitor_manual"],
    hasSpacePlans: true,
    requirementsStatus: "available",
    spaceStatus: "assigned",
  }),
});

const architecture = (changes = {}) => ({ ...ARCHITECTURE_BASE, ...changes });
const withoutProperty = (changes = {}) => architecture({ ...WITHOUT_PROPERTY, ...changes });
const stand = (changes = {}, requirements = {}) => ({
  ...STAND_BASE,
  ...changes,
  standRequirements: { ...STAND_BASE.standRequirements, ...requirements },
});

const NONE = "NO_OBVIOUS_CONFLICT";
const REVIEW = "REVIEW_REQUIRED";
const HIGH_RISK = "HIGH_RISK";
const INSUFFICIENT = "INSUFFICIENT_DATA";

/*
 * Cada escenario: respuestas, causas esperadas con su deducción (PDF §6), información completada
 * (PDF §7: respondidas/aplicables), estado financiero (PDF §8) y avisos de planos (PDF §11).
 * La puntuación y la clasificación (PDF §10) se derivan de las causas esperadas.
 */
const PDF_EXAMPLES = [
  ["§9 Solicitud coherente, inmueble disponible y tamaño definido", architecture(), {}, [17, 17], NONE],
  ["§9 Inmueble disponible sin planos", architecture({ hasPlans: false }), {}, [17, 17], NONE, ["propertyBlueprintsUnavailable"]],
  ["§9 Inmueble disponible y tamaño desconocido", architecture({ projectSize: "unknown" }), { PROJECT_SIZE_UNDEFINED: 15 }, [17, 17], NONE],
  ["§9 Inmueble aún no disponible, tamaño desconocido, inicio flexible", withoutProperty({ landStatus: "unavailable", projectSize: "unknown" }), {}, [13, 13], NONE],
  ["§9 Inmueble sin documentación legal", architecture({ legalDocumentationStatus: "unavailable", legalDocumentTypes: [] }), { LEGAL_DOCUMENTATION_PENDING: 6 }, [16, 16], NONE],
  ["§9 Modalidad «Por definir»", architecture({ developmentMode: "undecided" }), { EXECUTION_MODE_UNDEFINED: 10 }, [17, 17], NONE],
  ["§9 Grande con menos de $10,000 USD", architecture({ investmentRange: "under_10k", projectSize: "large_200_500" }), { FINANCIAL_SCOPE_MISMATCH: 25 }, [17, 17], REVIEW],
  ["§9 Muy grande y Premium con menos de $10,000 USD", architecture({ investmentRange: "under_10k", projectSize: "very_large_gt_500", quality: "premium" }), { FINANCIAL_SCOPE_MISMATCH: 35 }, [17, 17], REVIEW],
  ["§9 Capital indefinido e inicio inmediato", architecture({ capitalAvailability: "undefined", startTime: "immediate" }), { CAPITAL_TIMING_MISMATCH: 20 }, [17, 17], HIGH_RISK],
  ["§9 Stand sin espacio asignado, tamaño desconocido, inicio flexible", stand({ projectSize: "unknown" }, { hasSpacePlans: false, spaceStatus: "unassigned" }), {}, [16, 16], NONE],
  ["§9 Stand asignado, con medidas y tamaño desconocido", stand({ projectSize: "unknown" }), { PROJECT_SIZE_UNDEFINED: 15 }, [16, 16], NONE],
  ["§9 Sin archivos ni enlace", architecture({ referenceLink: null }), {}, [17, 17], NONE],
];

const CALIBRATION_SCENARIOS = [
  ["R01", architecture(), {}, [17, 17], NONE],
  ["R02", withoutProperty({ investmentRange: "50k_150k", landStatus: "unavailable", projectSize: "medium_80_200" }), {}, [13, 13], NONE],
  ["R03", architecture({ developmentMode: "undecided", hasPlans: false, projectSize: "unknown", referenceLink: null }), { EXECUTION_MODE_UNDEFINED: 10, PROJECT_SIZE_UNDEFINED: 15 }, [17, 17], NONE, ["propertyBlueprintsUnavailable"]],
  ["R04", architecture({ decisionMaker: null, experience: null, hasPlans: null, legalDocumentationStatus: "in_process", legalDocumentTypes: [], quality: null }), { LEGAL_DOCUMENTATION_PENDING: 3 }, [12, 16], NONE, ["propertyBlueprintsUnconfirmed"]],
  ["R05", withoutProperty({ landStatus: "unavailable", startTime: "immediate" }), { PROPERTY_TIMING_MISMATCH: 20 }, [13, 13], NONE],
  ["R06", withoutProperty({ capitalAvailability: "seeking_financing", landStatus: "acquiring", startTime: "immediate" }), { CAPITAL_TIMING_MISMATCH: 15, PROPERTY_TIMING_MISMATCH: 10 }, [13, 13], REVIEW],
  ["R07", architecture({ investmentRange: "under_10k", projectSize: "large_200_500", quality: "premium" }), { FINANCIAL_SCOPE_MISMATCH: 25 }, [17, 17], REVIEW],
  ["R08", architecture({ capitalAvailability: "undefined", investmentRange: "undefined", projectSize: "very_large_gt_500", quality: "luxury", startTime: "immediate" }), { CAPITAL_TIMING_MISMATCH: 20, FINANCIAL_DEFINITION_INSUFFICIENT: 20 }, [17, 17], HIGH_RISK],
  ["C01", architecture({ developmentMode: "phased", investmentRange: "50k_150k", legalDocumentTypes: ["lease_contract"], projectSize: "medium_80_200", projectType: "commercial", startTime: "1_3_months" }), {}, [17, 17], NONE],
  ["C02", architecture({ developmentMode: "phased", investmentRange: "under_10k", projectSize: "very_large_gt_500", projectType: "commercial" }), { FINANCIAL_SCOPE_MISMATCH: 35 }, [17, 17], REVIEW],
  ["C03", architecture({ projectType: "commercial", quality: "luxury" }), { FINANCIAL_SCOPE_MISMATCH: 20 }, [17, 17], REVIEW],
  ["C04", architecture({ capitalAvailability: "undefined", projectType: "commercial", startTime: "immediate" }), { CAPITAL_TIMING_MISMATCH: 20 }, [17, 17], HIGH_RISK],
  ["C05", architecture({ capitalAvailability: "seeking_financing", projectType: "commercial", startTime: "3_6_months" }), {}, [17, 17], NONE],
  ["C06", architecture({ capitalAvailability: "within_3_months", hasPlans: false, legalDocumentationStatus: "unavailable", legalDocumentTypes: [], projectType: "commercial", startTime: "immediate" }), { CAPITAL_TIMING_MISMATCH: 10, LEGAL_DOCUMENTATION_PENDING: 6 }, [16, 16], REVIEW, ["propertyBlueprintsUnavailable"]],
  ["K01", architecture({ decisionMaker: "company_board", investmentRange: "over_150k", projectSize: "large_200_500", projectType: "corporate", quality: "premium", startTime: "3_6_months" }), {}, [17, 17], NONE],
  ["K02", architecture({ investmentRange: "undefined", projectSize: "large_200_500", projectType: "corporate" }), { FINANCIAL_DEFINITION_INSUFFICIENT: 15 }, [17, 17], INSUFFICIENT],
  ["K03", architecture({ investmentRange: "under_10k", projectType: "corporate", quality: "premium" }), { FINANCIAL_SCOPE_MISMATCH: 20 }, [17, 17], REVIEW],
  ["K04", withoutProperty({ capitalAvailability: "undefined", landStatus: "unavailable", projectSize: "unknown", projectType: "corporate", startTime: "1_3_months" }), { CAPITAL_TIMING_MISMATCH: 10, PROPERTY_TIMING_MISMATCH: 10 }, [13, 13], REVIEW],
  ["K05", architecture({ capitalAvailability: "seeking_financing", developmentMode: "undecided", investmentRange: "under_10k", legalDocumentationStatus: "unavailable", legalDocumentTypes: [], projectSize: "unknown", projectType: "corporate", quality: "luxury", startTime: "immediate" }), { CAPITAL_TIMING_MISMATCH: 15, EXECUTION_MODE_UNDEFINED: 10, FINANCIAL_SCOPE_MISMATCH: 30, LEGAL_DOCUMENTATION_PENDING: 6, PROJECT_SIZE_UNDEFINED: 15 }, [16, 16], REVIEW],
  ["K06", architecture({ decisionMaker: null, experience: null, projectSize: null, projectType: "corporate", quality: null, referenceLink: null }), { PROJECT_SIZE_UNDEFINED: 15 }, [13, 17], INSUFFICIENT],
  ["S01", stand(), {}, [16, 16], NONE],
  ["S02", stand({ projectSize: "unknown" }), { PROJECT_SIZE_UNDEFINED: 15 }, [16, 16], NONE],
  ["S03", stand({ projectSize: "unknown" }, { hasSpacePlans: false }), {}, [16, 16], NONE],
  ["S04", stand({ projectSize: "unknown" }, { documentTypes: [], hasSpacePlans: null, requirementsStatus: "in_process", spaceStatus: "in_process" }), {}, [14, 15], NONE],
  ["S05", stand({ startTime: "immediate" }, { documentTypes: [], hasSpacePlans: false, requirementsStatus: "unavailable", spaceStatus: "unassigned" }), {}, [15, 15], NONE],
  ["S06", stand({}, { documentTypes: [], hasSpacePlans: null }), {}, [14, 16], NONE],
  ["S07", stand({ investmentRange: "under_10k", projectSize: "large_200_500" }), { FINANCIAL_SCOPE_MISMATCH: 25 }, [16, 16], REVIEW],
  ["S08", stand({ capitalAvailability: "undefined", startTime: "immediate" }), { CAPITAL_TIMING_MISMATCH: 20 }, [16, 16], HIGH_RISK],
  ["S09", stand({ investmentRange: "undefined", quality: "premium", startTime: "1_3_months" }), { FINANCIAL_DEFINITION_INSUFFICIENT: 15 }, [16, 16], INSUFFICIENT],
  ["S10", stand({ capitalAvailability: "seeking_financing", developmentMode: "undecided", investmentRange: "under_10k", projectSize: "very_large_gt_500", quality: "luxury", startTime: "immediate" }), { CAPITAL_TIMING_MISMATCH: 15, EXECUTION_MODE_UNDEFINED: 10, FINANCIAL_SCOPE_MISMATCH: 35 }, [16, 16], REVIEW],
];

/**
 * Clasificación vigente (PDF §10) para la puntuación esperada.
 *
 * @param {number} score - Puntuación de 0 a 100.
 * @returns {string} Código de nivel.
 */
function expectedLevel(score) {
  if (score >= 80) return "excellent";
  if (score >= 60) return "high";
  if (score >= 40) return "medium";
  if (score >= 20) return "low";
  return "poorly_defined";
}

/**
 * Comprueba las tres métricas y los avisos de un escenario contra los valores del PDF.
 *
 * @param {Array} scenario - [id, respuestas, causas, [respondidas, aplicables], estado financiero, avisos].
 * @returns {void}
 */
function assertScenario([id, answers, causes, [answered, applicable], financialStatus, observations = []]) {
  const compatibility = evaluateProjectCompatibility(answers);
  const expectedScore = Math.max(0, 100 - Object.values(causes).reduce((total, points) => total + points, 0));
  const deductions = Object.fromEntries(compatibility.findings.map(({ code, deduction }) => [code, deduction]));

  assert.equal(compatibility.version, "3.3", id);
  assert.deepEqual(deductions, causes, `${id}: una deducción por causa (PDF §3.1 y §6)`);
  assert.equal(compatibility.score, expectedScore, `${id}: 100 − Σ deducciones`);
  assert.equal(compatibility.level, expectedLevel(expectedScore), `${id}: clasificación (PDF §10)`);

  const completeness = evaluateProjectRequestCompleteness(answers);
  assert.deepEqual([completeness.answered, completeness.applicable], [answered, applicable], `${id}: información completada (PDF §7)`);
  assert.equal(completeness.score, Math.round((answered / applicable) * 100), `${id}: redondeo al entero`);

  const financial = evaluateFinancialViability(answers);
  assert.equal(financial.status, financialStatus, `${id}: coherencia financiera (PDF §8)`);
  assert.equal(financial.score, null, `${id}: la coherencia financiera no tiene porcentaje`);

  assert.deepEqual(buildProjectRequestReviewObservations(answers).map(({ code }) => code), observations, `${id}: avisos de planos (PDF §11)`);
}

for (const scenario of PDF_EXAMPLES) {
  test(`Propuesta V3.3 ${scenario[0]}`, () => assertScenario(scenario));
}

for (const scenario of CALIBRATION_SCENARIOS) {
  test(`Calibración interna ${scenario[0]} (pendiente de aprobación como anexo)`, () => assertScenario(scenario));
}

test("la calibración interna mantiene 30 escenarios con la distribución documentada", () => {
  const byPrefix = CALIBRATION_SCENARIOS.reduce((counts, [id]) => ({ ...counts, [id[0]]: (counts[id[0]] || 0) + 1 }), {});
  assert.equal(CALIBRATION_SCENARIOS.length, 30);
  assert.deepEqual(byPrefix, { C: 6, K: 6, R: 8, S: 10 });
  const causes = new Set(CALIBRATION_SCENARIOS.flatMap(([, , expected]) => Object.keys(expected)));
  assert.deepEqual([...causes].sort(), [
    "CAPITAL_TIMING_MISMATCH", "EXECUTION_MODE_UNDEFINED", "FINANCIAL_DEFINITION_INSUFFICIENT", "FINANCIAL_SCOPE_MISMATCH",
    "LEGAL_DOCUMENTATION_PENDING", "PROJECT_SIZE_UNDEFINED", "PROPERTY_TIMING_MISMATCH",
  ], "cubre las siete causas activas del PDF §6");
  assert.deepEqual(new Set(CALIBRATION_SCENARIOS.map(([, , , , status]) => status)), new Set([NONE, REVIEW, HIGH_RISK, INSUFFICIENT]));
});

test("stand histórico sin requisitos guardados: 15 aplicables, 3 pendientes del stand y compatibilidad persistida intacta (PDF §7 y §11)", () => {
  const persisted = { level: "high", reasonCodes: ["landUnavailableImmediate"], score: 80, version: "3.3" };
  const legacy = { ...withoutProperty({ landStatus: "unavailable", projectType: "stands_exhibitions", startTime: "immediate" }), compatibility: persisted };
  const completeness = evaluateProjectRequestCompleteness(legacy);
  assert.deepEqual(completeness, {
    answered: 12,
    applicable: 15,
    missingFields: ["standRequirements.requirementsStatus", "standRequirements.spaceStatus", "standRequirements.hasSpacePlans"],
    score: 80,
  });
  // Leer las métricas no recalcula ni modifica la evaluación guardada.
  assert.deepEqual(legacy.compatibility, { level: "high", reasonCodes: ["landUnavailableImmediate"], score: 80, version: "3.3" });
});

test("el identificador histórico «Stands y exhibiciones» se evalúa como Stand publicitario (PDF §11)", () => {
  const legacy = withoutProperty({ landStatus: "unavailable", projectSize: "unknown", projectType: "stands_exhibitions", startTime: "immediate" });
  const current = stand({ projectSize: "unknown", startTime: "immediate" }, { documentTypes: [], hasSpacePlans: false, requirementsStatus: "unavailable", spaceStatus: "unassigned" });
  // H01/H02 del análisis: el registro histórico no hereda el cruce de inmueble frente al inicio.
  assert.deepEqual(evaluateProjectCompatibility(legacy), evaluateProjectCompatibility(current));
  assert.equal(evaluateProjectCompatibility(legacy).score, 100);
  assert.equal(evaluateFinancialViability(legacy).status, evaluateFinancialViability(current).status);
});
