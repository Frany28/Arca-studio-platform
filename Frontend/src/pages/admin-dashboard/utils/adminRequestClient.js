import { getUserFacingErrorMessage, NETWORK_USER_ERROR_MESSAGE } from "../../../utils/userFacingError.js";

/**
 * Valida el ID del usuario solicitante antes de consultar el endpoint administrativo.
 * Descarta ausencias, valores coercibles ajenos a IDs y números fuera del rango seguro.
 * @param {unknown} value - Identificador recibido en requestedBy.
 * @returns {number|null} ID positivo válido o null si no hay un usuario consultable.
 */
export function normalizeRequestClientUserId(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Clasifica el fallo de la lectura independiente del cliente sin perder status ni code.
 * Solo permite reintentar fallos temporales; un 404 representa ausencia de información.
 * @param {Error} error - Error HTTP o de red del cliente de API compartido.
 * @returns {Object} Mensaje público, diagnóstico y política de reintento.
 */
export function getRequestClientFailure(error) {
  const status = error?.status ?? null;
  const code = error?.code ?? null;
  const unavailable = status === 404;
  let message;
  if (unavailable) message = "Información del cliente no disponible";
  else if (status === 403) message = getUserFacingErrorMessage(error, "No tienes permiso para consultar los datos del cliente.");
  else if (status === 401) message = getUserFacingErrorMessage(error, "Inicia sesión para consultar los datos del cliente.");
  else if (code === "NETWORK_ERROR") message = NETWORK_USER_ERROR_MESSAGE;
  else if (status >= 500) message = "No fue posible cargar los datos del cliente.";
  else message = getUserFacingErrorMessage(error, "No fue posible cargar los datos del cliente.");
  return { error: message, status, code, unavailable, canRetry: code === "NETWORK_ERROR" || status >= 500 || status === 408 || status === 429 };
}
