/*
 * Matriz relativa de coherencia financiera de Solicitud de Proyecto.
 *
 * Relaciona opciones reales del formulario sin precios absolutos ni operaciones entre niveles:
 * cada celda declara explícitamente su resultado. Las celdas con evidencia reutilizan los
 * códigos que la compatibilidad 3.0 ya aprobó como incoherentes; no crean deducciones.
 *
 * Límites deliberados:
 * - El formulario no indica si el presupuesto cubre solo diseño o también ejecución
 *   (`developmentMode` solo distingue por fases / en su totalidad / por definir). Por eso
 *   ninguna celda presupuesto–alcance o presupuesto–calidad supera `REVIEW_REQUIRED`.
 * - El tipo de proyecto no tiene diferenciación económica aprobada y no participa.
 * - "Disponible ahora" es una declaración del cliente, no una verificación de fondos.
 */

export const FINANCIAL_VIABILITY_STATUSES = Object.freeze({
  HIGH_RISK: "HIGH_RISK",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
  NO_OBVIOUS_CONFLICT: "NO_OBVIOUS_CONFLICT",
  // Reservado: reglas sin configurar o evaluaciones que no puedan calcularse.
  PENDING_RULES: "PENDING_RULES",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
});

// Efecto de una entrada de la matriz. INFORMATIVE explica contexto sin cambiar el estado.
export const FINANCIAL_OUTCOMES = Object.freeze({
  HIGH_RISK: "HIGH_RISK",
  INFORMATIVE: "INFORMATIVE",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
});

const { HIGH_RISK, INFORMATIVE, INSUFFICIENT_DATA, REVIEW_REQUIRED } = FINANCIAL_OUTCOMES;

// Rango de cada efecto para elegir el estado global (el mayor gana).
export const FINANCIAL_OUTCOME_RANK = Object.freeze({
  [HIGH_RISK]: 3,
  [INFORMATIVE]: 0,
  [INSUFFICIENT_DATA]: 1,
  [REVIEW_REQUIRED]: 2,
});

/**
 * Crea una entrada de matriz que vincula un efecto financiero con un código de evidencia.
 * La entrada es inmutable para que la matriz no pueda alterarse en tiempo de ejecución.
 *
 * @param {string} outcome - Efecto de `FINANCIAL_OUTCOMES`.
 * @param {string} evidence - Código de evidencia que justifica la celda.
 * @returns {{evidence: string, outcome: string}} Entrada de la matriz.
 */
function entry(outcome, evidence) {
  return Object.freeze({ evidence, outcome });
}

// Celda sin contradicción económica evidente con las reglas disponibles.
const NONE = null;

/*
 * Tamaño × inversión. Solo las cuatro combinaciones aprobadas en compatibilidad requieren
 * revisión; un presupuesto mayor nunca mejora una celda y un proyecto pequeño nunca se
 * observa por tener un presupuesto bajo. "No lo sé aún" no figura: no es comparable.
 */
export const SCOPE_BUDGET_MATRIX = Object.freeze({
  small_lt_80: Object.freeze({ under_10k: NONE, "10k_50k": NONE, "50k_150k": NONE, over_150k: NONE }),
  medium_80_200: Object.freeze({ under_10k: entry(REVIEW_REQUIRED, "mediumBudgetUnder10k"), "10k_50k": NONE, "50k_150k": NONE, over_150k: NONE }),
  large_200_500: Object.freeze({ under_10k: entry(REVIEW_REQUIRED, "largeBudgetUnder10k"), "10k_50k": NONE, "50k_150k": NONE, over_150k: NONE }),
  very_large_gt_500: Object.freeze({
    under_10k: entry(REVIEW_REQUIRED, "veryLargeBudgetUnder10k"),
    "10k_50k": entry(REVIEW_REQUIRED, "veryLargeBudget10k50k"),
    "50k_150k": NONE,
    over_150k: NONE,
  }),
});

/*
 * Calidad × inversión. La calidad elevada sola no se observa: solo las tres combinaciones
 * aprobadas con presupuesto reducido requieren revisión. Sin respuesta no es comparable.
 */
