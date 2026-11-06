import assert from "node:assert/strict";
import test from "node:test";

import { evaluateProjectCompatibility } from "../src/domain/projectRequestCompatibility.js";
import { evaluateProjectRequestCompleteness } from "../src/domain/projectRequestCompleteness.js";
import { evaluateFinancialViability } from "../src/domain/projectRequestFinancialViability.js";
import { buildProjectRequestReviewObservations } from "../src/domain/projectRequestReviewObservations.js";
import {
  CALIBRATION_SCENARIOS,
  HIGH_RISK,
  INSUFFICIENT,
  NONE,
  PDF_EXAMPLES,
  REVIEW,
  stand,
  withoutProperty,
} from "./fixtures/projectRequestCalibrationScenarios.js";

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
 * Los escenarios se definen en `fixtures/projectRequestCalibrationScenarios.js` (fuente única,
 * compartida con el script del informe). Los valores esperados se calculan a mano con las tablas
 * del PDF (secciones 5 a 8), no se copian de la salida del motor: así la prueba detecta
 * divergencias entre el motor y el documento. Las respuestas que el perfil base no especifica
 * (decisor, experiencia, propietarios, modalidad) usan opciones que el PDF declara sin efecto (0)
 * en la compatibilidad y en la coherencia financiera.
 */

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
  const financialDeductions = ["FINANCIAL_DEFINITION_INSUFFICIENT", "FINANCIAL_SCOPE_MISMATCH", "CAPITAL_TIMING_MISMATCH"]
    .reduce((total, cause) => total + (causes[cause] || 0), 0);
  const hasScope = ["small_lt_80", "medium_80_200", "large_200_500", "very_large_gt_500"].includes(answers.projectSize) || answers.quality != null;
  assert.equal(financial.score, hasScope ? 100 - financialDeductions : null, `${id}: porcentaje financiero sin duplicar causas`);

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
