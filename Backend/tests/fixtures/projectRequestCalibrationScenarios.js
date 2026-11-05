/*
 * Escenarios de calibración de la fórmula 3.3 (fuente única).
 *
 * Los usan la prueba `projectRequestCalibrationV33.test.js` y el script
 * `scripts/generate-evaluation-scenarios-report.mjs`, que genera el informe de 30 escenarios.
 *
 * - `PDF_EXAMPLES`: ejemplos oficiales de la sección 9 de la «Propuesta de Algoritmo de
 *   Evaluación V3.3» (9 oct 2026).
 * - `CALIBRATION_SCENARIOS`: los 30 escenarios de `docs/ANALISIS_EVALUACION_SOLICITUDES_V33.md`
 *   (perfiles base de la sección 8 y cambios de la sección 10). Son calibración interna,
 *   pendiente de aprobación de la dirección; no son escenarios oficiales ni clientes reales.
 *
 * Cada entrada: [id, respuestas, causas esperadas {causa: deducción}, [respondidas, aplicables],
 * estado financiero esperado, avisos de planos esperados]. Los valores esperados se calcularon a
 * mano con las tablas del PDF y solo los usa la prueba; el informe muestra únicamente los
 * resultados del motor. Las respuestas que el perfil base no especifica (decisor, experiencia,
 * propietarios, modalidad) usan opciones que el PDF declara sin efecto (0).
 */

