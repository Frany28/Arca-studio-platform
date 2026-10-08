import { describeCompatibilityEvidence } from "./projectRequestCompatibility.js";
import {
  CAPITAL_TIMING_MATRIX,
  FINANCIAL_CONTEXT_ENTRIES,
  FINANCIAL_ONLY_EVIDENCE,
  FINANCIAL_OUTCOME_RANK,
  FINANCIAL_OUTCOMES,
  FINANCIAL_VIABILITY_STATUSES,
  QUALITY_BUDGET_MATRIX,
  SCOPE_BUDGET_MATRIX,
} from "./projectRequestFinancialMatrix.js";

export { FINANCIAL_VIABILITY_STATUSES } from "./projectRequestFinancialMatrix.js";

/*
 * Viabilidad financiera = coherencia económica observable entre las respuestas del cliente.
 *
 * No mide riqueza ni demuestra que el dinero alcance para ejecutar una obra: sin precios de
 * referencia ni conocer qué cubre el presupuesto, solo puede detectar combinaciones que
 * conviene aclarar. Por eso `score` es siempre null y el resultado es un estado:
 *
 * - NO_OBVIOUS_CONFLICT: sin contradicciones con las reglas disponibles (no es una aprobación).
 * - REVIEW_REQUIRED: una combinación debe aclararla un administrador.
 * - HIGH_RISK: señal fuerte de dependencia económica (no demuestra inviabilidad).
 * - INSUFFICIENT_DATA: faltan respuestas para contrastar presupuesto y alcance.
 *
 * No aplica deducciones: la compatibilidad 3.0 ya descuenta las mismas evidencias una vez
 * por causa, y esta métrica reutiliza sus códigos sin modificar ese score.
 */

const SEVERITY_RANK = { HIGH: 3, LOW: 1, MEDIUM: 2 };

const OUTCOME_TO_STATUS = Object.freeze({
  [FINANCIAL_OUTCOMES.HIGH_RISK]: FINANCIAL_VIABILITY_STATUSES.HIGH_RISK,
  [FINANCIAL_OUTCOMES.INFORMATIVE]: FINANCIAL_VIABILITY_STATUSES.NO_OBVIOUS_CONFLICT,
  [FINANCIAL_OUTCOMES.INSUFFICIENT_DATA]: FINANCIAL_VIABILITY_STATUSES.INSUFFICIENT_DATA,
  [FINANCIAL_OUTCOMES.REVIEW_REQUIRED]: FINANCIAL_VIABILITY_STATUSES.REVIEW_REQUIRED,
});

/**
 * Obtiene la entrada de una matriz para una fila y columna declaradas por el cliente.
 * Solo acepta claves propias de texto, para que una respuesta ausente nunca coincida con
 * la fila cuyo código es literalmente "undefined" (capital o inversión sin definir).
 *
 * @param {object} matrix - Matriz relativa.
 * @param {unknown} row - Opción de la fila.
 * @param {unknown} column - Opción de la columna.
 * @returns {{evidence: string, outcome: string}|null} Entrada o null si no aplica o no hay conflicto.
 */
function lookupCell(matrix, row, column) {
  if (typeof row !== "string" || typeof column !== "string") return null;
  if (!Object.hasOwn(matrix, row) || !Object.hasOwn(matrix[row], column)) return null;
  return matrix[row][column];
}

/**
 * Indica si la opción pertenece a las filas de una matriz y por lo tanto es comparable.
 * "No lo sé aún" y las respuestas vacías no lo son.
 *
 * @param {object} matrix - Matriz relativa.
 * @param {unknown} value - Opción declarada.
 * @returns {boolean} true cuando la opción tiene fila en la matriz.
 */
function isComparable(matrix, value) {
  return typeof value === "string" && Object.hasOwn(matrix, value);
}

/**
 * Reúne las entradas de la matriz que aplican a la relación entre presupuesto y alcance.
 * Sin rango definido o sin ninguna referencia de alcance (tamaño o calidad) devuelve una
 * entrada de datos insuficientes; ante un desajuste añade la incertidumbre sobre qué cubre.
 *
 * @param {object} answers - Respuestas de la solicitud.
 * @returns {Array<{evidence: string, outcome: string}>} Entradas detectadas.
 */
function collectBudgetEntries(answers) {
  const range = answers.investmentRange;
  const isDefinedRange = isComparable(SCOPE_BUDGET_MATRIX.small_lt_80, range);
  if (!isDefinedRange) return [FINANCIAL_CONTEXT_ENTRIES.investmentRangeUndefined];

  const hasScopeReference = isComparable(SCOPE_BUDGET_MATRIX, answers.projectSize)
    || isComparable(QUALITY_BUDGET_MATRIX, answers.quality);
  if (!hasScopeReference) return [FINANCIAL_CONTEXT_ENTRIES.financialScopeUndefined];

  const mismatches = [
    lookupCell(SCOPE_BUDGET_MATRIX, answers.projectSize, range),
    lookupCell(QUALITY_BUDGET_MATRIX, answers.quality, range),
  ].filter(Boolean);
  if (mismatches.length === 0) return [];

  const coverage = answers.developmentMode === "phased"
    ? FINANCIAL_CONTEXT_ENTRIES.budgetMayCoverPhase
    : FINANCIAL_CONTEXT_ENTRIES.budgetCoverageUnspecified;
  return [...mismatches, coverage];
}

