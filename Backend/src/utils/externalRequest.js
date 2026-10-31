// Peticiones a servicios externos con plazo explícito (P0-3): Resend y Geoapify. Sin plazo, un
// proveedor que no responde retenía la petición hasta que la plataforma la cortaba. No se reintenta
// nada aquí: enviar un correo no es idempotente y un reintento podría duplicarlo.

/**
 * Lee un entero positivo de configuración con un valor por defecto.
 * Los valores ausentes, no numéricos o no positivos usan el predeterminado para no desactivar el plazo.
 *
 * @param {string} name - Variable de entorno.
 * @param {number} fallback - Valor por defecto en milisegundos.
 * @returns {number} Plazo configurado.
 */
function positiveIntegerSetting(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export const EXTERNAL_REQUEST_TIMEOUTS = Object.freeze({
  emailMs: positiveIntegerSetting("EMAIL_REQUEST_TIMEOUT_MS", 10 * 1000),
  geocodingMs: positiveIntegerSetting("GEOAPIFY_REQUEST_TIMEOUT_MS", 5 * 1000),
});

/**
 * Indica si un error procede de un plazo agotado, también al leer el cuerpo de la respuesta.
 * `AbortSignal.timeout` rechaza con un DOMException de nombre TimeoutError.
 *
 * @param {unknown} error - Error capturado.
 * @returns {boolean} true si el plazo se agotó.
 */
export function isTimeoutError(error) {
  return error?.name === "TimeoutError" || error?.code === "EXTERNAL_TIMEOUT";
}

/**
 * Ejecuta `fetch` con un plazo que cubre la conexión, la respuesta y la lectura del cuerpo.
 * Los fallos de red y de plazo se devuelven con un código estable y sin la URL, que puede incluir claves.
 *
 * @param {string} url - Dirección del servicio.
 * @param {RequestInit} options - Opciones de `fetch`.
 * @param {number} timeoutMs - Plazo en milisegundos.
 * @returns {Promise<Response>} Respuesta del servicio.
 * @throws {Error} Con `code` EXTERNAL_TIMEOUT o EXTERNAL_UNAVAILABLE.
 */
export async function fetchWithTimeout(url, options, timeoutMs) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const timedOut = isTimeoutError(error);
    throw Object.assign(new Error(timedOut ? "External request timed out" : "External request failed"), {
      cause: error,
      code: timedOut ? "EXTERNAL_TIMEOUT" : "EXTERNAL_UNAVAILABLE",
    });
  }
}
