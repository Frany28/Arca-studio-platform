// Validación temporal del envío de solicitudes sin correo (fase de desarrollo y pruebas).
//
// Por decisión del desarrollador (AGENTS.md §17), mientras ARCA Studio está en desarrollo y
// staging el envío no solicita el código por correo: la emisión no genera ni envía nada y el envío
// acepta cualquier código numérico de seis dígitos, sin comprobar vencimiento ni coincidencia. Se
// mantienen autenticación, CSRF, propiedad, estado editable y validación del formulario.
//
// La verificación real por correo sigue implementada y se activa con
// PROJECT_REQUEST_EMAIL_VERIFICATION=enabled. Antes de producción debe activarse (o retirarse este
// modo) como parte de la revisión de AGENTS.md §15.

/**
 * Normaliza un valor de entorno para compararlo sin mayúsculas ni espacios.
 * Un valor ausente se trata como cadena vacía.
 *
 * @param {unknown} value - Valor de la variable.
 * @returns {string} Valor normalizado.
 */
function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Indica si el envío usa la validación temporal sin correo. Se lee en cada llamada (sin caché)
 * para que activar la verificación por correo surta efecto de inmediato.
 *
 * @param {{email?: string}|null} _user - Usuario autenticado (la validación temporal aplica a todos).
 * @param {Object<string, string|undefined>} [environment=process.env] - Variables de entorno.
 * @returns {boolean} true salvo con PROJECT_REQUEST_EMAIL_VERIFICATION=enabled.
 */
export function allowsProjectRequestTestVerification(_user, environment = process.env) {
  return normalize(environment.PROJECT_REQUEST_EMAIL_VERIFICATION) !== "enabled";
}
