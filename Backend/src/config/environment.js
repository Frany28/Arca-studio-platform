import { collectDatabaseTlsViolations } from "./databaseTls.js";

// Valores canónicos de NODE_ENV. Cualquier otro (ausente, mayúsculas, espacios,
// "staging", "prod"…) es ambiguo y se rechaza: las protecciones de cookies,
// CORS, CSRF y JWT comparan exactamente con "production".
const LOCAL_NODE_ENVIRONMENTS = new Set(["development", "test"]);
const SUPPORTED_NODE_ENVIRONMENTS = new Set([...LOCAL_NODE_ENVIRONMENTS, "production"]);

// Marcadores que inyectan las plataformas de despliegue. Son una señal adicional,
// no la única: un despliegue sin marcadores también falla si NODE_ENV no es canónico.
export const HOSTED_RUNTIME_MARKERS = [
  "VERCEL",
  "VERCEL_ENV",
  "AWS_LAMBDA_FUNCTION_NAME",
  "FUNCTIONS_WORKER_RUNTIME",
  "NETLIFY",
];

const MIN_AUTH_TOKEN_SECRET_LENGTH = 32;
const DEFAULT_PRODUCTION_ORIGIN = "https://arcastudio.netlify.app";

/**
 * Normaliza un valor booleano textual del entorno para compararlo de forma tolerante.
 * Se usa solo para detectar activaciones peligrosas, por lo que cualquier variante de "true" cuenta.
 *
 * @param {string|undefined} value - Valor crudo de la variable.
 * @returns {string} Valor recortado y en minúsculas, o cadena vacía si no existe.
 */
function normalizeFlag(value) {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Indica qué marcadores de plataforma de despliegue están presentes en el entorno.
 * Permite reconocer una instancia publicada aunque NODE_ENV se haya configurado mal.
 *
 * @param {Record<string, string|undefined>} environment - Variables de entorno a evaluar.
 * @returns {Array<string>} Nombres de los marcadores presentes.
 */
export function getHostedRuntimeMarkers(environment) {
  return HOSTED_RUNTIME_MARKERS.filter((name) => Boolean(environment[name]));
}

/**
 * Determina si el proceso es un entorno local de desarrollo o pruebas.
 * Exige un NODE_ENV local exacto y la ausencia de marcadores de plataforma.
 *
 * @param {Record<string, string|undefined>} [environment] - Variables de entorno a evaluar.
 * @returns {boolean} true solo para desarrollo o pruebas locales explícitas.
 */
export function isLocalRuntime(environment = process.env) {
  return (
    LOCAL_NODE_ENVIRONMENTS.has(environment.NODE_ENV) &&
    getHostedRuntimeMarkers(environment).length === 0
  );
}

/**
 * Reúne los orígenes que el backend aceptará en producción, igual que `config/cors.js`.
 * Se duplica solo la lista de variables para validar sin depender de la carga de CORS.
 *
 * @param {Record<string, string|undefined>} environment - Variables de entorno a evaluar.
 * @returns {Array<string>} Orígenes configurados, sin normalizar.
 */
function getConfiguredProductionOrigins(environment) {
  return [
    DEFAULT_PRODUCTION_ORIGIN,
    ...["CORS_ORIGIN", "CORS_ORIGINS", "FRONTEND_URL"].flatMap((name) =>
      String(environment[name] || "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * Determina si un origen permitido es seguro para un despliegue en producción.
 * Rechaza comodines, orígenes sin HTTPS y valores que no son URL válidas.
 *
 * @param {string} origin - Origen configurado.
 * @returns {boolean} true si es un origen HTTPS concreto.
 */
function isSecureProductionOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && !url.hostname.includes("*");
  } catch {
    return false;
  }
}

/**
 * Evalúa las reglas de seguridad del entorno sin revelar valores de variables.
 * En local solo exige un NODE_ENV canónico; en producción exige además secreto, orígenes, CSRF y TLS de PostgreSQL seguros.
 *
 * @param {Record<string, string|undefined>} [environment] - Variables de entorno a evaluar.
 * @returns {Array<{ code: string, variable: string, message: string }>} Infracciones encontradas.
 */
export function collectEnvironmentViolations(environment = process.env) {
  const violations = [];
  const nodeEnvironment = environment.NODE_ENV;

  if (!SUPPORTED_NODE_ENVIRONMENTS.has(nodeEnvironment)) {
    violations.push({
      code: "NODE_ENV_INVALID",
      message: "Debe ser exactamente development, test o production.",
      variable: "NODE_ENV",
    });
  }

  const markers = getHostedRuntimeMarkers(environment);
  if (markers.length > 0 && nodeEnvironment !== "production") {
    violations.push({
      code: "HOSTED_RUNTIME_NOT_PRODUCTION",
      message: `Plataforma detectada (${markers.join(", ")}); NODE_ENV debe ser production.`,
      variable: "NODE_ENV",
    });
  }

  if (nodeEnvironment !== "production") return violations;

  if (String(environment.AUTH_TOKEN_SECRET || "").length < MIN_AUTH_TOKEN_SECRET_LENGTH) {
    violations.push({
      code: "AUTH_TOKEN_SECRET_WEAK",
      message: `Debe existir y tener al menos ${MIN_AUTH_TOKEN_SECRET_LENGTH} caracteres.`,
      variable: "AUTH_TOKEN_SECRET",
    });
  }

  if (!["", "false"].includes(normalizeFlag(environment.ROUTE_AUTH_DISABLED_FOR_TESTS))) {
    violations.push({
      code: "AUTH_BYPASS_FLAG_PRESENT",
      message: "No debe configurarse en producción.",
      variable: "ROUTE_AUTH_DISABLED_FOR_TESTS",
    });
  }

  if (normalizeFlag(environment.CSRF_ALLOW_NO_ORIGIN) === "true") {
    violations.push({
      code: "CSRF_ALLOWS_MISSING_ORIGIN",
      message: "Debe omitirse o ser false en producción.",
      variable: "CSRF_ALLOW_NO_ORIGIN",
    });
  }

  if (!getConfiguredProductionOrigins(environment).every(isSecureProductionOrigin)) {
    violations.push({
      code: "CORS_ORIGIN_INSECURE",
      message: "Solo se permiten orígenes HTTPS concretos, sin comodines.",
      variable: "CORS_ORIGIN, CORS_ORIGINS o FRONTEND_URL",
    });
  }

  // TLS hacia PostgreSQL: verificación obligatoria, CA de Supabase y URL sin parámetros que la debiliten.
  violations.push(...collectDatabaseTlsViolations(environment));

  return violations;
}

/**
 * Detiene el arranque si la configuración del entorno no es explícitamente segura.
 * Debe ejecutarse en cada punto de entrada antes de atender solicitudes; el error solo nombra variables.
 *
 * @param {Record<string, string|undefined>} [environment] - Variables de entorno a evaluar.
 * @returns {void} Finaliza sin efectos si la configuración es válida.
 * @throws {Error} Con `code` INSECURE_ENVIRONMENT y la lista `violations` cuando hay infracciones.
 */
export function assertSecureEnvironment(environment = process.env) {
  const violations = collectEnvironmentViolations(environment);
  if (violations.length === 0) return;

  const details = violations
    .map(({ code, message, variable }) => `- ${code} [${variable}]: ${message}`)
    .join("\n");
  const error = new Error(`Configuración de entorno insegura; el servicio no se iniciará.\n${details}`);
  error.code = "INSECURE_ENVIRONMENT";
  error.violations = violations;
  throw error;
}
