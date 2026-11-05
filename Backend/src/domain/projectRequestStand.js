// Tipo vigente de Figma. stands_exhibitions es el identificador histórico del mismo servicio:
// solo puede aparecer en registros anteriores y nunca se acepta en solicitudes nuevas.
export const ADVERTISING_STAND_PROJECT_TYPE = "advertising_stand";
export const LEGACY_STAND_PROJECT_TYPE = "stands_exhibitions";

export const STAND_REQUIREMENTS_VALUES = Object.freeze({
  requirementsStatus: Object.freeze(["available", "in_process", "unavailable"]),
  documentTypes: Object.freeze(["exhibitor_manual", "event_regulations", "stand_technical_specifications", "other"]),
  spaceStatus: Object.freeze(["assigned", "in_process", "unassigned"]),
});

/**
 * Determina si la solicitud es un Stand publicitario, reconociendo también su identificador
 * histórico `stands_exhibitions` (mismo servicio, Propuesta V3.3 §11). Es la única equivalencia:
 * aplicabilidad, validación, completitud, compatibilidad y presentación la reutilizan.
 *
 * @param {string|null|undefined} projectType - Identificador del catálogo de proyectos.
 * @returns {boolean} true para advertising_stand y stands_exhibitions.
 */
export function isAdvertisingStand(projectType) {
  return projectType === ADVERTISING_STAND_PROJECT_TYPE || projectType === LEGACY_STAND_PROJECT_TYPE;
}

/**
 * Devuelve el identificador vigente de un tipo de solicitud: el histórico de stands pasa a
 * `advertising_stand` (renombramiento) y los demás se conservan. Se aplica al guardar una
 * solicitud editable; las evaluaciones ya guardadas no se recalculan.
 *
 * @param {string|null|undefined} projectType - Tipo recibido o guardado.
 * @returns {string|null|undefined} Tipo vigente.
 */
export function toCurrentProjectType(projectType) {
  return projectType === LEGACY_STAND_PROJECT_TYPE ? ADVERTISING_STAND_PROJECT_TYPE : projectType;
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
