/**
 * Presentación de las métricas de evaluación de una solicitud que el backend calcula aparte
 * de la compatibilidad: información completada y coherencia financiera (viabilidad). Ninguna se deriva
 * del score de compatibilidad ni de su nivel.
 */

export const FINANCIAL_VIABILITY_PENDING_TEXT = "Pendiente de reglas de evaluación";
export const FINANCIAL_VIABILITY_UNAVAILABLE_TEXT = "Evaluación no disponible";

const COMPLETE_FILL_CLASS = "bg-[var(--color-success-200)]";
const INCOMPLETE_FILL_CLASS = "bg-[var(--color-warning-200)]";

/**
 * Normaliza la completitud devuelta por la API para una barra de progreso.
 * Solo distingue completa (100 %) de incompleta para el color; no inventa umbrales.
 * Devuelve null si la métrica falta o no es numérica, para mostrar un estado vacío.
 *
 * @param {{score?: number, answered?: number, applicable?: number}|null|undefined} completeness - Métrica de la API.
 * @returns {{score: number, answered: number, applicable: number, fillClassName: string}|null} Datos de presentación.
 */
export function getCompletenessPresentation(completeness) {
  const score = Number(completeness?.score);
  const answered = Number(completeness?.answered);
  const applicable = Number(completeness?.applicable);
  if (completeness?.score == null || ![score, answered, applicable].every(Number.isFinite)) return null;

  const normalizedScore = Math.round(Math.max(0, Math.min(100, score)));
  return {
    answered,
    applicable,
    fillClassName: normalizedScore === 100 ? COMPLETE_FILL_CLASS : INCOMPLETE_FILL_CLASS,
    score: normalizedScore,
  };
}

// Estados de la coherencia financiera del backend. NO_OBVIOUS_CONFLICT no es una aprobación:
// se presenta con tono neutral y una aclaración; ningún estado se representa como éxito.
const FINANCIAL_VIABILITY_STATUS_PRESENTATION = Object.freeze({
  HIGH_RISK: Object.freeze({ hint: "No demuestra que el proyecto sea inviable.", text: "Riesgo financiero elevado", toneClassName: "text-[var(--color-danger-100)]" }),
  INSUFFICIENT_DATA: Object.freeze({ hint: "", text: "Información financiera insuficiente", toneClassName: "" }),
  NO_OBVIOUS_CONFLICT: Object.freeze({ hint: "No equivale a una aprobación financiera.", text: "Sin incoherencias financieras detectadas", toneClassName: "" }),
  PENDING_RULES: Object.freeze({ hint: "", text: FINANCIAL_VIABILITY_PENDING_TEXT, toneClassName: "" }),
  REVIEW_REQUIRED: Object.freeze({ hint: "", text: "Requiere revisión financiera", toneClassName: "text-[var(--color-warning-100)]" }),
});

/**
 * Extrae los motivos legibles de los hallazgos financieros de la API.
 * Conserva el orden de relevancia del backend y descarta entradas sin explicación.
 *
 * @param {Array<{code?: string, explanation?: string, outcome?: string}>|undefined} findings - Hallazgos.
 * @returns {Array<{code: string, explanation: string, outcome: string}>} Motivos para la vista.
 */
function toFinancialReasons(findings) {
  if (!Array.isArray(findings)) return [];
  return findings
    .filter((finding) => finding?.code && finding?.explanation)
    .map(({ code, explanation, outcome }) => ({ code, explanation, outcome: outcome || "INFORMATIVE" }));
}

/**
 * Normaliza la viabilidad financiera devuelta por la API.
 * Sin score numérico devuelve el estado de coherencia con su texto, tono y motivos; nunca
 * un porcentaje. Un estado desconocido se muestra como evaluación no disponible.
 *
 * @param {{findings?: Array<object>, score?: number|null, status?: string}|null|undefined} financialViability - Métrica de la API.
 * @returns {{hint: string, reasons: Array<object>, score: number|null, status: string, text: string, toneClassName: string}|null} Datos de presentación o null si falta.
 */
export function getFinancialViabilityPresentation(financialViability) {
  if (!financialViability) return null;

  const reasons = toFinancialReasons(financialViability.findings);
  const score = Number(financialViability.score);
  if (financialViability.score != null && Number.isFinite(score)) {
    return {
      hint: "",
      reasons,
      score: Math.round(Math.max(0, Math.min(100, score))),
      status: financialViability.status || "EVALUATED",
      text: "",
      toneClassName: "",
    };
  }

  const presentation = FINANCIAL_VIABILITY_STATUS_PRESENTATION[financialViability.status];
  return {
    hint: presentation?.hint || "",
    reasons,
    score: null,
    status: financialViability.status || "UNKNOWN",
    text: presentation?.text || FINANCIAL_VIABILITY_UNAVAILABLE_TEXT,
    toneClassName: presentation?.toneClassName || "",
  };
}