export const QUALITY_BUDGET_MATRIX = Object.freeze({
  functional_economic: Object.freeze({ under_10k: NONE, "10k_50k": NONE, "50k_150k": NONE, over_150k: NONE }),
  standard: Object.freeze({ under_10k: NONE, "10k_50k": NONE, "50k_150k": NONE, over_150k: NONE }),
  premium: Object.freeze({ under_10k: entry(REVIEW_REQUIRED, "premiumBudgetUnder10k"), "10k_50k": NONE, "50k_150k": NONE, over_150k: NONE }),
  luxury: Object.freeze({
    under_10k: entry(REVIEW_REQUIRED, "luxuryBudgetUnder10k"),
    "10k_50k": entry(REVIEW_REQUIRED, "luxuryBudget10k50k"),
    "50k_150k": NONE,
    over_150k: NONE,
  }),
});

/*
 * Disponibilidad del capital × plazo de inicio. Buscar financiamiento solo se observa con un
 * inicio inmediato o en 1–3 meses; con plazo flexible no se penaliza. El capital indefinido
 * con inicio inmediato es la única señal fuerte de dependencia económica (HIGH_RISK): no
 * depende de qué cubra el presupuesto. Con plazo flexible solo se informa la incertidumbre.
 */
export const CAPITAL_TIMING_MATRIX = Object.freeze({
  available_now: Object.freeze({ immediate: NONE, "1_3_months": NONE, "3_6_months": NONE, over_6_months: NONE }),
  within_3_months: Object.freeze({ immediate: entry(REVIEW_REQUIRED, "capitalWithin3MonthsImmediate"), "1_3_months": NONE, "3_6_months": NONE, over_6_months: NONE }),
  seeking_financing: Object.freeze({
    immediate: entry(REVIEW_REQUIRED, "financingImmediate"),
    "1_3_months": entry(REVIEW_REQUIRED, "financingSoon"),
    "3_6_months": NONE,
    over_6_months: NONE,
  }),
  undefined: Object.freeze({
    immediate: entry(HIGH_RISK, "capitalUndefinedImmediate"),
    "1_3_months": entry(REVIEW_REQUIRED, "capitalUndefinedSoon"),
    "3_6_months": entry(INFORMATIVE, "capitalAvailabilityUncertain"),
    over_6_months: entry(INFORMATIVE, "capitalAvailabilityUncertain"),
  }),
});

// Entradas que no dependen de una celda: datos faltantes y alcance del presupuesto.
export const FINANCIAL_CONTEXT_ENTRIES = Object.freeze({
  budgetCoverageUnspecified: entry(INFORMATIVE, "budgetCoverageUnspecified"),
  budgetMayCoverPhase: entry(INFORMATIVE, "budgetMayCoverPhase"),
  financialScopeUndefined: entry(INSUFFICIENT_DATA, "financialScopeUndefined"),
  investmentRangeUndefined: entry(INSUFFICIENT_DATA, "investmentRangeUndefined"),
});

// Evidencias propias de la coherencia financiera (las demás provienen de compatibilidad 3.0).
export const FINANCIAL_ONLY_EVIDENCE = Object.freeze({
  budgetCoverageUnspecified: Object.freeze({
    cause: "BUDGET_COVERAGE_UNSPECIFIED",
    explanation: "El formulario no indica si el presupuesto cubre solo el diseño o también la ejecución; conviene confirmarlo antes de concluir.",
    severity: "LOW",
  }),
  budgetMayCoverPhase: Object.freeze({
    cause: "BUDGET_COVERAGE_UNSPECIFIED",
    explanation: "El proyecto se desarrollará por fases: el presupuesto podría corresponder solo a una etapa; conviene confirmar su alcance.",
    severity: "LOW",
  }),
  capitalAvailabilityUncertain: Object.freeze({
    cause: "FINANCIAL_CAPITAL_UNCERTAIN",
    explanation: "La disponibilidad del capital no está definida; no se asume solvencia ni insolvencia.",
    severity: "LOW",
  }),
  financialScopeUndefined: Object.freeze({
    cause: "FINANCIAL_SCOPE_UNDEFINED",
    explanation: "Sin tamaño ni calidad esperada no es posible contrastar el presupuesto con el alcance del proyecto.",
    severity: "LOW",
  }),
});
