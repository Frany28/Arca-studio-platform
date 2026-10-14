import { deleteExpiredRateLimitBuckets, incrementRateLimitBuckets } from "../repositories/rateLimitRepository.js";
import { hashRateLimitKey } from "../utils/rateLimitKey.js";

// La limpieza de contadores caducados se dispara en una fracción de las peticiones y nunca se
// espera: no añade latencia y, si falla, solo se registra (los contadores caducados se reinician
// igualmente en la siguiente consulta, así que no afectan a la protección).
const CLEANUP_PROBABILITY = 0.02;
const CLEANUP_BATCH_SIZE = 500;

/**
 * Lanza, con una probabilidad baja, una limpieza por lotes de contadores caducados sin bloquear la petición.
 * Los errores se registran y se descartan de forma deliberada: la limpieza es mantenimiento, no protección.
 *
 * @param {object} [options] - Dependencias inyectables.
 * @param {() => number} [options.random] - Generador aleatorio.
 * @param {Function} [options.deleteExpired] - Implementación de la limpieza.
 * @returns {void}
 */
export function scheduleRateLimitCleanup({ random = Math.random, deleteExpired = deleteExpiredRateLimitBuckets } = {}) {
  if (random() >= CLEANUP_PROBABILITY) return;
  Promise.resolve()
    .then(() => deleteExpired({ limit: CLEANUP_BATCH_SIZE }))
    .catch((error) => {
      console.warn(JSON.stringify({ type: "rate_limit_cleanup_failed", code: error?.code || "UNKNOWN" }));
    });
}

/**
 * Consume un intento en cada dimensión de un ámbito y decide si la petición puede continuar.
 * Cada dimensión se identifica con una clave HMAC; todas se incrementan en una única operación atómica
 * compartida por las instancias del backend. Se bloquea si cualquiera supera su máximo.
 *
 * @param {string} scope - Ámbito del límite (login, registration, password-reset, change-password…).
 * @param {Array<{ name: string, parts: Array<string|number>, max: number, windowMs: number }>} dimensions - Dimensiones a contar.
 * @param {object} [options] - Dependencias inyectables.
 * @param {Function} [options.incrementBuckets] - Implementación del contador compartido.
 * @param {Function} [options.scheduleCleanup] - Limpieza de contadores caducados.
 * @returns {Promise<{ allowed: boolean, retryAfterSeconds: number, exceeded: Array<string> }>} Resultado del límite.
 * @throws {Error} Con code RATE_LIMIT_STORE_UNAVAILABLE si no se pudo comprobar el límite.
 */
export async function consumeRateLimit(
  scope,
  dimensions,
  { incrementBuckets = incrementRateLimitBuckets, scheduleCleanup = scheduleRateLimitCleanup } = {},
) {
  const unique = [...new Map(dimensions.map((dimension) => [dimension.name, dimension])).values()];
  if (unique.length === 0) return { allowed: true, exceeded: [], retryAfterSeconds: 0 };

  const buckets = unique.map((dimension) => ({
    dimension,
    keyHash: hashRateLimitKey(scope, dimension.name, dimension.parts),
  }));

  let rows;
  try {
    rows = await incrementBuckets(buckets.map(({ dimension, keyHash }) => ({ keyHash, scope, windowMs: dimension.windowMs })));
  } catch (error) {
    throw Object.assign(new Error("Rate limit store unavailable"), { cause: error, code: "RATE_LIMIT_STORE_UNAVAILABLE" });
  }

  const byKey = new Map(rows.map((row) => [row.keyHash.toString("hex"), row]));
  const exceeded = [];
  let retryAfterMs = 0;
  for (const { dimension, keyHash } of buckets) {
    const row = byKey.get(keyHash.toString("hex"));
    if (!row) {
      throw Object.assign(new Error("Rate limit store returned an incomplete result"), { code: "RATE_LIMIT_STORE_UNAVAILABLE" });
    }
    if (row.count > dimension.max) {
      exceeded.push(dimension.name);
      retryAfterMs = Math.max(retryAfterMs, row.retryAfterMs);
    }
  }

  scheduleCleanup();
  return {
    allowed: exceeded.length === 0,
    exceeded,
    retryAfterSeconds: exceeded.length === 0 ? 0 : Math.max(1, Math.ceil(retryAfterMs / 1000)),
  };
}
