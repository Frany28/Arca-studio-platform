// Autenticación del arnés de carga (P0-4), compartida por k6 y por los scripts de Node.
//
// El login responde `{ user }` y entrega la sesión solo en la cookie HttpOnly `arca_session`
// (`__Host-arca_session` en producción). El arnés anterior leía `token` del cuerpo, que no existe:
// todas las peticiones iban sin sesión y medían respuestas 401. Aquí se extrae la cookie de
// Set-Cookie y se reenvía en la cabecera Cookie; las peticiones que modifican datos llevan además
// Origin, que el backend exige como protección CSRF. Sin APIs de Node ni de k6: funciona en ambos.

const SESSION_COOKIE_PATTERN = /^(?:__Host-)?arca_session$/;

/**
 * Extrae la cookie de sesión de las cabeceras Set-Cookie de la respuesta de login.
 * Acepta una cadena (varias cookies separadas por coma) o una lista, como devuelven k6 y fetch.
 *
 * @param {string|Array<string>|null|undefined} setCookie - Valor de Set-Cookie.
 * @returns {string|null} Par `nombre=valor` listo para la cabecera Cookie, o null si no hay sesión.
 */
export function sessionCookieFrom(setCookie) {
  const headers = Array.isArray(setCookie) ? setCookie : String(setCookie || "").split(/,(?=\s*[^;,\s]+=)/);
  for (const header of headers) {
    const [pair] = String(header).trim().split(";");
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (SESSION_COOKIE_PATTERN.test(name) && value) return `${name}=${value}`;
  }
  return null;
}

/**
 * Cabeceras de una petición autenticada con la cookie de sesión.
 * Origin acompaña siempre a la petición para superar la comprobación CSRF en escrituras.
 *
 * @param {string} cookie - Par `nombre=valor` de la sesión.
 * @param {string} origin - Origen permitido del frontend.
 * @param {Record<string, string>} [extra] - Cabeceras adicionales.
 * @returns {Record<string, string>} Cabeceras.
 */
export function sessionHeaders(cookie, origin, extra = {}) {
  return { Cookie: cookie, Origin: origin, ...extra };
}

/**
 * Clasifica un estado HTTP para separar límites legítimos de fallos del sistema.
 *
 * @param {number} status - Estado HTTP (0 si no hubo respuesta).
 * @returns {"ok"|"rate_limited"|"saturated"|"auth_failure"|"client_error"|"server_error"|"network_error"} Clase.
 */
export function classifyStatus(status) {
  if (status === 0) return "network_error";
  if (status === 429) return "rate_limited";
  if (status === 503) return "saturated";
  if (status === 401 || status === 403) return "auth_failure";
  if (status >= 500) return "server_error";
  if (status >= 400) return "client_error";
  return "ok";
}
