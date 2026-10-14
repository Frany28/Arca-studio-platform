import { consumeRateLimit } from "../services/rateLimitService.js";
import { getVerifiedClientIp } from "../utils/verifiedClientIp.js";

// Middleware común de rate limiting compartido entre instancias (hallazgo B-2).
// Contrato 429 idéntico al del limitador en memoria anterior.
const RATE_LIMITED_MESSAGE = "Demasiadas solicitudes. Intenta de nuevo más tarde.";
const UNAVAILABLE_RETRY_AFTER_SECONDS = 30;

/**
 * Crea un middleware que consume las dimensiones de un ámbito en el contador compartido de PostgreSQL.
 * Responde 429 RATE_LIMITED con Retry-After si se supera alguna dimensión, y 503 RATE_LIMIT_UNAVAILABLE
 * si no puede comprobar el límite (fail-closed): en ambos casos la operación no se ejecuta.
 *
 * @param {string} scope - Ámbito del contador; forma parte de la clave HMAC.
 * @param {(req: import("express").Request, verifiedIp: string|null) => Array<object>} resolveDimensions - Dimensiones de la petición.
 * @param {object} [options] - Dependencias inyectables para pruebas.
 * @param {Function} [options.consume] - Consumo del límite compartido.
 * @param {Function} [options.resolveVerifiedIp] - Obtención de la IP verificada.
 * @returns {import("express").RequestHandler} Middleware de Express.
 */
export function createSharedRateLimit(
  scope,
  resolveDimensions,
  { consume = consumeRateLimit, resolveVerifiedIp = getVerifiedClientIp } = {},
) {
  return async function sharedRateLimit(req, res, next) {
    let result;
    try {
      result = await consume(scope, resolveDimensions(req, resolveVerifiedIp(req)));
    } catch (error) {
      console.error(JSON.stringify({ type: "rate_limit_unavailable", scope, code: error?.cause?.code || error?.code || "UNKNOWN" }));
      res.setHeader("Retry-After", String(UNAVAILABLE_RETRY_AFTER_SECONDS));
      res.status(503).json({
        code: "RATE_LIMIT_UNAVAILABLE",
        message: "No se pudo verificar el límite de intentos. Intenta de nuevo en unos segundos.",
        retryAfter: UNAVAILABLE_RETRY_AFTER_SECONDS,
      });
      return;
    }

    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
      res.status(429).json({ code: "RATE_LIMITED", message: RATE_LIMITED_MESSAGE, retryAfter: result.retryAfterSeconds });
      return;
    }
    next();
  };
}
