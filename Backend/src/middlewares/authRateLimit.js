import { AUTH_RATE_LIMIT_POLICIES } from "../config/authRateLimits.js";
import { createSharedRateLimit } from "./sharedRateLimit.js";

/**
 * Crea el middleware de rate limiting compartido de un ámbito de autenticación o de correo de seguridad.
 * Las dimensiones salen de config/authRateLimits.js; el contrato 429/503 es el de sharedRateLimit.js.
 *
 * @param {keyof typeof AUTH_RATE_LIMIT_POLICIES} scope - Ámbito definido en config/authRateLimits.js.
 * @param {object} [options] - Dependencias inyectables para pruebas (consume, resolveVerifiedIp).
 * @returns {import("express").RequestHandler} Middleware de Express.
 * @throws {Error} Si el ámbito no tiene política definida.
 */
export function createAuthRateLimit(scope, options = {}) {
  const policy = AUTH_RATE_LIMIT_POLICIES[scope];
  if (!policy) throw new Error(`Unknown auth rate limit scope: ${scope}`);
  return createSharedRateLimit(scope, policy, options);
}

export const authRateLimits = Object.freeze({
  changePassword: createAuthRateLimit("change-password"),
  login: createAuthRateLimit("login"),
  passwordReset: createAuthRateLimit("password-reset"),
  registration: createAuthRateLimit("registration"),
});

// Envío de correos de seguridad por destinatario. Van después de validar la petición y antes del
// controlador, así que una petición bloqueada nunca consulta la cuenta ni envía correo.
export const emailRateLimits = Object.freeze({
  passwordReset: createAuthRateLimit("email-password-reset"),
  registration: createAuthRateLimit("email-registration"),
});
