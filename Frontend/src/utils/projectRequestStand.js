export const ADVERTISING_STAND_PROJECT_TYPE = "advertising_stand";
// Identificador histórico del mismo servicio; solo puede llegar en registros anteriores.
export const LEGACY_STAND_PROJECT_TYPE = "stands_exhibitions";

export const EMPTY_STAND_FORM_FIELDS = Object.freeze({
  standRequirementsStatus: "",
  standDocumentTypes: Object.freeze([]),
  standSpaceStatus: "",
  hasStandSpacePlans: "Indeterminate",
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
 * Indica si la respuesta sobre normas del evento habilita la documentación disponible.
 * Replica `allowsStandDocumentSelection` del dominio del backend (prueba de paridad en Backend).
 * @param {string|null|undefined} requirementsStatus - Respuesta sobre normas o requisitos del evento.
 * @returns {boolean} true solo con «Sí, tengo los requisitos».
 */
export function allowsStandDocumentSelection(requirementsStatus) {
  return requirementsStatus === "available";
}

/**
 * Limpia respuestas no aplicables al restaurar o editar el formulario.
 * Cambiar de tipo descarta todo el bloque; cambiar disponibilidad descarta los documentos.
 * @param {Object} form - Estado editable de la solicitud.
 * @returns {Object} Estado coherente sin modificar los demás campos.
 */
export function normalizeStandFormFields(form) {
  if (!isAdvertisingStand(form.projectType)) return { ...form, ...EMPTY_STAND_FORM_FIELDS };
  return {
    ...form,
    standDocumentTypes: allowsStandDocumentSelection(form.standRequirementsStatus) ? form.standDocumentTypes : [],
  };
}