export const ARCHITECTURE_BASE = Object.freeze({
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
export const WITHOUT_PROPERTY = Object.freeze({ hasMultipleOwners: null, hasPlans: null, legalDocumentationStatus: null, legalDocumentTypes: [] });

export const STAND_BASE = Object.freeze({
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

export const architecture = (changes = {}) => ({ ...ARCHITECTURE_BASE, ...changes });
export const withoutProperty = (changes = {}) => architecture({ ...WITHOUT_PROPERTY, ...changes });
export const stand = (changes = {}, requirements = {}) => ({
  ...STAND_BASE,
  ...changes,
  standRequirements: { ...STAND_BASE.standRequirements, ...requirements },
});

export const NONE = "NO_OBVIOUS_CONFLICT";
export const REVIEW = "REVIEW_REQUIRED";
export const HIGH_RISK = "HIGH_RISK";
export const INSUFFICIENT = "INSUFFICIENT_DATA";

/*
 * Cada escenario: respuestas, causas esperadas con su deducción (PDF §6), información completada
 * (PDF §7: respondidas/aplicables), estado financiero (PDF §8) y avisos de planos (PDF §11).
 * La puntuación y la clasificación (PDF §10) se derivan de las causas esperadas.
 */
export const PDF_EXAMPLES = [
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

export const CALIBRATION_SCENARIOS = [
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

/*
 * Descripción de cada escenario interno para el informe: nombre breve y situación simulada.
 * Son casos ficticios diseñados para cubrir reglas, no solicitudes de clientes reales.
 */
export const SCENARIO_DESCRIPTIONS = Object.freeze({
  R01: ["Vivienda bien definida", "Familia con casa propia documentada y planos que desea una remodelación pequeña con presupuesto y capital listos, sin urgencia."],
  R02: ["Vivienda sin inmueble todavía", "Persona que planifica una casa mediana, aún sin terreno, con presupuesto amplio y sin prisa por empezar."],
  R03: ["Vivienda con alcance pendiente", "Propietario con inmueble disponible que no conoce el tamaño, no ha decidido la modalidad de desarrollo, no tiene planos ni aporta enlace de referencia."],
  R04: ["Vivienda con preguntas opcionales sin responder", "Propietario con documentación legal en trámite que deja sin responder planos, decisor, calidad y experiencia."],
  R05: ["Vivienda sin inmueble con inicio inmediato", "Persona sin terreno que quiere empezar de inmediato y dispone del capital."],
  R06: ["Vivienda en adquisición con financiamiento e inicio inmediato", "Persona que está comprando el inmueble, busca financiamiento y quiere empezar de inmediato."],
  R07: ["Vivienda grande y premium con poco presupuesto", "Cliente que desea una casa grande de calidad premium con menos de USD 10.000."],
  R08: ["Vivienda muy grande de lujo sin inversión ni capital definidos", "Cliente con un proyecto muy grande de lujo, sin rango de inversión ni capital definidos, que quiere empezar de inmediato."],
  C01: ["Local comercial bien definido", "Comerciante con local arrendado, proyecto mediano por fases, presupuesto amplio e inicio en 1–3 meses."],
  C02: ["Local muy grande con presupuesto mínimo", "Empresa que plantea un local de más de 500 m² con menos de USD 10.000, desarrollado por fases."],
  C03: ["Local de lujo con presupuesto medio", "Comercio que espera un acabado exclusivo con USD 10.000–50.000."],
  C04: ["Local con capital indefinido e inicio inmediato", "Comercio que quiere empezar de inmediato sin tener definida la disponibilidad del capital."],
  C05: ["Local con financiamiento y plazo flexible", "Comercio que busca financiamiento y prevé empezar en 3–6 meses."],
  C06: ["Local sin documentación legal y capital a tres meses", "Comercio con local disponible sin documentación ni planos, capital en tres meses e inicio inmediato."],
  K01: ["Oficina corporativa bien definida", "Empresa con decisión por junta, oficina grande premium, más de USD 150.000 e inicio en 3–6 meses."],
  K02: ["Oficina grande sin inversión definida", "Empresa con un proyecto grande que todavía no ha definido el rango de inversión."],
  K03: ["Oficina pequeña premium con poco presupuesto", "Empresa que espera calidad premium en un espacio pequeño con menos de USD 10.000."],
  K04: ["Oficina sin inmueble, tamaño desconocido y capital indefinido", "Empresa sin oficina todavía, sin conocer el tamaño, con capital indefinido e inicio en 1–3 meses."],
  K05: ["Oficina con múltiples contradicciones", "Empresa con inmueble sin documentación, tamaño desconocido, modalidad por definir, lujo con menos de USD 10.000, financiamiento e inicio inmediato."],
  K06: ["Oficina con datos opcionales pendientes", "Empresa con inmueble disponible que deja sin responder tamaño, calidad, decisor y experiencia, y no aporta enlace de referencia."],
  S01: ["Stand bien definido", "Expositor con espacio asignado y medidas, manual del expositor, stand pequeño y presupuesto definido."],
  S02: ["Stand asignado con medidas y tamaño desconocido", "Expositor que tiene el espacio asignado y sus medidas, pero marca el tamaño como desconocido."],
  S03: ["Stand asignado sin medidas", "Expositor con espacio asignado pero sin medidas y con tamaño desconocido."],
  S04: ["Stand con asignación y normas en trámite", "Expositor con espacio y normas en trámite que no responde si tiene medidas y desconoce el tamaño."],
  S05: ["Stand sin espacio ni normas e inicio inmediato", "Expositor sin espacio asignado ni normas, sin medidas, que quiere empezar de inmediato."],
  S06: ["Stand con normas sin documentos seleccionados", "Expositor con normas disponibles que no selecciona documentos ni responde si tiene medidas."],
  S07: ["Stand grande con poco presupuesto", "Expositor con un stand grande (200–500 m²) y menos de USD 10.000."],
  S08: ["Stand con capital indefinido e inicio inmediato", "Expositor que quiere empezar de inmediato sin capital definido."],
  S09: ["Stand premium sin inversión definida", "Expositor que espera calidad premium sin rango de inversión e inicio en 1–3 meses."],
  S10: ["Stand muy grande de lujo con presupuesto mínimo", "Expositor con stand muy grande de lujo, menos de USD 10.000, modalidad por definir, financiamiento e inicio inmediato."],
});
