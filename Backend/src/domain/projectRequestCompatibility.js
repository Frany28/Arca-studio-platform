import { hasAvailableProperty } from "./projectRequest.js";

/*
 * Motor de compatibilidad de Solicitud de Proyecto (fórmula 3.0).
 *
 * Compatibilidad = 100 − Σ deducción de cada hallazgo, limitada a 0–100.
 *
 * - Una evidencia es una condición observable de las respuestas (p. ej. presupuesto no definido).
 * - Un hallazgo agrupa las evidencias de una misma causa y descuenta UNA sola vez: el valor
 *   máximo de sus evidencias. Así una misma causa no se castiga varias veces (D5).
 * - Las reglas del inmueble solo se evalúan con inmueble disponible: sin él son N/A y no
 *   suman ni restan (D1, D2, D3).
 * - Disponibilidad de capital, terreno, descripción, tipo y experiencia no suman puntos por
 *   sí mismos (D1, D4, D6). Los montos de inversión nunca suman.
 *
 * Los valores de deducción son los pesos existentes en v2.2; esta versión no introduce
 * cantidades nuevas. La severidad es semántica y se declara por evidencia.
 */

export const COMPATIBILITY_SCORING_VERSION = "3.0";

export const FINDING_CATEGORIES = Object.freeze({
  CONSISTENCY: "CONSISTENCY",
  FINANCIAL: "FINANCIAL",
  INFORMATION: "INFORMATION",
  LEGAL: "LEGAL",
  SCOPE: "SCOPE",
  TEMPORAL: "TEMPORAL",
});

export const FINDING_SEVERITIES = Object.freeze({
  HIGH: "HIGH",
  LOW: "LOW",
  MEDIUM: "MEDIUM",
});

const SEVERITY_RANK = { HIGH: 3, LOW: 1, MEDIUM: 2 };

// Causa → categoría. Cada causa produce como máximo un hallazgo y una deducción.
const FINDING_CAUSE_CATEGORIES = Object.freeze({
  BLUEPRINTS_UNAVAILABLE: FINDING_CATEGORIES.INFORMATION,
  CAPITAL_TIMING_MISMATCH: FINDING_CATEGORIES.TEMPORAL,
  EXECUTION_MODE_UNDEFINED: FINDING_CATEGORIES.SCOPE,
  FINANCIAL_DEFINITION_INSUFFICIENT: FINDING_CATEGORIES.FINANCIAL,
  FINANCIAL_SCOPE_MISMATCH: FINDING_CATEGORIES.FINANCIAL,
  LEGAL_DOCUMENTATION_PENDING: FINDING_CATEGORIES.LEGAL,
  PROJECT_SIZE_UNDEFINED: FINDING_CATEGORIES.SCOPE,
  PROPERTY_TIMING_MISMATCH: FINDING_CATEGORIES.TEMPORAL,
  REFERENCE_FILES_MISSING: FINDING_CATEGORIES.INFORMATION,
  REFERENCE_LINK_MISSING: FINDING_CATEGORIES.INFORMATION,
});

