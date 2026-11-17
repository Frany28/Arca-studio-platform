import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

/*
 * Selección explícita del destino del inventario de almacenamiento (E0). El destino se lee solo del
 * archivo indicado con --env-file y nunca de process.env ni de Backend/.env: así una ejecución no
 * puede apuntar por accidente a la base o al bucket compartidos que use el entorno de desarrollo.
 */

// Raíz del repositorio: ningún archivo de entorno ni informe del inventario puede vivir dentro.
export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const REQUIRED_VARIABLES = Object.freeze([
  "DATABASE_URL",
  "SUPABASE_STORAGE_BUCKET",
  "SUPABASE_STORAGE_S3_ACCESS_KEY_ID",
  "SUPABASE_STORAGE_S3_ENDPOINT",
  "SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY",
]);

/**
 * Indica si una ruta queda dentro de un directorio (o es el propio directorio).
 * Compara rutas absolutas normalizadas y sin distinguir mayúsculas en Windows.
 *
 * @param {string} candidate - Ruta a comprobar.
 * @param {string} directory - Directorio contenedor.
 * @returns {boolean} true si está dentro.
 */
export function isInsideDirectory(candidate, directory) {
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const relative = path.relative(normalize(directory), normalize(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Lee el archivo de entorno indicado explícitamente y devuelve sus variables sin tocar process.env.
 * Rechaza archivos dentro del repositorio (incluido Backend/.env) para evitar destinos compartidos.
 *
 * @param {string|undefined} envFile - Ruta indicada con --env-file.
 * @param {{ repositoryRoot?: string, read?: (file: string) => Promise<string> }} [options] - Raíz y lector.
 * @returns {Promise<Record<string, string>>} Variables del archivo.
 * @throws {Error} Si falta la ruta, está dentro del repositorio o no se puede leer.
 */
export async function loadExplicitEnvironment(envFile, { read = (file) => readFile(file, "utf8"), repositoryRoot = REPOSITORY_ROOT } = {}) {
  if (!envFile) throw new Error("Indica el destino con --env-file <ruta privada fuera del repositorio>.");
  const resolved = path.resolve(envFile);
  if (isInsideDirectory(resolved, repositoryRoot)) {
    throw new Error("El archivo de entorno no puede estar dentro del repositorio (por ejemplo Backend/.env). Copia solo las variables necesarias a una ruta privada.");
  }
  return dotenv.parse(await read(resolved));
}

/**
 * Describe el destino sin secretos: base `nombre@host`, host del almacenamiento y buckets.
 * Es lo que se muestra y lo que deben repetir las confirmaciones antes de cualquier conexión.
 *
 * @param {Record<string, string>} environment - Variables del archivo explícito.
 * @returns {{ database: string, storageHost: string, buckets: { general: string, quotes: string|null },
 *   supabaseUrlConfigured: boolean }} Destino sin credenciales.
 * @throws {Error} Si faltan variables obligatorias o las URLs no son válidas.
 */
export function describeInventoryTarget(environment) {
  const missing = REQUIRED_VARIABLES.filter((name) => !environment[name]);
  if (missing.length) throw new Error(`Faltan variables en el archivo de entorno: ${missing.join(", ")}.`);
  let databaseUrl;
  let endpointUrl;
  try {
    databaseUrl = new URL(environment.DATABASE_URL);
    endpointUrl = new URL(environment.SUPABASE_STORAGE_S3_ENDPOINT);
  } catch {
    throw new Error("DATABASE_URL o SUPABASE_STORAGE_S3_ENDPOINT no son URLs válidas.");
  }
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, "")) || "postgres";
  const databaseHost = databaseUrl.port ? `${databaseUrl.hostname}:${databaseUrl.port}` : databaseUrl.hostname;
  return {
    buckets: {
      general: environment.SUPABASE_STORAGE_BUCKET,
      quotes: environment.SUPABASE_QUOTE_PDF_BUCKET || null,
    },
    database: `${databaseName}@${databaseHost}`,
    storageHost: endpointUrl.port ? `${endpointUrl.hostname}:${endpointUrl.port}` : endpointUrl.hostname,
    supabaseUrlConfigured: Boolean(environment.SUPABASE_URL),
  };
}

/**
 * Exige que las confirmaciones repitan exactamente el destino descrito antes de conectar.
 * Base, host de almacenamiento y la lista completa de buckets deben coincidir.
 *
 * @param {ReturnType<typeof describeInventoryTarget>} target - Destino descrito.
 * @param {{ database?: string, storage?: string, buckets?: string }} confirmations - Valores indicados.
 * @returns {void}
 * @throws {Error} Si falta alguna confirmación o no coincide.
 */
export function assertConfirmedTarget(target, confirmations) {
  const expectedBuckets = [target.buckets.general, target.buckets.quotes].filter(Boolean).sort().join(",");
  const givenBuckets = String(confirmations.buckets || "").split(",").map((value) => value.trim()).filter(Boolean).sort().join(",");
  const problems = [];
  if (confirmations.database !== target.database) problems.push(`--confirm-database debe ser ${target.database}`);
  if (confirmations.storage !== target.storageHost) problems.push(`--confirm-storage debe ser ${target.storageHost}`);
  if (givenBuckets !== expectedBuckets) problems.push(`--confirm-buckets debe ser ${expectedBuckets}`);
  if (problems.length) throw new Error(`Destino no confirmado: ${problems.join("; ")}.`);
}

/**
 * Comprueba que el informe se guarde fuera del repositorio para que nunca se versione.
 * Sin ruta explícita se usa la carpeta privada por defecto, que ya está fuera.
 *
 * @param {string|undefined} reportPath - Ruta indicada con --report.
 * @param {string} [repositoryRoot] - Raíz del repositorio.
 * @returns {void}
 * @throws {Error} Si la ruta está dentro del repositorio.
 */
export function assertReportOutsideRepository(reportPath, repositoryRoot = REPOSITORY_ROOT) {
  if (reportPath && isInsideDirectory(path.resolve(reportPath), repositoryRoot)) {
    throw new Error("El informe no puede guardarse dentro del repositorio.");
  }
}

/**
 * Construye la configuración de conexión al almacenamiento a partir del archivo explícito.
 * Las credenciales solo pasan al inspector de solo lectura; nunca se imprimen ni se registran.
 *
 * @param {Record<string, string>} environment - Variables del archivo explícito.
 * @returns {{ accessKeyId: string, endpoint: string, region: string, secretAccessKey: string }} Conexión.
 */
export function toStorageConnection(environment) {
  return {
    accessKeyId: environment.SUPABASE_STORAGE_S3_ACCESS_KEY_ID,
    endpoint: environment.SUPABASE_STORAGE_S3_ENDPOINT,
    region: environment.SUPABASE_STORAGE_S3_REGION || "us-east-1",
    secretAccessKey: environment.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY,
  };
}
