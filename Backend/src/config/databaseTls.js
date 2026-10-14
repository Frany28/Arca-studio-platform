import { X509Certificate } from "node:crypto";
import { isIP } from "node:net";

// Hosts de loopback: el tráfico no sale de la máquina y, salvo DATABASE_SSL=true,
// se conectan sin TLS (PostgreSQL local o en el mismo servidor).
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// Supabase firma sus certificados con una raíz privada ("Supabase Root 2021 CA")
// que no está en los almacenes públicos; sin su CA la verificación no es posible.
const PRIVATE_CA_HOST_SUFFIXES = [".supabase.com", ".supabase.co"];

// Parámetros TLS que pg-connection-string interpreta desde DATABASE_URL. Como pg
// aplica la URL por encima de la opción `ssl`, cualquiera de ellos podría
// sustituir la configuración: se eliminan siempre y la TLS se define solo con
// DATABASE_SSL, DATABASE_SSL_REJECT_UNAUTHORIZED y DATABASE_SSL_CA_CERT.
const URL_TLS_PARAMETERS = [
  "ssl",
  "sslmode",
  "sslrootcert",
  "sslcert",
  "sslkey",
  "sslcrl",
  "sslpassword",
  "sslnegotiation",
  "uselibpqcompat",
];
const SECURE_URL_SSLMODES = new Set(["require", "verify-ca", "verify-full"]);

const PEM_CERTIFICATE_PATTERN = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

/**
 * Normaliza un valor booleano textual del entorno distinguiendo ausencia de falso.
 * Así un valor no definido conserva el comportamiento por defecto en lugar de desactivarlo.
 *
 * @param {string|undefined} value - Valor crudo de la variable.
 * @returns {boolean|undefined} true/false si la variable es exactamente uno de ellos, o undefined si no se definió.
 */
function parseOptionalBoolean(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "") return undefined;
  return normalized === "true";
}

/**
 * Interpreta DATABASE_URL sin exponer su contenido en errores.
 * Devuelve null en lugar de lanzar para que el llamador informe solo el nombre de la variable.
 *
 * @param {string|undefined} connectionString - Cadena de conexión.
 * @returns {URL|null} URL analizada, o null si no es válida.
 */
function parseConnectionUrl(connectionString) {
  try {
    return new URL(String(connectionString || ""));
  } catch {
    return null;
  }
}

/**
 * Determina si el host de la base es de loopback.
 * Esas conexiones no salen de la máquina y pueden prescindir de TLS salvo que se pida expresamente.
 *
 * @param {string|undefined} connectionString - Cadena de conexión.
 * @returns {boolean} true para localhost, 127.0.0.1 o ::1.
 */
export function isLoopbackDatabase(connectionString) {
  const url = parseConnectionUrl(connectionString);
  return Boolean(url && LOOPBACK_HOSTS.has(url.hostname));
}

/**
 * Determina si el host usa una CA privada conocida (Supabase).
 * Para esos hosts el almacén del sistema no basta y se exige DATABASE_SSL_CA_CERT.
 *
 * @param {URL} url - URL de conexión analizada.
 * @returns {boolean} true si la verificación requiere una CA configurada.
 */
function requiresPrivateCa(url) {
  return PRIVATE_CA_HOST_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix));
}

/**
 * Convierte DATABASE_SSL_CA_CERT en certificados PEM válidos.
 * Acepta saltos de línea reales o escapados como `\n`, que es como suelen guardarse en Vercel.
 *
 * @param {string|undefined} value - Contenido de la variable.
 * @returns {{ pem: string|null, valid: boolean }} PEM normalizado y si todos sus certificados se pudieron analizar.
 */
function parseCaCertificates(value) {
  const normalized = String(value || "").replace(/\\n/g, "\n").trim();
  if (!normalized) return { pem: null, valid: true };
  const blocks = normalized.match(PEM_CERTIFICATE_PATTERN) || [];
  try {
    for (const block of blocks) new X509Certificate(block);
  } catch {
    return { pem: null, valid: false };
  }
  return blocks.length > 0 ? { pem: blocks.join("\n"), valid: true } : { pem: null, valid: false };
}

