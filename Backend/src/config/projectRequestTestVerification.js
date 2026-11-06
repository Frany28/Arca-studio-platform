// Validación de pruebas del envío de solicitudes (temporal, para staging sin correo).
//
// Con el modo activo, las cuentas autorizadas envían su solicitud con cualquier código numérico
// de seis dígitos: no se genera ni se envía ningún correo y no se comprueban vencimiento ni
// coincidencia. Se mantienen autenticación, CSRF, propiedad, estado editable y validación del
// formulario. Es fail-closed: solo se activa si se cumplen las tres condiciones siguientes, y
// cualquier valor ausente o desconocido deja la verificación por correo obligatoria.
//
// 1. PROJECT_REQUEST_TEST_VERIFICATION=enabled.
// 2. ARCA_DEPLOYMENT_STAGE declara un entorno de pruebas (development, test o staging). Staging en
//    Vercel usa NODE_ENV=production, así que NODE_ENV no basta para distinguirlo de producción;
//    sin esta marca explícita el modo nunca se activa.
// 3. La cuenta figura en PROJECT_REQUEST_TEST_VERIFICATION_EMAILS (correos separados por comas).
//
// Debe retirarse antes de producción (AGENTS.md §15). La configuración del frontend no interviene:
// el backend informa el modo en la respuesta de la emisión del código.

const TEST_DEPLOYMENT_STAGES = new Set(["development", "test", "staging"]);

/**
 * Normaliza un valor de entorno para compararlo sin mayúsculas ni espacios.
 * Un valor ausente se trata como cadena vacía, que nunca activa el modo.
 *
 * @param {unknown} value - Valor de la variable.
 * @returns {string} Valor normalizado.
 */
function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Lee en cada llamada (sin caché) si el modo de pruebas está activo y qué cuentas autoriza;
 * así un cambio de entorno o una prueba que lo desactiva surte efecto de inmediato.
 *
 * @param {Object<string, string|undefined>} [environment=process.env] - Variables de entorno.
 * @returns {{active: boolean, emails: Set<string>}} Si el modo está activo y las cuentas autorizadas.
 */
export function getProjectRequestTestVerificationConfig(environment = process.env) {
  const emails = new Set(
    String(environment.PROJECT_REQUEST_TEST_VERIFICATION_EMAILS || "")
      .split(",")
      .map(normalize)
      .filter(Boolean),
  );
  const active = normalize(environment.PROJECT_REQUEST_TEST_VERIFICATION) === "enabled"
    && TEST_DEPLOYMENT_STAGES.has(normalize(environment.ARCA_DEPLOYMENT_STAGE))
    && emails.size > 0;
  return { active, emails };
}

/**
 * Indica si una cuenta puede usar la validación de pruebas: modo activo y correo autorizado.
 *
 * @param {{email?: string}|null} user - Usuario autenticado.
 * @param {Object<string, string|undefined>} [environment=process.env] - Variables de entorno.
 * @returns {boolean} true solo para cuentas autorizadas con el modo activo.
 */
export function allowsProjectRequestTestVerification(user, environment = process.env) {
  const { active, emails } = getProjectRequestTestVerificationConfig(environment);
  return active && Boolean(user?.email) && emails.has(normalize(user.email));
}
