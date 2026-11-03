// Comprobaciones de aislamiento del entorno de pruebas de carga (Fase 3).
//
// Se ejecutan antes de sembrar datos, de arrancar el backend y de comprobar integridad. Si cualquier
// conexión apunta a infraestructura real (Supabase, buckets reales, Resend, Geoapify, dominios
// públicos) o el entorno no está marcado como de pruebas de carga, el proceso se detiene sin tocar
// nada. Las reglas son listas de permitidos: un valor ausente o desconocido se rechaza.
//
// Uso desde la línea de comandos: node load-tests/env/isolation.mjs [--expect-no-egress]
import { pathToFileURL } from "node:url";

// Hosts permitidos: la propia máquina o los servicios de docker-compose.loadtest.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres", "minio", "backend"]);
const DATABASE_NAME_PREFIX = "arca_loadtest";
const BUCKET_PREFIX = "arca-loadtest";
const ACCOUNT_DOMAIN = "@loadtest.invalid";
// Variables que activarían servicios externos reales: deben estar vacías.
const EXTERNAL_SERVICE_VARIABLES = ["RESEND_API_KEY", "GEOAPIFY_API_KEY", "VITE_GEOAPIFY_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NETLIFY_PROXY_SIGNATURE_SECRET"];
const FORBIDDEN_VALUE_PATTERN = /supabase\.(co|com)|pooler\.supabase|amazonaws\.com|resend\.com|geoapify\.com|vercel\.app|netlify\.app|arcastudio/i;
const CONNECTION_VARIABLE_PATTERN = /^(DATABASE_|DIRECT_URL|SUPABASE_|RESEND_|GEOAPIFY_|VITE_|MAIL_|FRONTEND_|CORS_|BASE_URL|PUBLIC_APP_URL|APP_URL|AWS_|S3_)/;

/**
 * Interpreta una URL sin lanzar; devuelve null si no es válida.
 *
 * @param {string|undefined} value - Valor a interpretar.
 * @returns {URL|null} URL o null.
 */
function parseUrl(value) {
  try {
    return new URL(String(value || ""));
  } catch {
    return null;
  }
}

/**
 * Indica si el host de una URL es local o un servicio del entorno de pruebas.
 *
 * @param {URL|null} url - URL analizada.
 * @returns {boolean} true si es local.
 */
function isLocalUrl(url) {
  return Boolean(url && LOCAL_HOSTS.has(url.hostname));
}

/**
 * Reúne las infracciones de aislamiento del entorno del backend o de las herramientas.
 * No devuelve valores de variables, solo sus nombres y el motivo.
 *
 * @param {Record<string, string|undefined>} [environment] - Variables a evaluar.
 * @param {{ requireStorage?: boolean }} [options] - Exige también almacenamiento S3 local.
 * @returns {Array<string>} Infracciones encontradas.
 */
