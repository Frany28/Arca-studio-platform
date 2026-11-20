const isProduction = process.env.NODE_ENV === "production";
const defaultOrigins = isProduction
  ? ["https://arcastudio.netlify.app"]
  : ["http://localhost:5173"];

/**
 * Interpreta el valor de boolean y descarta los formatos que no sean válidos.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @param {unknown} value - Valor de `value` requerido por esta operación.
 * @param {unknown} [fallback] - Valor de `fallback` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
function parseBoolean(value, fallback = false) {
  if (value === undefined || value === "") {
    return fallback;
  }

  return String(value).trim().toLowerCase() === "true";
}

/**
 * Interpreta el valor de lista y descarta los formatos que no sean válidos.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @param {unknown} value - Valor de `value` requerido por esta operación.
 * @returns {Array<unknown>} Resultado producido por la operación.
 */
function parseList(value) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Combina el valor de unique eliminando valores repetidos.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @param {Array<unknown>} values - Valor de `values` requerido por esta operación.
 * @returns {Array<unknown>} Resultado producido por la operación.
 */
function mergeUnique(values) {
  return [...new Set(values.filter(Boolean))];
}

/**
 * Obtiene los encabezados permitidos por CORS para que el flujo llamador pueda continuar.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @returns {unknown} Resultado producido por la operación.
 */
function getAllowedHeaders() {
  const defaultHeaders = [
    "Accept",
    "Authorization",
    "Content-Type",
    "Origin",
    "Range",
    "X-Change-Note",
    "X-File-Name",
    "X-Original-File-Name",
    "X-Requested-With",
  ];

  return mergeUnique([
    ...defaultHeaders,
    ...parseList(process.env.CORS_ALLOWED_HEADERS),
  ]);
}

/**
 * Obtiene los encabezados expuestos por CORS para que el flujo llamador pueda continuar.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @returns {unknown} Resultado producido por la operación.
 */
function getExposedHeaders() {
  const defaultHeaders = [
    "Accept-Ranges",
    "Content-Disposition",
    "Content-Length",
    "Content-Range",
    "Content-Type",
  ];

  return mergeUnique([
    ...defaultHeaders,
    ...parseList(process.env.CORS_EXPOSED_HEADERS),
  ]);
}

/**
 * Normaliza el valor de origen para mantener un formato interno consistente.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @param {string} origin - Valor de `origin` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
function normalizeOrigin(origin) {
  if (origin === "*") {
    if (isProduction) {
      throw new Error("CORS wildcard origin is not allowed in production");
    }

    return origin;
  }

  try {
    return new URL(origin).origin;
  } catch {
    throw new Error(`Invalid CORS origin: ${origin}`);
  }
}

/**
 * Determina si el valor de wildcard subdomain origen cumple la condición esperada.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @param {string} origin - Valor de `origin` requerido por esta operación.
 * @returns {boolean} Resultado producido por la operación.
 */
function isWildcardSubdomainOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.hostname.startsWith("*.");
  } catch {
    return false;
  }
}

/**
 * Procesa el valor de origen matches para completar la responsabilidad asignada al módulo.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @param {boolean} allowedOrigin - Valor de `allowedOrigin` requerido por esta operación.
 * @param {string} requestOrigin - Valor de `requestOrigin` requerido por esta operación.
 * @returns {boolean} Resultado producido por la operación.
 */
function originMatches(allowedOrigin, requestOrigin) {
  if (allowedOrigin === "*") {
    return true;
  }

  if (allowedOrigin === requestOrigin) {
    return true;
  }

  if (!isWildcardSubdomainOrigin(allowedOrigin)) {
    return false;
  }

  try {
    const allowedUrl = new URL(allowedOrigin);
    const requestUrl = new URL(requestOrigin);
    const allowedSuffix = allowedUrl.hostname.slice(1);

    return (
      allowedUrl.protocol === requestUrl.protocol &&
      allowedUrl.port === requestUrl.port &&
      requestUrl.hostname.endsWith(allowedSuffix) &&
      requestUrl.hostname !== allowedSuffix.slice(1)
    );
  } catch {
    return false;
  }
}

/**
 * Obtiene los orígenes permitidos por CORS para que el flujo llamador pueda continuar.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @returns {unknown} Resultado producido por la operación.
 */
export function getAllowedOrigins() {
  const configuredOrigins = mergeUnique([
    ...defaultOrigins,
    ...parseList(process.env.CORS_ORIGIN),
    ...parseList(process.env.CORS_ORIGINS),
    ...parseList(process.env.FRONTEND_URL),
  ]);

  return configuredOrigins.map(normalizeOrigin);
}

/**
 * Determina si el valor de allowed origen cumple la condición esperada.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @param {string} origin - Valor de `origin` requerido por esta operación.
 * @returns {boolean} Resultado producido por la operación.
 */
export function isAllowedOrigin(origin) {
  if (!origin) {
    return false;
  }

  return getAllowedOrigins().some((allowedOrigin) =>
    originMatches(allowedOrigin, origin),
  );
}

/**
 * Procesa las opciones de CORS para completar la responsabilidad asignada al módulo.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @returns {object} Resultado producido por la operación.
 */
export function corsOptions() {
  const allowedOrigins = getAllowedOrigins();
  const allowRequestsWithoutOrigin = parseBoolean(
    process.env.CORS_ALLOW_NO_ORIGIN,
    !isProduction,
  );

  return {
    credentials: parseBoolean(process.env.CORS_CREDENTIALS, true),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: getAllowedHeaders(),
    exposedHeaders: getExposedHeaders(),
    maxAge: 86400,
    optionsSuccessStatus: 204,
    preflightContinue: false,
        /**
     * Decide si el origen de una solicitud puede acceder mediante CORS.
     * Entrega la decisión al middleware sin exponer detalles internos de configuración.
     *
     * @param {string} origin - Valor de `origin` requerido por esta operación.
     * @param {Function} callback - Función que recibe el resultado de la operación asíncrona.
     * @returns {void} Finalización de la operación.
     */
origin(origin, callback) {
      if (!origin) {
        callback(null, allowRequestsWithoutOrigin);
        return;
      }

      if (
        allowedOrigins.some((allowedOrigin) =>
          originMatches(allowedOrigin, origin),
        )
      ) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
  };
}
