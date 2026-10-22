import { getUserFacingErrorMessage } from "../../../../utils/userFacingError.js";

// Mensajes propios para respuestas cuyo texto del backend es genérico o técnico.
const STATUS_MESSAGES = {
  401: "Tu sesión expiró. Vuelve a iniciar sesión para continuar.",
  403: "No tienes permisos para gestionar el tabulador de servicios.",
  404: "Este servicio ya no existe. Actualizamos la lista.",
  429: "Realizaste demasiados cambios en poco tiempo. Espera unos minutos e inténtalo de nuevo.",
};

// 409 que indican que la fila visible quedó desactualizada: se recarga para leer la versión vigente.
const STALE_CODES = {
  SERVICE_VERSION_CONFLICT: "Otro administrador modificó este servicio. Actualizamos la lista; revisa el cambio y vuelve a intentarlo.",
  SERVICE_CONCURRENT_UPDATE: "El servicio se está actualizando en este momento. Actualizamos la lista; inténtalo de nuevo en unos segundos.",
};

// Reactivar exige que la unidad base y la denominación vigentes estén activas (400 por campo).
const REACTIVATION_FIELDS = {
  measurementUnitId: "No se puede activar: su unidad base está inactiva. Asígnale otra unidad o reactiva la unidad base.",
  unitDenominationId: "No se puede activar: su unidad de medida está inactiva. Actívala en la pestaña Unidades o asígnale otra.",
};

/**
 * Busca el primer campo de reactivación señalado por un VALIDATION_ERROR, aceptando la ruta con
 * o sin el prefijo `body.` del validador.
 *
 * @param {Object<string, string>} fields - Errores por campo de la respuesta.
 * @returns {string|null} Mensaje del campo bloqueante o null.
 */
function getReactivationMessage(fields) {
  for (const path of Object.keys(fields || {})) {
    const message = REACTIVATION_FIELDS[path.replace(/^body\./, "")];
    if (message) return message;
  }
  return null;
}

/**
 * Traduce un error al activar o desactivar un servicio a un mensaje comprensible, sin detalles
 * técnicos, e indica si la página visible debe recargarse (registro inexistente o versión
 * desactualizada). Los 401 además notifican la expiración global de sesión desde apiRequest.
 *
 * @param {Object} error - Error normalizado por apiRequest (status, code, fields, message).
 * @param {string} fallback - Mensaje para errores sin texto útil.
 * @returns {{message: string, shouldReload: boolean}} Retroalimentación.
 */
export function getServiceStatusErrorFeedback(error, fallback) {
  if (STALE_CODES[error?.code]) return { message: STALE_CODES[error.code], shouldReload: true };
  const reactivationMessage = error?.code === "VALIDATION_ERROR" ? getReactivationMessage(error.fields) : null;
  return {
    message: STATUS_MESSAGES[error?.status] || reactivationMessage || getUserFacingErrorMessage(error, fallback),
    shouldReload: error?.status === 404,
  };
}
