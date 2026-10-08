import { ADVERTISING_STAND_PROJECT_TYPE } from "./projectRequestStand.js";

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
 * Indica si la solicitud declara un terreno o inmueble disponible para el proyecto.
 * Solo en ese caso se preguntan, persisten y evalúan la situación legal, la documentación,
 * los propietarios y los planos del lugar; en otro caso esos campos son N/A.
 *
 * @param {string|null|undefined} landStatus - Respuesta sobre disponibilidad del terreno.
 * @returns {boolean} true cuando la respuesta es "available".
 */
export function hasAvailableProperty(landStatus) {
  return landStatus === "available";
}

/**
 * Indica si la situación legal declarada habilita la lista de documentos disponibles.
 * La lista solo aplica cuando hay inmueble disponible y la documentación ya existe.
 *
 * @param {{landStatus?: string|null, legalDocumentationStatus?: string|null}} answers - Respuestas del inmueble.
 * @returns {boolean} true cuando la lista de documentos es aplicable.
 */
export function hasAvailableLegalDocumentation(answers) {
  return hasAvailableProperty(answers?.landStatus)
    && answers?.legalDocumentationStatus === "available";
}

