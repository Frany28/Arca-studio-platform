import { AUTH_RATE_LIMIT_POLICIES } from "../config/authRateLimits.js";
import { consumeRateLimit } from "../services/rateLimitService.js";
import { getVerifiedClientIp } from "../utils/verifiedClientIp.js";

// Contrato 429 idéntico al del limitador en memoria (src/middlewares/rateLimit.js).
const RATE_LIMITED_MESSAGE = "Demasiadas solicitudes. Intenta de nuevo más tarde.";
const UNAVAILABLE_RETRY_AFTER_SECONDS = 30;

/**
 * Crea el middleware de rate limiting compartido de un ámbito de autenticación (hallazgo B-2).
 * Responde 429 RATE_LIMITED con Retry-After si se supera alguna dimensión, y 503 RATE_LIMIT_UNAVAILABLE
 * si PostgreSQL no permite comprobar el límite: la protección nunca se omite en silencio.
 *
 * @param {keyof typeof AUTH_RATE_LIMIT_POLICIES} scope - Ámbito definido en config/authRateLimits.js.
 * @param {object} [options] - Dependencias inyectables para pruebas.
 * @param {Function} [options.consume] - Consumo del límite compartido.
 * @param {Function} [options.resolveVerifiedIp] - Obtención de la IP verificada.
 * @returns {import("express").RequestHandler} Middleware de Express.
 * @throws {Error} Si el ámbito no tiene política definida.
 */
export function createAuthRateLimit(scope, { consume = consumeRateLimit, resolveVerifiedIp = getVerifiedClientIp } = {}) {
  const policy = AUTH_RATE_LIMIT_POLICIES[scope];
  if (!policy) throw new Error(`Unknown auth rate limit scope: ${scope}`);

  return async function authRateLimit(req, res, next) {
    let result;
    try {
      result = await consume(scope, policy(req, resolveVerifiedIp(req)));
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

export const authRateLimits = Object.freeze({
  changePassword: createAuthRateLimit("change-password"),
  login: createAuthRateLimit("login"),
  passwordReset: createAuthRateLimit("password-reset"),
  registration: createAuthRateLimit("registration"),
});