// Textos legibles por código de evidencia. Incluye códigos de versiones históricas
// (company*, extendedFamily*, descriptionWeak, largeBudget10k50k, referencesMissing*, sizeUnknown*) que
// 3.0 ya no genera, para seguir mostrando las observaciones guardadas.
export const COMPATIBILITY_OBSERVATIONS = {
  blueprintsUnavailable:
    "Disponer de planos del lugar agilizará el análisis del inmueble.",
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
  developmentModeUndefined:
    "Definir la modalidad de desarrollo ayudará a planificar el proyecto.",
  extendedFamilyImmediate:
    "Un inicio inmediato debe coordinarse con todas las personas que participan en la decisión.",
  financingImmediate:
    "El financiamiento debe estar encaminado antes de plantear un inicio inmediato.",
  financingSoon:
    "El financiamiento debe coordinarse con el plazo de inicio seleccionado.",
  investmentRangeUndefined:
    "Definir el rango de inversión permitirá evaluar la viabilidad del proyecto.",
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
  legalDocumentationInProcess:
    "La documentación legal del inmueble está en trámite y podrá revisarse más adelante.",
  legalDocumentationUnavailable:
    "Contar con documentación legal del inmueble facilitará el inicio del proyecto.",
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
  projectSizeUndefined:
    "Indicar el tamaño aproximado ayudará a estimar el alcance del proyecto.",
  referenceFilesMissing:
    "Adjuntar imágenes o archivos de referencia facilitará la evaluación del proyecto.",
  referenceLinkMissing:
    "Agregar un enlace de referencia ayudará a comprender el estilo buscado.",
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

const { HIGH, LOW, MEDIUM } = FINDING_SEVERITIES;

/*
 * Catálogo declarativo de evidencias. `when` compara cada hecho normalizado (ver
 * `toCompatibilityFacts`) con un valor exacto. El orden solo desempata evidencias con
 * la misma deducción dentro de una causa. `points` conserva el peso existente en v2.2.
 */
const COMPATIBILITY_EVIDENCE_RULES = Object.freeze([
  // SCOPE / INFORMATION: definición del alcance y material de referencia.
  { cause: "PROJECT_SIZE_UNDEFINED", code: "projectSizeUndefined", points: 15, severity: MEDIUM, when: { projectSize: "unknown" } },
  { cause: "EXECUTION_MODE_UNDEFINED", code: "developmentModeUndefined", points: 10, severity: MEDIUM, when: { developmentMode: "undecided" } },
  { cause: "EXECUTION_MODE_UNDEFINED", code: "modeUndefinedImmediate", points: 10, severity: MEDIUM, when: { developmentMode: "undecided", startTime: "immediate" } },
  { cause: "REFERENCE_FILES_MISSING", code: "referenceFilesMissing", points: 5, severity: LOW, when: { hasFiles: false } },
  { cause: "REFERENCE_LINK_MISSING", code: "referenceLinkMissing", points: 2, severity: LOW, when: { hasReferenceLink: false } },

  // LEGAL / INFORMATION: solo con inmueble disponible; en otro caso son N/A.
  { cause: "LEGAL_DOCUMENTATION_PENDING", code: "legalDocumentationUnavailable", points: 6, severity: LOW, when: { hasProperty: true, legalDocumentationStatus: "unavailable" } },
  { cause: "LEGAL_DOCUMENTATION_PENDING", code: "legalDocumentationInProcess", points: 3, severity: LOW, when: { hasProperty: true, legalDocumentationStatus: "in_process" } },
  { cause: "BLUEPRINTS_UNAVAILABLE", code: "blueprintsUnavailable", points: 2, severity: LOW, when: { hasPlans: false, hasProperty: true } },

  // FINANCIAL: inversión no definida. El faltante y sus agravantes son una sola causa.
  { cause: "FINANCIAL_DEFINITION_INSUFFICIENT", code: "investmentRangeUndefined", points: 15, severity: MEDIUM, when: { investmentRange: "undefined" } },
  { cause: "FINANCIAL_DEFINITION_INSUFFICIENT", code: "veryLargeBudgetUndefined", points: 20, severity: HIGH, when: { investmentRange: "undefined", projectSize: "very_large_gt_500" } },
  { cause: "FINANCIAL_DEFINITION_INSUFFICIENT", code: "luxuryBudgetUndefined", points: 20, severity: HIGH, when: { investmentRange: "undefined", quality: "luxury" } },
  { cause: "FINANCIAL_DEFINITION_INSUFFICIENT", code: "largeBudgetUndefined", points: 15, severity: MEDIUM, when: { investmentRange: "undefined", projectSize: "large_200_500" } },
  { cause: "FINANCIAL_DEFINITION_INSUFFICIENT", code: "premiumBudgetUndefined", points: 15, severity: MEDIUM, when: { investmentRange: "undefined", quality: "premium" } },
  { cause: "FINANCIAL_DEFINITION_INSUFFICIENT", code: "budgetUndefinedImmediate", points: 10, severity: MEDIUM, when: { investmentRange: "undefined", startTime: "immediate" } },
  { cause: "FINANCIAL_DEFINITION_INSUFFICIENT", code: "budgetUndefinedSoon", points: 5, severity: LOW, when: { investmentRange: "undefined", startTime: "1_3_months" } },

  // FINANCIAL: cruces de presupuesto y alcance que requieren revisión, sin probar insuficiencia.
  { cause: "FINANCIAL_SCOPE_MISMATCH", code: "veryLargeBudgetUnder10k", points: 35, severity: HIGH, when: { investmentRange: "under_10k", projectSize: "very_large_gt_500" } },
  { cause: "FINANCIAL_SCOPE_MISMATCH", code: "luxuryBudgetUnder10k", points: 30, severity: HIGH, when: { investmentRange: "under_10k", quality: "luxury" } },
  { cause: "FINANCIAL_SCOPE_MISMATCH", code: "largeBudgetUnder10k", points: 25, severity: HIGH, when: { investmentRange: "under_10k", projectSize: "large_200_500" } },
  { cause: "FINANCIAL_SCOPE_MISMATCH", code: "veryLargeBudget10k50k", points: 25, severity: HIGH, when: { investmentRange: "10k_50k", projectSize: "very_large_gt_500" } },
  { cause: "FINANCIAL_SCOPE_MISMATCH", code: "premiumBudgetUnder10k", points: 20, severity: HIGH, when: { investmentRange: "under_10k", quality: "premium" } },
  { cause: "FINANCIAL_SCOPE_MISMATCH", code: "luxuryBudget10k50k", points: 20, severity: HIGH, when: { investmentRange: "10k_50k", quality: "luxury" } },
  { cause: "FINANCIAL_SCOPE_MISMATCH", code: "mediumBudgetUnder10k", points: 10, severity: MEDIUM, when: { investmentRange: "under_10k", projectSize: "medium_80_200" } },

  // TEMPORAL: plazo de inicio frente a capital e inmueble. Sin cruce no hay deducción.
  { cause: "CAPITAL_TIMING_MISMATCH", code: "capitalUndefinedImmediate", points: 20, severity: HIGH, when: { capitalAvailability: "undefined", startTime: "immediate" } },
  { cause: "CAPITAL_TIMING_MISMATCH", code: "financingImmediate", points: 15, severity: MEDIUM, when: { capitalAvailability: "seeking_financing", startTime: "immediate" } },
  { cause: "CAPITAL_TIMING_MISMATCH", code: "capitalWithin3MonthsImmediate", points: 10, severity: MEDIUM, when: { capitalAvailability: "within_3_months", startTime: "immediate" } },
  { cause: "CAPITAL_TIMING_MISMATCH", code: "capitalUndefinedSoon", points: 10, severity: MEDIUM, when: { capitalAvailability: "undefined", startTime: "1_3_months" } },
  { cause: "CAPITAL_TIMING_MISMATCH", code: "financingSoon", points: 8, severity: LOW, when: { capitalAvailability: "seeking_financing", startTime: "1_3_months" } },
  { cause: "PROPERTY_TIMING_MISMATCH", code: "landUnavailableImmediate", points: 20, severity: HIGH, when: { landStatus: "unavailable", startTime: "immediate" } },
  { cause: "PROPERTY_TIMING_MISMATCH", code: "landAcquiringImmediate", points: 10, severity: MEDIUM, when: { landStatus: "acquiring", startTime: "immediate" } },
  { cause: "PROPERTY_TIMING_MISMATCH", code: "landUnavailableSoon", points: 10, severity: MEDIUM, when: { landStatus: "unavailable", startTime: "1_3_months" } },
].map((rule) => Object.freeze({ ...rule, when: Object.freeze(rule.when) })));

const EVIDENCE_BY_CODE = new Map(COMPATIBILITY_EVIDENCE_RULES.map((rule) => [rule.code, rule]));

/**
 * Describe una evidencia del catálogo de compatibilidad sin exponer su peso interno.
 * Permite que otras métricas (p. ej. la coherencia financiera) reutilicen la misma causa,
 * severidad y explicación sin duplicar el catálogo ni aplicar deducciones propias.
 *
 * @param {string} code - Código de evidencia.
 * @returns {{cause: string, category: string, code: string, explanation: string, severity: string}|null} Evidencia o null si no existe.
 */
export function describeCompatibilityEvidence(code) {
  const rule = EVIDENCE_BY_CODE.get(code);
  if (!rule) return null;
  return {
    category: FINDING_CAUSE_CATEGORIES[rule.cause],
    cause: rule.cause,
    code: rule.code,
    explanation: COMPATIBILITY_OBSERVATIONS[rule.code],
    severity: rule.severity,
  };
}

/**
 * Lista los códigos de evidencia que el motor 3.0 detecta para unas respuestas dadas.
 * Es la misma detección que usa `evaluateProjectCompatibility`; se expone para verificar
 * que otras matrices que referencian estas evidencias no diverjan del motor.
 *
 * @param {object} input - Respuestas de la solicitud con `hasFiles` calculado por el servidor.
 * @returns {Array<string>} Códigos de evidencia detectados, en el orden del catálogo.
 */
export function detectCompatibilityEvidence(input) {
  const facts = toCompatibilityFacts(input || {});
  return COMPATIBILITY_EVIDENCE_RULES
    .filter((rule) => ruleMatches(rule, facts))
    .map(({ code }) => code);
}

/**
 * Clasifica el nivel visible a partir de la puntuación de compatibilidad.
 * Los umbrales son compartidos por todas las versiones de la fórmula.
 *
 * @param {number} score - Puntuación de compatibilidad entre 0 y 100.
 * @returns {string} Código del nivel (`excellent`, `high`, `medium`, `low`, `poorly_defined`).
 */
export function compatibilityLevel(score) {
  if (score >= 80) return "excellent";
  if (score >= 60) return "high";
  if (score >= 40) return "medium";
  if (score >= 20) return "low";
  return "poorly_defined";
}

/**
 * Determina si el enlace de referencia es una URL http(s) válida dentro del límite.
 * Replica la regla del contrato para que el motor no dependa de la validación previa.
 *
 * @param {unknown} value - Enlace declarado por el cliente.
 * @returns {boolean} true cuando el enlace es utilizable como referencia.
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
 * Normaliza las respuestas guardadas en hechos comparables por el catálogo de evidencias.
 * Las opciones ausentes se tratan como "sin definir" y los datos del inmueble se anulan
 * cuando no hay inmueble disponible, de modo que sus reglas sean N/A aunque lleguen datos.
 *
 * @param {object} input - Registro de la solicitud con `hasFiles` calculado por el servidor.
 * @returns {object} Hechos normalizados usados por las reglas.
 */
function toCompatibilityFacts(input) {
  const hasProperty = hasAvailableProperty(input.landStatus);
  const hasLegalDocumentTypes = Array.isArray(input.legalDocumentTypes)
    && input.legalDocumentTypes.length > 0;
  let legalDocumentationStatus = null;
  if (hasProperty) {
    // Sin selección falta una declaración válida; seleccionar tipos no verifica documentos.
    legalDocumentationStatus = input.legalDocumentationStatus === "available" && !hasLegalDocumentTypes
      ? "unavailable"
      : input.legalDocumentationStatus ?? "unavailable";
  }
  return {
    capitalAvailability: input.capitalAvailability ?? "undefined",
    developmentMode: input.developmentMode ?? "undecided",
    hasFiles: input.hasFiles === true,
    hasPlans: hasProperty ? input.hasPlans === true : null,
    hasProperty,
    hasReferenceLink: isValidReferenceLink(input.referenceLink),
    investmentRange: input.investmentRange ?? "undefined",
    landStatus: input.landStatus ?? null,
    legalDocumentationStatus,
    projectSize: input.projectSize ?? "unknown",
    quality: input.quality ?? null,
    startTime: input.startTime ?? null,
  };
}

/**
 * Comprueba si todos los hechos exigidos por una regla coinciden con la solicitud.
 * La comparación es exacta para que cada evidencia sea trazable a sus respuestas.
 *
 * @param {{when: object}} rule - Regla del catálogo de evidencias.
 * @param {object} facts - Hechos normalizados de la solicitud.
 * @returns {boolean} true cuando la evidencia está presente.
 */
function ruleMatches(rule, facts) {
  return Object.entries(rule.when).every(([fact, expected]) => facts[fact] === expected);
}

/**
 * Agrupa códigos de evidencia en hallazgos, uno por causa, y calcula su deducción única.
 * La deducción y la severidad son las máximas de sus evidencias; la explicación es la de
 * la evidencia de mayor peso. Ignora códigos desconocidos (p. ej. de versiones históricas).
 *
 * @param {Array<string>} evidenceCodes - Códigos detectados o persistidos.
 * @returns {Array<{category: string, code: string, deduction: number, evidence: Array<{code: string, explanation: string}>, explanation: string, severity: string}>} Hallazgos ordenados por impacto.
 */
export function buildCompatibilityFindings(evidenceCodes) {
  const findingsByCause = new Map();
  for (const code of Array.isArray(evidenceCodes) ? evidenceCodes : []) {
    const rule = EVIDENCE_BY_CODE.get(code);
    if (!rule) continue;
    const finding = findingsByCause.get(rule.cause) || { rules: [] };
    if (!finding.rules.includes(rule)) finding.rules.push(rule);
    findingsByCause.set(rule.cause, finding);
  }

  return [...findingsByCause.entries()]
    .map(([cause, { rules }]) => toFinding(cause, rules))
    .sort((left, right) => right.deduction - left.deduction
      || SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity]);
}