/**
 * Identifica parámetros TLS de la URL que debilitarían o sustituirían la verificación.
 * Los modos require, verify-ca y verify-full se consideran redundantes y no se informan.
 *
 * @param {URL} url - URL de conexión analizada.
 * @returns {Array<string>} Nombres de los parámetros inseguros presentes (sin sus valores).
 */
function findInsecureUrlTlsParameters(url) {
  const insecure = [];
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode !== null && !SECURE_URL_SSLMODES.has(sslmode.trim().toLowerCase())) insecure.push("sslmode");
  const ssl = url.searchParams.get("ssl");
  if (ssl !== null && !["true", "1"].includes(ssl.trim().toLowerCase())) insecure.push("ssl");
  if (url.searchParams.has("uselibpqcompat")) insecure.push("uselibpqcompat");
  for (const name of ["sslrootcert", "sslcert", "sslkey", "sslcrl", "sslpassword"]) {
    if (url.searchParams.has(name)) insecure.push(name);
  }
  return insecure;
}

/**
 * Evalúa la configuración TLS de PostgreSQL para un entorno desplegado.
 * El llamador decide cuándo aplicarla (ver `config/environment.js`); en local no se invoca.
 *
 * @param {Record<string, string|undefined>} [environment] - Variables de entorno a evaluar.
 * @returns {Array<{ code: string, variable: string, message: string }>} Infracciones encontradas, sin valores.
 */
export function collectDatabaseTlsViolations(environment = process.env) {
  if (!environment.DATABASE_URL) return [];
  const url = parseConnectionUrl(environment.DATABASE_URL);
  if (!url) {
    return [{ code: "DATABASE_URL_INVALID", message: "No es una URL de conexión válida.", variable: "DATABASE_URL" }];
  }

  const violations = [];
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  const sslEnabled = parseOptionalBoolean(environment.DATABASE_SSL);

  if (sslEnabled === false && !loopback) {
    violations.push({
      code: "DATABASE_TLS_DISABLED",
      message: "Una base remota debe usar TLS; DATABASE_SSL=false solo se admite con loopback.",
      variable: "DATABASE_SSL",
    });
  }

  if (parseOptionalBoolean(environment.DATABASE_SSL_REJECT_UNAUTHORIZED) === false) {
    violations.push({
      code: "DATABASE_TLS_VERIFICATION_DISABLED",
      message: "La verificación del certificado no puede desactivarse en un entorno desplegado.",
      variable: "DATABASE_SSL_REJECT_UNAUTHORIZED",
    });
  }

  const insecureParameters = findInsecureUrlTlsParameters(url);
  if (insecureParameters.length > 0) {
    violations.push({
      code: "DATABASE_URL_TLS_INSECURE",
      message: `Parámetros TLS no admitidos en la URL (${insecureParameters.join(", ")}); usar DATABASE_SSL_CA_CERT.`,
      variable: "DATABASE_URL",
    });
  }

  const ca = parseCaCertificates(environment.DATABASE_SSL_CA_CERT);
  if (!ca.valid) {
    violations.push({
      code: "DATABASE_SSL_CA_INVALID",
      message: "Debe contener uno o más certificados PEM válidos.",
      variable: "DATABASE_SSL_CA_CERT",
    });
  } else if (!ca.pem && requiresPrivateCa(url) && !(sslEnabled === false && loopback)) {
    violations.push({
      code: "DATABASE_SSL_CA_REQUIRED",
      message: "Supabase usa una CA privada; configurar el certificado CA del proyecto.",
      variable: "DATABASE_SSL_CA_CERT",
    });
  }

  return violations;
}

