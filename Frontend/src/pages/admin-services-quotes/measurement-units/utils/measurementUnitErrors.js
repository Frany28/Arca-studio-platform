import { getUserFacingErrorMessage } from "../../../../utils/userFacingError.js";

// Mensajes propios para respuestas cuyo texto del backend es genérico o técnico. Los 409 de
// negocio (duplicado, en uso, concurrencia) ya llegan con un mensaje comprensible y se conservan.
const STATUS_MESSAGES = {
  401: "Tu sesión expiró. Vuelve a iniciar sesión para continuar.",
  403: "No tienes permisos para gestionar unidades de medida.",
  404: "Esta unidad de medida ya no existe. Actualizamos la lista.",
  429: "Realizaste demasiados cambios en poco tiempo. Espera unos minutos e inténtalo de nuevo.",
};

// Campos del contrato que el formulario puede señalar junto al control correspondiente.
const FORM_FIELDS = ["denomination", "measurementUnitId"];

// Textos de los 409 de negocio. El duplicado se señala junto al texto de la denominación.
export const DENOMINATION_DUPLICATE_MESSAGE = "Ya hay una denominación equivalente para la unidad base seleccionada";
const IN_USE_MESSAGE = "Está siendo utilizada por servicios activos";
const CHANGED_MESSAGE = "La información cambió. Actualiza el listado e inténtalo nuevamente";
const NETWORK_MESSAGE = "Comprueba tu conexión e inténtalo nuevamente";
const UNEXPECTED_MESSAGE = "Ocurrió un error inesperado. Inténtalo nuevamente en unos segundos";
// 409 en los que la unidad cambió o se bloqueó entre la lectura y el envío (no son duplicados).
const CHANGED_CODES = ["MEASUREMENT_UNIT_CONCURRENT_UPDATE", "MEASUREMENT_UNIT_CONFLICT", "MEASUREMENT_UNIT_REFERENCE_CONFLICT"];

// Título del aviso de error según la operación que falló.
const OPERATION_ERROR_TITLES = {
  create: "No se pudo crear la unidad",
  update: "No se pudo actualizar la unidad",
  activate: "No se pudo activar la unidad",
  deactivate: "No se pudo desactivar la unidad",
};

/**
 * Extrae los errores por campo de un VALIDATION_ERROR (`fields["body.denomination"]`) y de los
 * 409 propios de un campo: el duplicado se señala sobre el texto y la base en uso sobre la abreviatura.
 *
 * @param {Object} error - Error normalizado por apiRequest (status, code, fields, message).
 * @returns {{denomination?: string, measurementUnitId?: string}} Errores por campo del formulario.
 */
function getFieldErrors(error) {
  if (error?.code === "MEASUREMENT_UNIT_DENOMINATION_ALREADY_EXISTS") {
    return { denomination: DENOMINATION_DUPLICATE_MESSAGE };
  }
  if (error?.code === "MEASUREMENT_UNIT_BASE_IN_USE") {
    return { measurementUnitId: error.message };
  }
  const fieldErrors = {};
  for (const [path, message] of Object.entries(error?.fields || {})) {
    const field = path.replace(/^body\./, "");
    if (FORM_FIELDS.includes(field)) fieldErrors[field] = message;
  }
  return fieldErrors;
}

/**
 * Traduce un error de la API de unidades a la retroalimentación de la interfaz, sin exponer
 * detalles técnicos. Los 401 también notifican la expiración global de sesión desde apiRequest;
 * los 404 piden recargar porque el registro ya no está en la página visible, y BASE_IN_USE
 * indica que la base quedó bloqueada (otro servicio empezó a usar la unidad).
 *
 * @param {Object} error - Error lanzado por measurementUnitsApi.
 * @param {string} fallback - Mensaje para errores sin texto útil.
 * @returns {{message: string, fieldErrors: Object, shouldReload: boolean, baseUnitLocked: boolean}} Retroalimentación.
 */
export function getMeasurementUnitErrorFeedback(error, fallback) {
  const fieldErrors = getFieldErrors(error);
  const message = STATUS_MESSAGES[error?.status]
    || (error?.code === "VALIDATION_ERROR" && Object.keys(fieldErrors).length
      ? "Revisa los datos marcados."
      : getUserFacingErrorMessage(error, fallback));
  return {
    baseUnitLocked: error?.code === "MEASUREMENT_UNIT_BASE_IN_USE",
    fieldErrors,
    message,
    shouldReload: error?.status === 404,
  };
}

/**
 * Prepara el aviso Danger de una operación de unidades fallida a partir del error real de la API:
 * en uso, duplicado, conflicto de concurrencia, validación, red y estados HTTP comprensibles. Cada
 * 409 se distingue por su código; ninguno se presenta como duplicado salvo el de unicidad. Los
 * errores por campo conservan su detalle en `fieldErrors` para mostrarlos junto al control.
 *
 * @param {Object} error - Error normalizado por apiRequest (status, code, fields, message).
 * @param {"create"|"update"|"activate"|"deactivate"} operation - Operación que falló.
 * @returns {{title: string, message: string, fieldErrors: Object, shouldReload: boolean, baseUnitLocked: boolean}} Aviso y efectos.
 */
export function describeMeasurementUnitError(error, operation) {
  // El título ya nombra la operación: un error sin texto útil no la repite en la descripción.
  const feedback = getMeasurementUnitErrorFeedback(error, UNEXPECTED_MESSAGE);
  const title = OPERATION_ERROR_TITLES[operation];
  if (error?.code === "NETWORK_ERROR") return { ...feedback, title: "No se pudo completar la operación", message: NETWORK_MESSAGE };
  if (error?.code === "MEASUREMENT_UNIT_DENOMINATION_ALREADY_EXISTS") {
    return { ...feedback, title: "Esta unidad ya existe", message: DENOMINATION_DUPLICATE_MESSAGE };
  }
  // Editar el texto conserva la alternativa del backend (crear otra y reasignar los servicios).
  if (error?.code === "MEASUREMENT_UNIT_IN_USE") {
    return { ...feedback, title, message: operation === "update" ? feedback.message : IN_USE_MESSAGE };
  }
  if (CHANGED_CODES.includes(error?.code)) return { ...feedback, title, message: CHANGED_MESSAGE };
  // Sin formulario (activar o desactivar), el motivo por campo es el mensaje útil del aviso.
  const fieldMessage = Object.values(feedback.fieldErrors)[0];
  if (fieldMessage && (operation === "activate" || operation === "deactivate")) return { ...feedback, title, message: fieldMessage };
  return { ...feedback, title };
}
