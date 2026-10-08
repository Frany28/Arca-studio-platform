// Tipo vigente de Figma; stands_exhibitions se conserva únicamente en registros históricos.
export const ADVERTISING_STAND_PROJECT_TYPE = "advertising_stand";

export const STAND_REQUIREMENTS_VALUES = Object.freeze({
  requirementsStatus: Object.freeze(["available", "in_process", "unavailable"]),
  documentTypes: Object.freeze(["exhibitor_manual", "event_regulations", "stand_technical_specifications", "other"]),
  spaceStatus: Object.freeze(["assigned", "in_process", "unassigned"]),
});

/**
 * Determina si las preguntas de requisitos del evento aplican al tipo de solicitud.
 * Solo el stand publicitario las habilita; no incluye la categoría histórica de stands.
 *
 * @param {string|null|undefined} projectType - Identificador del catálogo de proyectos.
 * @returns {boolean} true exclusivamente para advertising_stand.
 */
export function isAdvertisingStand(projectType) {
  return projectType === ADVERTISING_STAND_PROJECT_TYPE;
}

/**
 * Indica si la respuesta sobre normas del evento habilita la lista de documentación.
 * Solo «Sí, tengo los requisitos» la habilita; contrato, formulario y completitud la comparten.
 *
 * @param {string|null|undefined} requirementsStatus - Respuesta sobre normas o requisitos del evento.
 * @returns {boolean} true cuando la documentación disponible es aplicable.
 */
export function allowsStandDocumentSelection(requirementsStatus) {
  return requirementsStatus === "available";
}
