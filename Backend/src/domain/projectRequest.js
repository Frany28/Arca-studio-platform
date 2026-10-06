export const PROJECT_REQUEST_VALUES = {
  capitalAvailability: [
    "available_now",
    "within_3_months",
    "seeking_financing",
    "undefined",
  ],
  decisionMaker: ["self", "partner", "extended_family", "company_board"],
  developmentMode: ["phased", "full", "undecided"],
  experience: ["positive", "negative", "first_time"],
  investmentRange: [
    "undefined",
    "under_10k",
    "10k_50k",
    "50k_150k",
    "over_150k",
  ],
  landStatus: ["available", "acquiring", "unavailable"],
  legalDocumentationStatus: ["available", "in_process", "unavailable"],
  legalDocumentTypes: [
    "property_deed",
    "purchase_contract",
    "lease_contract",
    "other",
  ],
  projectSize: [
    "small_lt_80",
    "medium_80_200",
    "large_200_500",
    "very_large_gt_500",
    "unknown",
  ],
  projectType: [
    "residential",
    "commercial",
    "corporate",
    "stands_exhibitions",
  ],
  quality: ["functional_economic", "standard", "premium", "luxury"],
  startTime: ["immediate", "1_3_months", "3_6_months", "over_6_months"],
};

export const COMPATIBILITY_SCORING_VERSION = "2.2";

export const COMPATIBILITY_OBSERVATIONS = {
  budgetUndefinedImmediate:
    "Conviene definir el rango de inversión antes de iniciar de inmediato.",
  budgetUndefinedSoon:
    "Definir el rango de inversión ayudará a preparar el inicio en los próximos meses.",
  capitalUndefinedImmediate:
    "La disponibilidad de capital necesita aclararse para un inicio inmediato.",
  capitalUndefinedSoon:
    "La disponibilidad de capital necesita aclararse para iniciar en los próximos meses.",
  capitalWithin3MonthsImmediate:
    "La disponibilidad de capital en tres meses debe coordinarse con el inicio inmediato.",
  companyCapitalUndefined:
    "La decisión mediante empresa o junta requiere aclarar la disponibilidad de capital.",
  companyImmediate:
    "Un inicio inmediato debe coordinarse con el proceso de decisión de la empresa o junta.",
  descriptionWeak:
    "Una descripción más completa ayudará a evaluar mejor el alcance del proyecto.",
  extendedFamilyImmediate:
    "Un inicio inmediato debe coordinarse con todas las personas que participan en la decisión.",
  financingImmediate:
    "El financiamiento debe estar encaminado antes de plantear un inicio inmediato.",
  financingSoon:
    "El financiamiento debe coordinarse con el plazo de inicio seleccionado.",
  landAcquiringImmediate:
    "La adquisición del inmueble debe coordinarse con el inicio inmediato.",
  landUnavailableImmediate:
    "Se necesita definir el inmueble antes de iniciar de inmediato.",
  landUnavailableSoon:
    "Se necesita avanzar en la definición del inmueble antes del inicio previsto.",
  largeBudget10k50k:
    "El alcance y el rango de inversión del proyecto grande necesitan alinearse.",
  largeBudgetUnder10k:
    "El rango de inversión requiere revisión para el tamaño grande indicado.",
  largeBudgetUndefined:
    "Conviene definir la inversión para evaluar el alcance del proyecto grande.",
  luxuryBudget10k50k:
    "El nivel exclusivo o de lujo requiere revisar su coherencia con el rango de inversión.",
  luxuryBudgetUnder10k:
    "El nivel exclusivo o de lujo requiere revisar su coherencia con el rango de inversión.",
  luxuryBudgetUndefined:
    "Conviene definir la inversión para evaluar una expectativa exclusiva o de lujo.",
  mediumBudgetUnder10k:
    "El rango de inversión requiere revisión para el tamaño mediano indicado.",
  modeUndefinedImmediate:
    "Conviene definir la modalidad de desarrollo antes de iniciar de inmediato.",
  premiumBudgetUnder10k:
    "El nivel premium requiere revisar su coherencia con el rango de inversión.",
  premiumBudgetUndefined:
    "Conviene definir la inversión para evaluar una expectativa de calidad premium.",
  referencesMissingDescriptionWeak:
    "Agregar referencias o ampliar la descripción facilitará la evaluación del proyecto.",
  sizeUnknownBudgetUndefined:
    "Definir el tamaño o la inversión permitirá estimar mejor el alcance del proyecto.",
  veryLargeBudget10k50k:
    "El alcance y el rango de inversión del proyecto muy grande necesitan alinearse.",
  veryLargeBudgetUnder10k:
    "El rango de inversión requiere revisión para el tamaño muy grande indicado.",
  veryLargeBudgetUndefined:
    "Conviene definir la inversión para evaluar el alcance del proyecto muy grande.",
};

