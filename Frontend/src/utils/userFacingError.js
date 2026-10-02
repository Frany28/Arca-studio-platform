const NETWORK_ERROR_PATTERNS = [
  /failed to fetch/i,
  /fetch failed/i,
  /load failed/i,
  /networkerror/i,
  /network error/i,
  /err_network/i,
  /econn(?:refused|reset|aborted)/i,
  /socket hang up/i,
];

const TECHNICAL_ERROR_PATTERNS = [
  /internal server error/i,
  /unexpected token/i,
  /cannot read properties/i,
  /undefined is not/i,
  /request failed with status code/i,
];

export const DEFAULT_USER_ERROR_MESSAGE =
  "No pudimos completar la acción. Revisa tu conexión e inténtalo nuevamente.";

export const NETWORK_USER_ERROR_MESSAGE =
  "No pudimos conectarnos con el servidor. Revisa tu conexión e inténtalo nuevamente.";

/**
 * Selecciona un mensaje visible desde texto o la propiedad message de un error.
 * Patrones de red usan el mensaje de conexión; patrones técnicos y mensajes vacíos
 * usan el fallback. Otros mensajes se conservan recortados, sin traducción adicional.
 *
 * @param {Object|string|null} errorOrMessage - Error o mensaje recibido.
 * @param {string} [fallback=DEFAULT_USER_ERROR_MESSAGE] - Mensaje general alternativo.
 * @returns {string} Mensaje de presentación.
 */
export function getUserFacingErrorMessage(
  errorOrMessage,
  fallback = DEFAULT_USER_ERROR_MESSAGE,
) {
  const message = typeof errorOrMessage === "string"
    ? errorOrMessage.trim()
    : String(errorOrMessage?.message || "").trim();

  if (!message) return fallback;
  if (NETWORK_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return NETWORK_USER_ERROR_MESSAGE;
  }
  if (TECHNICAL_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return fallback;
  }

  return message;
}