export function collectIsolationViolations(environment = process.env, { requireStorage = true } = {}) {
  const violations = [];
  const database = parseUrl(environment.DATABASE_URL);
  if (!database) violations.push("DATABASE_URL: falta o no es una URL válida.");
  else {
    if (!isLocalUrl(database)) violations.push("DATABASE_URL: el host no es local ni el servicio postgres del entorno.");
    if (!database.pathname.replace(/^\//, "").startsWith(DATABASE_NAME_PREFIX)) {
      violations.push(`DATABASE_URL: la base debe llamarse ${DATABASE_NAME_PREFIX}*.`);
    }
  }
  if (environment.DIRECT_URL) {
    const direct = parseUrl(environment.DIRECT_URL);
    if (!isLocalUrl(direct)) violations.push("DIRECT_URL: debe estar vacía o ser local.");
  }
  if (environment.SUPABASE_URL) violations.push("SUPABASE_URL: debe estar vacía en el entorno de carga.");

  if (requireStorage) {
    const storage = parseUrl(environment.SUPABASE_STORAGE_S3_ENDPOINT);
    if (!isLocalUrl(storage)) violations.push("SUPABASE_STORAGE_S3_ENDPOINT: debe apuntar a MinIO local.");
    if (!String(environment.SUPABASE_STORAGE_BUCKET || "").startsWith(BUCKET_PREFIX)) {
      violations.push(`SUPABASE_STORAGE_BUCKET: debe llamarse ${BUCKET_PREFIX}*.`);
    }
  }

  for (const name of EXTERNAL_SERVICE_VARIABLES) {
    if (String(environment[name] || "").trim()) violations.push(`${name}: debe estar vacía (sin servicios externos reales).`);
  }
  if (!String(environment.AUTH_TOKEN_SECRET || "").includes("loadtest")) {
    violations.push("AUTH_TOKEN_SECRET: debe ser un secreto ficticio del entorno de carga (contener «loadtest»).");
  }
  if (String(environment.ARCA_LOADTEST || "") !== "1") violations.push("ARCA_LOADTEST: debe valer 1 para confirmar el entorno aislado.");

  // Solo las variables que configuran conexiones: las del sistema (PATH, rutas) no son relevantes.
  for (const [name, value] of Object.entries(environment)) {
    if (!CONNECTION_VARIABLE_PATTERN.test(name)) continue;
    if (value && FORBIDDEN_VALUE_PATTERN.test(String(value))) violations.push(`${name}: apunta a un dominio o servicio real.`);
  }
  return violations;
}

/**
 * Comprueba que una URL de destino de las pruebas (BASE_URL) es local.
 *
 * @param {string|undefined} baseUrl - URL del backend bajo prueba.
 * @returns {Array<string>} Infracciones.
 */
export function collectTargetViolations(baseUrl) {
  const url = parseUrl(baseUrl);
  return isLocalUrl(url) ? [] : ["BASE_URL: las pruebas solo pueden dirigirse a localhost o al servicio backend del entorno."];
}

/**
 * Comprueba que las cuentas de prueba son ficticias (dominio reservado .invalid).
 * Impide usar cuentas reales o las credenciales de demostración compartidas.
 *
 * @param {Array<{ email: string }>} accounts - Cuentas.
 * @returns {Array<string>} Infracciones.
 */
export function collectAccountViolations(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) return ["Cuentas: el archivo está vacío."];
  const invalid = accounts.filter((account) => !String(account?.email || "").toLowerCase().endsWith(ACCOUNT_DOMAIN));
  return invalid.length ? [`Cuentas: ${invalid.length} no usan el dominio ficticio ${ACCOUNT_DOMAIN}.`] : [];
}

/**
 * Detiene el proceso con la lista de infracciones si las hay.
 *
 * @param {Array<string>} violations - Infracciones.
 * @param {string} context - Paso que se iba a ejecutar.
 * @returns {void}
 */
export function failOnViolations(violations, context) {
  if (violations.length === 0) return;
  console.error(`Entorno no aislado; ${context} cancelado:\n- ${violations.join("\n- ")}`);
  process.exit(2);
}

/**
 * Comprueba que no hay salida a internet (dentro de la red interna de docker-compose).
 * Solo resuelve nombres por DNS, sin conectarse a ningún servicio: en una red interna los nombres
 * externos no se resuelven; si se resuelven, la red tiene salida y se cancela el arranque.
 *
 * @returns {Promise<Array<string>>} Infracciones.
 */
export async function collectEgressViolations() {
  const { lookup } = await import("node:dns/promises");
  const violations = [];
  for (const hostname of ["api.resend.com", "api.geoapify.com", "supabase.co"]) {
    const resolved = await Promise.race([
      lookup(hostname).then(() => true, () => false),
      new Promise((resolve) => setTimeout(() => resolve(false), 3000).unref()),
    ]);
    if (resolved) violations.push(`Salida a internet disponible: ${hostname} se resuelve por DNS.`);
  }
  return violations;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const violations = collectIsolationViolations();
  if (process.argv.includes("--expect-no-egress")) violations.push(...await collectEgressViolations());
  failOnViolations(violations, "el arranque");
  console.log(JSON.stringify({ type: "loadtest_isolation_ok" }));
}