const BASE_SCORE = {
  capitalAvailability: {
    available_now: 25,
    within_3_months: 20,
    seeking_financing: 10,
    undefined: 0,
  },
  developmentMode: { phased: 10, full: 10, undecided: 0 },
  investmentRange: {
    undefined: 0,
    under_10k: 15,
    "10k_50k": 15,
    "50k_150k": 15,
    over_150k: 15,
  },
  landStatus: { available: 10, acquiring: 5, unavailable: 0 },
  projectSize: {
    small_lt_80: 15,
    medium_80_200: 15,
    large_200_500: 15,
    very_large_gt_500: 15,
    unknown: 0,
  },
};

/**
 * Indica si la solicitud declara un terreno o inmueble disponible para el proyecto.
 * Solo en ese caso se preguntan y persisten la situación legal, la documentación,
 * los propietarios y los planos del lugar.
 *
 * @param {string|null|undefined} landStatus - Respuesta sobre disponibilidad del terreno.
 * @returns {boolean} true cuando la respuesta es "available".
 */
export function hasAvailableProperty(landStatus) {
  return landStatus === "available";
}

/**
 * Clasifica el valor de nivel a partir de la puntuación calculada.
 * Mantiene esta regla de dominio aislada de HTTP y de la persistencia.
 *
 * @param {number} score - Valor de `score` requerido por esta operación.
 * @returns {string} Resultado producido por la operación.
 */
export function compatibilityLevel(score) {
  if (score >= 80) return "excellent";
  if (score >= 60) return "high";
  if (score >= 40) return "medium";
  if (score >= 20) return "low";
  return "poorly_defined";
}

/**
 * Procesa el valor de descripción puntuación para completar la responsabilidad asignada al módulo.
 * Mantiene esta regla de dominio aislada de HTTP y de la persistencia.
 *
 * @param {string} description - Valor de `description` requerido por esta operación.
 * @returns {number} Resultado producido por la operación.
 */
function descriptionScore(description) {
  const length = String(description || "").trim().length;
  if (length >= 80) return 10;
  if (length >= 30) return 4;
  return 0;
}

/**
 * Procesa el valor de legal documentation puntuación para completar la responsabilidad asignada al módulo.
 * Mantiene esta regla de dominio aislada de HTTP y de la persistencia.
 *
 * @param {unknown} payload - Datos validados necesarios para completar la operación.
 * @returns {number} Resultado producido por la operación.
 */
function legalDocumentationScore(payload) {
  if (
    payload.legalDocumentationStatus === "available"
    && Array.isArray(payload.legalDocumentTypes)
    && payload.legalDocumentTypes.length > 0
  ) {
    return 6;
  }
  return payload.legalDocumentationStatus === "in_process" ? 3 : 0;
}

/**
 * Determina si el valor de valid reference enlace cumple la condición esperada.
 * Mantiene esta regla de dominio aislada de HTTP y de la persistencia.
 *
 * @param {unknown} value - Valor de `value` requerido por esta operación.
 * @returns {boolean} Resultado producido por la operación.
 */
