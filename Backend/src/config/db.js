import pg from "pg";
import { isLoopbackDatabase, resolveDatabaseConnection } from "./databaseTls.js";
import { isConnectionLossError, isTransientDatabaseError, markDatabaseError } from "./databaseErrors.js";
import { isLocalRuntime } from "./environment.js";

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

// La URL nunca decide la TLS: resolveDatabaseConnection elimina sus parámetros
// TLS y aplica una política única. En un entorno desplegado una configuración
// insegura lanza aquí, antes de crear el pool; en local se avisa por consola.
const databaseConnection = resolveDatabaseConnection(process.env, {
  local: isLocalRuntime(process.env),
});
for (const warning of databaseConnection.warnings) {
  console.warn(JSON.stringify({ type: "database_tls_warning", message: warning }));
}

/**
 * Determina si el valor de serverless runtime cumple la condición esperada.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @returns {boolean} Resultado producido por la operación.
 */
function isServerlessRuntime() {
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.FUNCTIONS_WORKER_RUNTIME,
  );
}

/**
 * Obtiene el valor de pool max para que el flujo llamador pueda continuar.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @returns {unknown} Resultado producido por la operación.
 */
function getPoolMax() {
  const configured = Number(process.env.DATABASE_POOL_MAX);
  if (Number.isInteger(configured) && configured > 0) {
    return configured;
  }

  // Serverless instances scale horizontally. Keeping a large pool per instance
  // can exhaust the database connection limit during traffic bursts.
  if (isServerlessRuntime()) {
    return 1;
  }

  return isLoopbackDatabase(databaseUrl) ? 10 : 2;
}

/**
 * Obtiene el valor de idle timeout ms para que el flujo llamador pueda continuar.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @returns {unknown} Resultado producido por la operación.
 */
function getIdleTimeoutMs() {
  const configured = Number(process.env.DATABASE_IDLE_TIMEOUT_MS);

  if (Number.isFinite(configured) && configured >= 0) {
    return configured;
  }

  return isServerlessRuntime() ? 5000 : 30000;
}

/**
 * Lee un entero no negativo de configuración con un valor por defecto.
 * Los valores ausentes o no válidos usan el predeterminado para no desactivar la protección.
 *
 * @param {string} name - Variable de entorno.
 * @param {number} fallback - Valor por defecto.
 * @returns {number} Valor configurado.
 */
function nonNegativeIntegerSetting(name, fallback) {
  const value = Number(process.env[name]);
  return process.env[name] !== undefined && process.env[name] !== "" && Number.isInteger(value) && value >= 0
    ? value
    : fallback;
}

// Saturación (P1-2): peticiones que pueden esperar una conexión a la vez. Por encima se responde 503
// enseguida en lugar de acumular esperas de connectionTimeoutMillis que agravan el pico. El valor por
// defecto admite ráfagas legítimas de consultas rápidas (rateLimitStore.integration prueba 60
// simultáneas); ajustarlo con las mediciones de carga. 0 desactiva el límite.
const DATABASE_MAX_WAITING = nonNegativeIntegerSetting("DATABASE_MAX_WAITING", 200);
// Espera aleatoria antes del único reintento de una lectura tras un corte de conexión.
const RETRY_BACKOFF_MIN_MS = 100;
const RETRY_BACKOFF_JITTER_MS = 200;

export { isTransientDatabaseError };

/**
 * Determina si el valor de read only query cumple la condición esperada.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @param {string} text - Valor de `text` requerido por esta operación.
 * @returns {boolean} Resultado producido por la operación.
 */
export function isReadOnlyQuery(text) {
  return String(text).trimStart().toLowerCase().startsWith("select");
}

export const pool = new Pool({
  connectionString: databaseConnection.connectionString,
  ssl: databaseConnection.ssl,
  max: getPoolMax(),
  allowExitOnIdle: isServerlessRuntime(),
  idleTimeoutMillis: getIdleTimeoutMs(),
  connectionTimeoutMillis: Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS || 5000),
  statement_timeout: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS || 10000),
  query_timeout: Number(process.env.DATABASE_QUERY_TIMEOUT_MS || 12000),
});