/**
 * Construye un hallazgo consolidado a partir de las evidencias de una misma causa.
 * Ordena las evidencias por peso para que la explicación principal sea la más relevante.
 *
 * @param {string} cause - Código de la causa.
 * @param {Array<object>} rules - Evidencias detectadas de esa causa.
 * @returns {object} Hallazgo con categoría, severidad, deducción única y evidencias.
 */
function toFinding(cause, rules) {
  const evidence = [...rules].sort((left, right) => right.points - left.points);
  const strongest = evidence[0];
  return {
    category: FINDING_CAUSE_CATEGORIES[cause],
    code: cause,
    deduction: strongest.points,
    evidence: evidence.map(({ code }) => ({ code, explanation: COMPATIBILITY_OBSERVATIONS[code] })),
    explanation: COMPATIBILITY_OBSERVATIONS[strongest.code],
    severity: evidence.reduce(
      (current, rule) => (SEVERITY_RANK[rule.severity] > SEVERITY_RANK[current] ? rule.severity : current),
      LOW,
    ),
  };
}

/**
 * Evalúa la compatibilidad (claridad, preparación aplicable y coherencia) de una solicitud.
 * No suma por montos, capital, inmueble, descripción ni experiencia; las preguntas N/A no
 * cuentan. Devuelve todas las evidencias para persistirlas y los hallazgos consolidados.
 *
 * @param {object} input - Registro de la solicitud con `hasFiles` calculado por el servidor.
 * @returns {{findings: Array<object>, level: string, reasonCodes: Array<string>, score: number, version: string}} Evaluación 3.0.
 */
