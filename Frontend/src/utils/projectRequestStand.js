export const ADVERTISING_STAND_PROJECT_TYPE = "advertising_stand";

export const EMPTY_STAND_FORM_FIELDS = Object.freeze({
  standRequirementsStatus: "",
  standDocumentTypes: Object.freeze([]),
  standSpaceStatus: "",
  hasStandSpacePlans: "Indeterminate",
});

/**
 * Aplica la condición exacta de Figma por identificador del catálogo.
 * La categoría histórica de stands y exhibiciones no habilita estas preguntas.
 * @param {string|null|undefined} projectType - Identificador del tipo de proyecto.
 * @returns {boolean} Si es un stand publicitario.
 */
export function isAdvertisingStand(projectType) {
  return projectType === ADVERTISING_STAND_PROJECT_TYPE;
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
    standDocumentTypes: form.standRequirementsStatus === "available" ? form.standDocumentTypes : [],
  };
}
