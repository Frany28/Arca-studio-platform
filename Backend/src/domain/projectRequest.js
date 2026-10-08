import { ADVERTISING_STAND_PROJECT_TYPE, isAdvertisingStand } from "./projectRequestStand.js";

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
    ADVERTISING_STAND_PROJECT_TYPE,
  ],
  quality: ["functional_economic", "standard", "premium", "luxury"],
  startTime: ["immediate", "1_3_months", "3_6_months", "over_6_months"],
};

// Los tipos retirados solo se conservan para leer métricas y editar registros existentes.
export const LEGACY_PROJECT_REQUEST_TYPES = Object.freeze(["stands_exhibitions"]);
export const READABLE_PROJECT_REQUEST_TYPES = Object.freeze([
  ...PROJECT_REQUEST_VALUES.projectType,
  ...LEGACY_PROJECT_REQUEST_TYPES,
]);

/**
 * Permite los tipos vigentes o conservar el tipo retirado de una solicitud existente.
 * Evita crear solicitudes históricas o asignar ese tipo a otro registro; no convierte datos.
 *
 * @param {string} projectType - Tipo recibido para la solicitud.
 * @param {string|null} [previousType=null] - Tipo guardado en el registro autorizado.
 * @returns {boolean} true cuando puede guardarse sin reintroducir una opción retirada.
 */
export function isAllowedProjectRequestType(projectType, previousType = null) {
  return PROJECT_REQUEST_VALUES.projectType.includes(projectType)
    || (LEGACY_PROJECT_REQUEST_TYPES.includes(projectType) && projectType === previousType);
}

// Límites de texto compartidos por el contrato Zod y por la métrica de completitud.
export const PROJECT_REQUEST_TEXT_LIMITS = Object.freeze({
  description: Object.freeze({ max: 100, min: 30 }),
  projectLocation: Object.freeze({ max: 255, min: 5 }),
  projectName: Object.freeze({ max: 150, min: 3 }),
});

/**
 * Indica si la respuesta de terreno o inmueble declara disponibilidad.
 * Solo evalúa la respuesta; la aplicabilidad según el tipo de proyecto la decide
 * `hasApplicableProperty`, que es la regla que deben usar contrato y métricas.
 *
 * @param {string|null|undefined} landStatus - Respuesta sobre disponibilidad del terreno.
 * @returns {boolean} true cuando la respuesta es "available".
 */
export function hasAvailableProperty(landStatus) {
  return landStatus === "available";
}

/**
 * Indica si la pregunta «¿Tiene terreno o inmueble disponible?» aplica al tipo de proyecto.
 * Un Stand publicitario se monta en el espacio que asigna un evento, no en un inmueble del
 * cliente: para él la pregunta y toda la sección legal son N/A y el espacio se declara en
 * los requisitos del stand. Los tipos históricos conservan la pregunta.
 *
 * @param {string|null|undefined} projectType - Identificador del tipo de proyecto.
 * @returns {boolean} false exclusivamente para advertising_stand.
 */
export function requiresPropertyAvailability(projectType) {
  return !isAdvertisingStand(projectType);
}

/**
 * Indica si aplican las preguntas que dependen del inmueble: situación legal, propietarios
 * y planos del lugar. Exige que el tipo admita la pregunta del inmueble y que la respuesta
 * declare disponibilidad; en otro caso esos campos son N/A y no se aceptan ni se evalúan.
 *
 * @param {{landStatus?: string|null, projectType?: string|null}|null|undefined} answers - Respuestas de la solicitud.
 * @returns {boolean} true cuando las preguntas del inmueble aplican.
 */
export function hasApplicableProperty(answers) {
  return requiresPropertyAvailability(answers?.projectType)
    && hasAvailableProperty(answers?.landStatus);
}

/**
 * Indica si la situación legal declarada habilita la lista de documentos disponibles.
 * La lista solo aplica cuando el inmueble aplica, está disponible y la documentación existe.
 *
 * @param {{landStatus?: string|null, legalDocumentationStatus?: string|null, projectType?: string|null}} answers - Respuestas del inmueble.
 * @returns {boolean} true cuando la lista de documentos es aplicable.
 */
export function hasAvailableLegalDocumentation(answers) {
  return hasApplicableProperty(answers)
    && answers?.legalDocumentationStatus === "available";
}