export function evaluateProjectCompatibility(input) {
  const findings = buildCompatibilityFindings(detectCompatibilityEvidence(input));
  const totalDeduction = findings.reduce((total, finding) => total + finding.deduction, 0);
  const score = Math.max(0, Math.min(100, 100 - totalDeduction));

  return {
    findings,
    level: compatibilityLevel(score),
    // Todas las evidencias, en el orden de impacto de sus hallazgos (D9).
    reasonCodes: findings.flatMap((finding) => finding.evidence.map(({ code }) => code)),
    score,
    version: COMPATIBILITY_SCORING_VERSION,
  };
}

/**
 * Proyecta un hallazgo al contrato público, sin exponer los pesos internos.
 * Los pesos no forman parte del contrato HTTP y pueden cambiar entre versiones.
 *
 * @param {object} finding - Hallazgo consolidado con su deducción interna.
 * @returns {{category: string, code: string, evidence: Array<object>, explanation: string, severity: string}} Hallazgo público.
 */
function toPublicFinding(finding) {
  const { deduction: _deduction, ...publicFinding } = finding;
  return publicFinding;
}

/**
 * Construye la compatibilidad pública a partir de la evaluación persistida.
 * En 3.0 reconstruye todos los hallazgos y muestra hasta tres observaciones (una por causa);
 * las versiones históricas conservan sus observaciones y no exponen hallazgos (`null`).
 *
 * @param {{level?: string, reasonCodes?: Array<string>, score?: number|null, version?: string}|null} evaluation - Evaluación guardada.
 * @returns {{findings: Array<object>|null, level: string, observations: Array<string>, score: number}|null} Compatibilidad pública o null.
 */
export function publicCompatibility(evaluation) {
  if (!evaluation || evaluation.score === null || evaluation.score === undefined) {
    return null;
  }

  const reasonCodes = evaluation.reasonCodes || [];
  if (evaluation.version !== COMPATIBILITY_SCORING_VERSION) {
    return {
      findings: null,
      level: evaluation.level,
      observations: reasonCodes
        .map((code) => COMPATIBILITY_OBSERVATIONS[code])
        .filter(Boolean)
        .slice(0, 3),
      score: Number(evaluation.score),
    };
  }

  const findings = buildCompatibilityFindings(reasonCodes).map(toPublicFinding);
  return {
    findings,
    level: evaluation.level,
    observations: findings.slice(0, 3).map(({ explanation }) => explanation),
    score: Number(evaluation.score),
  };
}
