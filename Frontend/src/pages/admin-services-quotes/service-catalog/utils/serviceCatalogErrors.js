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
  if (error?.code === "SERVICE_SELECTION_CHANGED") return { message: error.message, shouldReload: true };
  if (STALE_CODES[error?.code]) return { message: STALE_CODES[error.code], shouldReload: true };
  const reactivationMessage = error?.code === "VALIDATION_ERROR" ? getReactivationMessage(error.fields) : null;
  return {
    message: STATUS_MESSAGES[error?.status] || reactivationMessage || getUserFacingErrorMessage(error, fallback),
    shouldReload: error?.status === 404,
  };
}

// Motivo del bloqueo de la modalidad, igual al mensaje del 409 SERVICE_MODALITY_IN_USE.
export const SERVICE_MODALITY_LOCKED_MESSAGE = "La modalidad no se puede modificar porque este servicio ya está incluido en una cotización.";

// Campos del contrato que el formulario señala junto a su control.
const FORM_FIELD_BY_PATH = {
  description: "description",
  kind: "kind",
  measurementUnitId: "unit",
  name: "name",
  referenceRate: "referenceRate",
  unitDenominationId: "unit",
};

/**
 * Control del formulario para un error de la lista `unitOptions` (`unitOptions.N.campo`): la
 * posición 0 es la unidad principal y las demás, la fila de alternativa N - 1.
 *
 * @param {string} path - Ruta del error sin el prefijo `body.`.
 * @returns {string|null} Campo del formulario o null si no es de `unitOptions`.
 */
function unitOptionFormField(path) {
  if (path === "unitOptions") return "alternatives";
  const match = /^unitOptions\.(\d+)\.(\w+)$/.exec(path);
  if (!match) return null;
  const [, rawIndex, property] = match;
  const index = Number(rawIndex);
  if (index === 0) {
    if (property === "referenceRate") return "primaryUnitRate";
    return property === "presentationLabel" ? "presentationLabel" : "unit";
  }
  return property === "referenceRate" ? `alternativeRate.${index - 1}` : `alternative.${index - 1}`;
}

// 409 del alta y la edición que se explican en el formulario sin cerrarlo.
const FORM_CONFLICT_MESSAGES = {
  SERVICE_VERSION_CONFLICT: "Otro administrador guardó cambios en este servicio. Tus datos se conservan: cierra el formulario y vuelve a abrirlo para editar la versión vigente.",
  SERVICE_CONCURRENT_UPDATE: "El servicio se está actualizando en este momento. Inténtalo de nuevo en unos segundos.",
  SERVICE_CODE_ALREADY_EXISTS: "No se pudo asignar un código único al servicio. Inténtalo de nuevo.",
};

/**
 * Extrae los errores por campo de un VALIDATION_ERROR (`fields["body.referenceRate"]`) y los
 * asigna al control del formulario; la unidad base y la denominación comparten el campo de unidad.
 * Una referencia que dejó de estar disponible (409) también se señala en la unidad.
 *
 * @param {Object} error - Error normalizado por apiRequest.
 * @returns {{name?: string, description?: string, unit?: string, referenceRate?: string}} Errores.
 */
function getServiceFormFieldErrors(error) {
  if (error?.code === "SERVICE_REFERENCE_CONFLICT") return { unit: error.message || "La unidad elegida ya no está disponible." };
  // Regla SERVICE_MODALITY_IN_USE (Backend/ARCHITECTURE.md): el motivo va junto a la modalidad.
  if (error?.code === "SERVICE_MODALITY_IN_USE") return { kind: error.message || SERVICE_MODALITY_LOCKED_MESSAGE };
  const fieldErrors = {};
  for (const [rawPath, message] of Object.entries(error?.fields || {})) {
    const path = rawPath.replace(/^body\./, "");
    const field = FORM_FIELD_BY_PATH[path] ?? unitOptionFormField(path);
    if (field && !fieldErrors[field]) fieldErrors[field] = message;
  }
  return fieldErrors;
}

/**
 * Traduce un error al crear o editar un servicio a la retroalimentación del formulario, que
 * permanece abierto y conserva lo escrito. Indica si el listado debe recargarse (versión
 * desactualizada) o si el servicio ya no existe y el formulario debe cerrarse.
 *
 * @param {Object} error - Error normalizado por apiRequest (status, code, fields, message).
 * @param {string} fallback - Mensaje para errores sin texto útil.
 * @returns {{message: string, fieldErrors: Object, shouldReload: boolean, notFound: boolean}} Retroalimentación.
 */
export function getServiceFormErrorFeedback(error, fallback) {
  const fieldErrors = getServiceFormFieldErrors(error);
  const message = FORM_CONFLICT_MESSAGES[error?.code]
    || STATUS_MESSAGES[error?.status]
    || (Object.keys(fieldErrors).length ? "Revisa los datos marcados." : getUserFacingErrorMessage(error, fallback));
  return {
    fieldErrors,
    message,
    notFound: error?.status === 404,
    shouldReload: error?.code === "SERVICE_VERSION_CONFLICT" || error?.status === 404,
  };
}
