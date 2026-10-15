/* Notifica, sin dependencias de React, que el backend dejó de reconocer la sesión (B-3). */

// Rutas que gestionan su propio 401: la restauración de sesión decide con /auth/me, el login y
// el logout no pueden "expirar" una sesión. Excluirlas evita bucles de limpieza y redirección.
const SELF_HANDLED_AUTH_PATHS = new Set(["/auth/login", "/auth/logout", "/auth/me"]);

const listeners = new Set();

/**
 * Indica si un fallo HTTP significa que la sesión ya no es válida (revocada, caducada o cuenta
 * desactivada). Solo 401 con código UNAUTHENTICATED: un 403 es falta de permisos y conserva la
 * sesión, y otros 401 (contraseña actual incorrecta, credenciales inválidas) no la invalidan.
 *
 * @param {number} status - Estado HTTP de la respuesta.
 * @param {string|undefined} code - Código de error devuelto por la API.
 * @returns {boolean} Si la sesión debe darse por terminada.
 */
export function isSessionExpiredResponse(status, code) {
  return status === 401 && code === "UNAUTHENTICATED";
}

/**
 * Registra un oyente que se ejecuta cuando una petición autenticada descubre que la sesión expiró.
 *
 * @param {Function} listener - Recibe `{ path }` con la ruta que lo detectó.
 * @returns {Function} Función que elimina el oyente.
 */
export function onSessionExpired(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Avisa a los oyentes si la respuesta indica una sesión expirada en una ruta que no la gestiona
 * por sí misma. Los errores de un oyente no interrumpen a los demás ni al rechazo de la petición.
 *
 * @param {object} response - Datos del fallo.
 * @param {string} response.path - Ruta relativa a la base de API, con o sin query string.
 * @param {number} response.status - Estado HTTP.
 * @param {string|undefined} response.code - Código de error de la API.
 * @returns {boolean} Si se notificó la expiración.
 */
export function reportSessionExpiration({ code, path, status }) {
  const pathname = String(path || "").split("?")[0];
  if (!isSessionExpiredResponse(status, code) || SELF_HANDLED_AUTH_PATHS.has(pathname)) {
    return false;
  }

  for (const listener of [...listeners]) {
    try {
      listener({ path: pathname });
    } catch (error) {
      console.error("session_expiration_listener_failed", error);
    }
  }
  return true;
}