/**
 * Elimina de la URL los parámetros TLS para que pg no sustituya la opción `ssl`.
 * Si no hay parámetros TLS, devuelve la cadena original sin reconstruirla.
 *
 * @param {string} connectionString - Cadena de conexión original.
 * @returns {{ connectionString: string, removed: Array<string> }} Cadena resultante y parámetros eliminados.
 */
function stripUrlTlsParameters(connectionString) {
  const url = parseConnectionUrl(connectionString);
  const removed = url ? URL_TLS_PARAMETERS.filter((name) => url.searchParams.has(name)) : [];
  if (removed.length === 0) return { connectionString, removed };
  for (const name of removed) url.searchParams.delete(name);
  return { connectionString: url.toString(), removed };
}

/**
 * Resuelve la conexión de pg con una política TLS única que la URL no puede alterar.
 * Desplegado: TLS obligatorio y certificado verificado (CA configurada o almacén del sistema); cualquier
 * infracción lanza un error. Local: sin TLS en loopback; con una base remota verifica si hay CA o si se
 * pide expresamente, y si no conecta sin verificar avisándolo.
 *
 * @param {Record<string, string|undefined>} [environment] - Variables de entorno.
 * @param {{ local: boolean }} options - Si el proceso es un entorno local de desarrollo o pruebas.
 * @returns {{ connectionString: string, ssl: false|object, warnings: Array<string> }} Opciones para `pg.Pool`.
 * @throws {Error} Con `code` DATABASE_TLS_INSECURE y `violations` si un entorno desplegado no es seguro.
 */
export function resolveDatabaseConnection(environment = process.env, { local }) {
  const warnings = [];
  if (!local) {
    const violations = collectDatabaseTlsViolations(environment);
    if (violations.length > 0) {
      const error = new Error(`Configuración TLS de PostgreSQL insegura: ${violations.map(({ code, variable }) => `${code} [${variable}]`).join(", ")}.`);
      error.code = "DATABASE_TLS_INSECURE";
      error.violations = violations;
      throw error;
    }
  }

  const { connectionString, removed } = stripUrlTlsParameters(environment.DATABASE_URL);
  if (removed.length > 0) {
    warnings.push(`Se ignoraron parámetros TLS de DATABASE_URL (${removed.join(", ")}); la TLS se configura con DATABASE_SSL*.`);
  }

  const sslSetting = parseOptionalBoolean(environment.DATABASE_SSL);
  if (sslSetting === false || (isLoopbackDatabase(connectionString) && sslSetting !== true)) {
    return { connectionString, ssl: false, warnings };
  }

  const identity = getIpIdentity(connectionString);
  const ca = parseCaCertificates(environment.DATABASE_SSL_CA_CERT);
  if (ca.pem) return { connectionString, ssl: { ca: ca.pem, rejectUnauthorized: true, ...identity }, warnings };
  if (!ca.valid) warnings.push("DATABASE_SSL_CA_CERT no contiene certificados PEM válidos y se ignoró.");

  const verify = !local || parseOptionalBoolean(environment.DATABASE_SSL_REJECT_UNAUTHORIZED) === true;
  if (!verify) {
    warnings.push("TLS de PostgreSQL sin verificar el certificado (solo desarrollo local). Configurar DATABASE_SSL_CA_CERT para verificarlo.");
  }
  return { connectionString, ssl: { rejectUnauthorized: verify, ...(verify ? identity : {}) }, warnings };
}

/**
 * Fija la identidad esperada cuando la base se direcciona por IP.
 * pg solo envía `servername` para nombres DNS; con una IP, Node compararía el certificado con
 * "localhost" por defecto. Pasar `host` hace que la verificación use la IP real.
 *
 * @param {string} connectionString - Cadena de conexión ya depurada.
 * @returns {{ host?: string }} Opción `host` para TLS si el host es una IP; objeto vacío en otro caso.
 */
function getIpIdentity(connectionString) {
  const url = parseConnectionUrl(connectionString);
  const host = url ? url.hostname.replace(/^\[|\]$/g, "") : "";
  return isIP(host) ? { host } : {};
}
