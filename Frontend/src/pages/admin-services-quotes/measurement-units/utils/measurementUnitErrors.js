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

/**
 * Extrae los errores por campo de un VALIDATION_ERROR (`fields["body.denomination"]`) y de los
 * 409 propios de un campo: el duplicado se señala sobre el texto y la base en uso sobre la abreviatura.
 *
 * @param {Object} error - Error normalizado por apiRequest (status, code, fields, message).
 * @returns {{denomination?: string, measurementUnitId?: string}} Errores por campo del formulario.
 */
function getFieldErrors(error) {
  if (error?.code === "MEASUREMENT_UNIT_DENOMINATION_ALREADY_EXISTS") {
    return { denomination: error.message };
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