function isValidReferenceLink(value) {
  const link = String(value || "").trim();
  if (!link || link.length > 500) return false;
  try {
    const url = new URL(link);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Evalúa el valor de proyecto compatibility aplicando las reglas y ponderaciones del dominio.
 * Mantiene esta regla de dominio aislada de HTTP y de la persistencia.
 *
 * @param {unknown} payload - Datos validados necesarios para completar la operación.
 * @returns {object} Resultado producido por la operación.
 */
export function evaluateProjectCompatibility(payload) {
  const hasReferenceLink = isValidReferenceLink(payload.referenceLink);
  const hasFiles = payload.hasFiles === true;
  let score =
    descriptionScore(payload.description) +
    (BASE_SCORE.projectSize[payload.projectSize] || 0) +
    (BASE_SCORE.developmentMode[payload.developmentMode] || 0) +
    (BASE_SCORE.landStatus[payload.landStatus] || 0) +
    (BASE_SCORE.investmentRange[payload.investmentRange] || 0) +
    (BASE_SCORE.capitalAvailability[payload.capitalAvailability] || 0) +
    legalDocumentationScore(payload) +
    (payload.hasPlans === true ? 2 : 0) +
    (hasFiles ? 5 : 0) +
    (hasReferenceLink ? 2 : 0);
  const deductions = [];

    /**
   * Procesa el valor de deduct para completar la responsabilidad asignada al módulo.
   * Mantiene esta regla de dominio aislada de HTTP y de la persistencia.
   *
   * @param {string} code - Valor de `code` requerido por esta operación.
   * @param {unknown} points - Valor de `points` requerido por esta operación.
   * @returns {void} Finalización de la operación.
   */
const deduct = (code, points) => {
    deductions.push({ code, points });
    score -= points;
  };

  if (payload.investmentRange === "under_10k") {
    if (payload.projectSize === "medium_80_200") deduct("mediumBudgetUnder10k", 10);
    if (payload.projectSize === "large_200_500") deduct("largeBudgetUnder10k", 25);
    if (payload.projectSize === "very_large_gt_500") deduct("veryLargeBudgetUnder10k", 35);
    if (payload.quality === "premium") deduct("premiumBudgetUnder10k", 20);
    if (payload.quality === "luxury") deduct("luxuryBudgetUnder10k", 30);
  }

  if (payload.investmentRange === "10k_50k") {
    if (payload.projectSize === "very_large_gt_500") deduct("veryLargeBudget10k50k", 25);
    if (payload.quality === "luxury") deduct("luxuryBudget10k50k", 20);
  }

  if (payload.investmentRange === "undefined") {
    if (payload.projectSize === "large_200_500") deduct("largeBudgetUndefined", 15);
    if (payload.projectSize === "very_large_gt_500") deduct("veryLargeBudgetUndefined", 20);
    if (payload.quality === "premium") deduct("premiumBudgetUndefined", 15);
    if (payload.quality === "luxury") deduct("luxuryBudgetUndefined", 20);
  }

  if (payload.startTime === "immediate") {
    if (payload.landStatus === "unavailable") deduct("landUnavailableImmediate", 20);
    if (payload.landStatus === "acquiring") deduct("landAcquiringImmediate", 10);
    if (payload.capitalAvailability === "undefined") deduct("capitalUndefinedImmediate", 20);
    if (payload.capitalAvailability === "seeking_financing") deduct("financingImmediate", 15);
    if (payload.capitalAvailability === "within_3_months") {
      deduct("capitalWithin3MonthsImmediate", 10);
    }
    if (payload.investmentRange === "undefined") deduct("budgetUndefinedImmediate", 10);
    if (payload.developmentMode === "undecided") deduct("modeUndefinedImmediate", 10);
  }

  if (payload.startTime === "1_3_months") {
    if (payload.landStatus === "unavailable") deduct("landUnavailableSoon", 10);
    if (payload.capitalAvailability === "undefined") deduct("capitalUndefinedSoon", 10);
    if (payload.capitalAvailability === "seeking_financing") deduct("financingSoon", 8);
    if (payload.investmentRange === "undefined") deduct("budgetUndefinedSoon", 5);
  }

  const normalizedScore = Math.max(0, Math.min(100, score));
  const reasonCodes = deductions
    .sort((left, right) => right.points - left.points)
    .slice(0, 3)
    .map(({ code }) => code);

  return {
    level: compatibilityLevel(normalizedScore),
    reasonCodes,
    score: normalizedScore,
    version: COMPATIBILITY_SCORING_VERSION,
  };
}

/**
 * Procesa la evaluación pública de compatibilidad para completar la responsabilidad asignada al módulo.
 * Mantiene esta regla de dominio aislada de HTTP y de la persistencia.
 *
 * @param {unknown} evaluation - Valor de `evaluation` requerido por esta operación.
 * @returns {object} Resultado producido por la operación.
 */
export function publicCompatibility(evaluation) {
  if (!evaluation || evaluation.score === null || evaluation.score === undefined) {
    return null;
  }

  return {
    level: evaluation.level,
    observations: (evaluation.reasonCodes || [])
      .map((code) => COMPATIBILITY_OBSERVATIONS[code])
      .filter(Boolean)
      .slice(0, 3),
    score: Number(evaluation.score),
  };
}
