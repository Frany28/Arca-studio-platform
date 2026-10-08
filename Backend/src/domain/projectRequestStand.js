// Tipo específico de Figma; la categoría histórica stands_exhibitions es independiente.
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