/**
 * Describe una evidencia financiera con su causa, categoría, severidad y explicación.
 * Las evidencias compartidas salen del catálogo de compatibilidad; las propias, de la matriz.
 *
 * @param {string} code - Código de evidencia.
 * @returns {{category: string, cause: string, code: string, explanation: string, severity: string}} Evidencia.
 * @throws {Error} Cuando la matriz referencia un código inexistente (error de configuración).
 */
function describeFinancialEvidence(code) {
  const shared = describeCompatibilityEvidence(code);
  if (shared) return shared;
  const own = FINANCIAL_ONLY_EVIDENCE[code];
  if (!own) throw new Error(`Evidencia financiera desconocida: ${code}`);
  return { category: "FINANCIAL", code, ...own };
}

/**
 * Compara dos evidencias por efecto y severidad para elegir la más relevante.
 * Se usa para ordenar evidencias dentro de un hallazgo y hallazgos entre sí.
 *
 * @param {{outcome: string, severity: string}} left - Primer elemento.
 * @param {{outcome: string, severity: string}} right - Segundo elemento.
 * @returns {number} Valor negativo si `left` es más relevante.
 */
function byRelevance(left, right) {
  return FINANCIAL_OUTCOME_RANK[right.outcome] - FINANCIAL_OUTCOME_RANK[left.outcome]
    || SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity];
}

/**
 * Construye un hallazgo financiero a partir de las evidencias de una misma causa.
 * Ordena las evidencias por relevancia para que la explicación principal sea la más fuerte.
 *
 * @param {string} cause - Código de la causa.
 * @param {Array<{category: string, code: string, explanation: string, outcome: string, severity: string}>} group - Evidencias de la causa.
 * @returns {{category: string, code: string, evidence: Array<{code: string, explanation: string}>, explanation: string, outcome: string, severity: string}} Hallazgo.
 */
function toFinancialFinding(cause, group) {
  const ordered = [...group].sort(byRelevance);
  const [strongest] = ordered;
  return {
    category: strongest.category,
    code: cause,
    evidence: ordered.map(({ code, explanation }) => ({ code, explanation })),
    explanation: strongest.explanation,
    outcome: strongest.outcome,
    severity: ordered.reduce(
      (current, item) => (SEVERITY_RANK[item.severity] > SEVERITY_RANK[current] ? item.severity : current),
      "LOW",
    ),
  };
}

/**
 * Agrupa las entradas detectadas en hallazgos, uno por causa, como en compatibilidad 3.0.
 * El efecto y la severidad del hallazgo son los mayores de sus evidencias, y la explicación
 * es la de la evidencia más relevante. Las evidencias repetidas se registran una vez.
 *
 * @param {Array<{evidence: string, outcome: string}>} entries - Entradas de la matriz.
 * @returns {Array<{category: string, code: string, evidence: Array<{code: string, explanation: string}>, explanation: string, outcome: string, severity: string}>} Hallazgos ordenados.
 */
function groupFinancialFindings(entries) {
  const byCause = new Map();
  for (const { evidence: code, outcome } of entries) {
    const evidence = { ...describeFinancialEvidence(code), outcome };
    const group = byCause.get(evidence.cause) || [];
    if (!group.some((item) => item.code === code)) group.push(evidence);
    byCause.set(evidence.cause, group);
  }

  return [...byCause.entries()]
    .map(([cause, group]) => toFinancialFinding(cause, group))
    .sort(byRelevance);
}

/**
 * Evalúa la coherencia financiera observable de una solicitud con la matriz relativa.
 * Usa inversión, tamaño, calidad, modalidad, capital y plazo; no usa tipo, ubicación,
 * inmueble ni experiencia. Es pura, no persiste nada y no altera la compatibilidad.
 *
 * @param {object} answers - Registro de la solicitud con los nombres de campo del dominio.
 * @returns {{findings: Array<object>, score: null, status: string}} Evaluación financiera.
 */
export function evaluateFinancialViability(answers) {
  const source = answers || {};
  const entries = [
    ...collectBudgetEntries(source),
    lookupCell(CAPITAL_TIMING_MATRIX, source.capitalAvailability, source.startTime),
  ].filter(Boolean);
  const findings = groupFinancialFindings(entries);
  const outcome = findings[0]?.outcome || FINANCIAL_OUTCOMES.INFORMATIVE;

  return {
    findings,
    score: null,
    status: OUTCOME_TO_STATUS[outcome],
  };
}