// pg-pool emite `error` cuando falla una conexión inactiva (reinicio de la base, cierre del pooler).
// Sin oyente, ese evento terminaría el proceso; el pool ya descarta la conexión rota.
pool.on("error", (error) => {
  console.warn(JSON.stringify({
    code: error?.code || "UNKNOWN",
    pool: getPoolStats(),
    type: "database_idle_client_error",
  }));
});

/**
 * Rechaza la petición si ya hay demasiadas esperando una conexión del pool.
 * Responder 503 enseguida evita que las esperas se acumulen y afecten a las peticiones posteriores.
 *
 * @returns {void}
 * @throws {Error} Con `code` POOL_QUEUE_FULL cuando la cola alcanza DATABASE_MAX_WAITING.
 */
function assertPoolCapacity() {
  if (DATABASE_MAX_WAITING > 0 && pool.waitingCount >= DATABASE_MAX_WAITING) {
    throw markDatabaseError(Object.assign(new Error("Database pool queue is full"), { code: "POOL_QUEUE_FULL" }));
  }
}

/**
 * Espera un tiempo aleatorio acotado antes de reintentar una lectura.
 * La variación evita que muchas peticiones reintenten a la vez tras un mismo corte.
 *
 * @returns {Promise<void>}
 */
function waitBeforeRetry() {
  const delayMs = RETRY_BACKOFF_MIN_MS + Math.floor(Math.random() * RETRY_BACKOFF_JITTER_MS);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Ejecuta el valor de query y registra la información operativa relevante.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @param {string} text - Valor de `text` requerido por esta operación.
 * @param {unknown} params - Valor de `params` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
function executeQuery(text, params) {
  assertPoolCapacity();
  const startedAt = process.hrtime.bigint();
  return pool.query(text, params).catch((error) => { throw markDatabaseError(error); }).finally(() => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const threshold = Number(process.env.DATABASE_SLOW_QUERY_MS || 500);
    if (durationMs >= threshold) {
      console.warn(JSON.stringify({
        type: "slow_query",
        durationMs: Number(durationMs.toFixed(2)),
        operation: String(text).trim().split(/\s+/)[0]?.toUpperCase() || "UNKNOWN",
        pool: getPoolStats(),
        timestamp: new Date().toISOString(),
      }));
    }
  });
}

/**
 * Procesa el valor de query para completar la responsabilidad asignada al módulo.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @param {string} text - Valor de `text` requerido por esta operación.
 * @param {unknown} params - Valor de `params` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function query(text, params) {
  try {
    return await executeQuery(text, params);
  } catch (error) {
    // Un solo reintento, con espera aleatoria, y solo para lecturas tras un corte de conexión.
    // La saturación (pool agotado, statement_timeout, demasiadas conexiones) no se repite: se
    // propaga para responder 503. Las escrituras nunca se repiten.
    if (!isReadOnlyQuery(text) || !isConnectionLossError(error)) throw error;
    console.warn(JSON.stringify({
      type: "database_query_retry",
      code: error?.code || "CONNECTION_ERROR",
      operation: String(text).trim().split(/\s+/)[0]?.toUpperCase() || "UNKNOWN",
      pool: getPoolStats(),
      timestamp: new Date().toISOString(),
    }));
    await waitBeforeRetry();
    return executeQuery(text, params);
  }
}

/**
 * Ejecuta una unidad de trabajo dentro de una transacción con un cliente dedicado del pool.
 * Confirma solo si `work` termina sin errores; ante cualquier error revierte, libera el
 * cliente y propaga el error original aunque falle el ROLLBACK. No reintenta escrituras.
 *
 * @template T
 * @param {(client: import("pg").PoolClient) => Promise<T>} work - Operaciones que comparten la transacción.
 * @returns {Promise<T>} Resultado devuelto por `work` tras el COMMIT.
 * @throws {Error} El error de `work`, de BEGIN o de COMMIT.
 */
export async function withTransaction(work) {
  assertPoolCapacity();
  const client = await pool.connect().catch((error) => { throw markDatabaseError(error); });
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Obtiene las estadísticas del pool de PostgreSQL para que el flujo llamador pueda continuar.
 * Centraliza esta decisión para mantener consistente la configuración del backend.
 *
 * @returns {object} Resultado producido por la operación.
 */
export function getPoolStats() {
  return { idle: pool.idleCount, total: pool.totalCount, waiting: pool.waitingCount };
}
