import { isAdvertisingStand, normalizeStandFormFields } from "./projectRequestStand.js";

/*
 * Aplicabilidad de las preguntas condicionales del formulario de solicitud.
 *
 * Replica las reglas de `Backend/src/domain/projectRequest.js`: el bundle del frontend no
 * puede importar el dominio del backend, por lo que `Backend/tests/projectRequestApplicability.test.js`
 * compara ambas implementaciones en todas las combinaciones. Cualquier cambio debe hacerse
 * en los dos módulos a la vez.
 */

// Valores iniciales de las respuestas que solo existen con un inmueble aplicable y disponible.
export const EMPTY_PROPERTY_DETAIL_FIELDS = Object.freeze({
  legalDocumentationStatus: "",
  legalDocumentTypes: Object.freeze([]),
  multipleOwners: "",
  hasBlueprints: "Indeterminate",
});

/**
 * Indica si la respuesta de terreno o inmueble declara disponibilidad.
 * Solo evalúa la respuesta; la aplicabilidad por tipo la decide `hasApplicableProperty`.
 *
 * @param {string|null|undefined} landStatus - Respuesta sobre disponibilidad del terreno.
 * @returns {boolean} true cuando la respuesta es "available".
 */
export function hasAvailableProperty(landStatus) {
  return landStatus === "available";
}

/**
 * Indica si la pregunta «¿Tiene terreno o inmueble disponible?» aplica al tipo de proyecto.
 * Un Stand publicitario se monta en el espacio asignado por el evento: la pregunta y la
 * sección legal no aplican y el espacio se declara en «Requisitos del stand».
 *
 * @param {string|null|undefined} projectType - Identificador del tipo de proyecto.
 * @returns {boolean} false exclusivamente para Stand publicitario.
 */
export function requiresPropertyAvailability(projectType) {
  return !isAdvertisingStand(projectType);
}

/**
 * Indica si se muestran, validan y envían la situación legal, los propietarios y los planos.
 * Exige un tipo con pregunta de inmueble y la respuesta de inmueble disponible.
 *
 * @param {{landStatus?: string|null, projectType?: string|null}|null|undefined} values - Valores del formulario.
 * @returns {boolean} true cuando la sección legal del inmueble aplica.
 */
export function hasApplicableProperty(values) {
  return requiresPropertyAvailability(values?.projectType)
    && hasAvailableProperty(values?.landStatus);
}

/**
 * Limpia en un único estado todas las respuestas condicionales que dejaron de aplicar.
 * Primero aplica la limpieza del stand; después vacía la pregunta del inmueble en un stand,
 * la sección legal sin inmueble aplicable y los documentos legales no disponibles. Al
 * volver a un tipo o respuesta, las preguntas reaparecen vacías.
 *
 * @param {Object} form - Estado editable de la solicitud.
 * @returns {Object} Estado coherente sin modificar los demás campos.
 */
export function normalizeConditionalFormFields(form) {
  const standForm = normalizeStandFormFields(form);
  if (!requiresPropertyAvailability(standForm.projectType)) {
    return { ...standForm, ...EMPTY_PROPERTY_DETAIL_FIELDS, landStatus: "" };
  }
  if (!hasAvailableProperty(standForm.landStatus)) {
    return { ...standForm, ...EMPTY_PROPERTY_DETAIL_FIELDS };
  }
  return standForm.legalDocumentationStatus === "available"
    ? standForm
    : { ...standForm, legalDocumentTypes: EMPTY_PROPERTY_DETAIL_FIELDS.legalDocumentTypes };
}
