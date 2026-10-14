import { authConfig } from "./auth.js";
import { normalizeEmailIdentity } from "../utils/rateLimitKey.js";

// Políticas de rate limiting de autenticación (hallazgo B-2), compartidas entre instancias.
//
// Dimensiones aprobadas:
//   - cuenta + IP verificada: AUTH_LOGIN_RATE_LIMIT_MAX / AUTH_LOGIN_RATE_LIMIT_WINDOW_MS (5 / 15 min);
//   - cuenta: 20 / hora;
//   - IP verificada: 30 / 15 min.
// La cuenta es el correo normalizado o, en los pasos con enlace de correo, el token recibido.
//
// Sin IP verificada (mientras no esté activo el proxy firmado de Netlify) solo se aplica la dimensión
// de cuenta: nunca se usa req.ip, que detrás de Netlify es la misma para todos los usuarios y
// produciría bloqueos colectivos. Una petición sin cuenta reconocible ni IP verificada no consume
// contador; los controladores la rechazan antes de cualquier operación costosa.

export const AUTH_RATE_LIMIT_DIMENSIONS = Object.freeze({
  account: Object.freeze({ max: 20, windowMs: 60 * 60 * 1000 }),
  accountIp: Object.freeze({ max: authConfig.loginRateLimitMax, windowMs: authConfig.loginRateLimitWindowMs }),
  ip: Object.freeze({ max: 30, windowMs: 15 * 60 * 1000 }),
});

/**
 * Identifica la cuenta afectada por un token de enlace (registro o recuperación).
 * El token solo se usa como entrada del HMAC; nunca se almacena.
 *
 * @param {unknown} value - Token recibido en el cuerpo.
 * @returns {string|null} Identidad con prefijo, o null si no es utilizable.
 */
function tokenIdentity(value) {
  return typeof value === "string" && value.trim().length >= 10 && value.length <= 4096 ? `token:${value.trim()}` : null;
}

/**
 * Identifica la cuenta por correo normalizado.
 * Mayúsculas y espacios no generan contadores distintos para la misma cuenta.
 *
 * @param {unknown} value - Correo recibido en el cuerpo.
 * @returns {string|null} Identidad con prefijo, o null si no es utilizable.
 */
function emailIdentity(value) {
  const email = normalizeEmailIdentity(value);
  return email ? `email:${email}` : null;
}

/**
 * Construye las dimensiones aprobadas para una identidad y una IP verificada opcional.
 * Sin IP verificada solo devuelve la dimensión de cuenta, para no agrupar a usuarios distintos.
 *
 * @param {string|null} identity - Cuenta (correo o token) o null.
 * @param {string|null} verifiedIp - IP verificada o null.
 * @returns {Array<{ name: string, parts: Array<string>, max: number, windowMs: number }>} Dimensiones a contar.
 */
function identityDimensions(identity, verifiedIp) {
  const { account, accountIp, ip } = AUTH_RATE_LIMIT_DIMENSIONS;
  const dimensions = [];
  if (identity) dimensions.push({ name: "account", parts: [identity], ...account });
  if (identity && verifiedIp) dimensions.push({ name: "account-ip", parts: [identity, verifiedIp], ...accountIp });
  if (verifiedIp) dimensions.push({ name: "ip", parts: [verifiedIp], ...ip });
  return dimensions;
}

/**
 * Dimensiones del inicio de sesión: la cuenta es el correo enviado.
 * Con IP verificada añade cuenta + IP (límite estricto) e IP (abuso entre cuentas).
 *
 * @param {import("express").Request} req - Petición de login.
 * @param {string|null} verifiedIp - IP verificada o null.
 * @returns {Array<object>} Dimensiones a contar.
 */
function loginDimensions(req, verifiedIp) {
  return identityDimensions(emailIdentity(req.body?.email), verifiedIp);
}

/**
 * Dimensiones de registro y de recuperación: la cuenta es el correo o, en los pasos del enlace, el token.
 * Un token aleatorio no comparte contador con otro, por lo que frente a tokens inventados protege la IP.
 *
 * @param {import("express").Request} req - Petición de registro o recuperación.
 * @param {string|null} verifiedIp - IP verificada o null.
 * @returns {Array<object>} Dimensiones a contar.
 */
function emailOrTokenDimensions(req, verifiedIp) {
  return identityDimensions(emailIdentity(req.body?.email) || tokenIdentity(req.body?.token), verifiedIp);
}

/**
 * Dimensiones del cambio de contraseña: la identidad es el usuario autenticado.
 * Un tercero no puede consumir este contador sin la sesión, así que se aplica el límite estricto
 * (cuenta + IP) aunque no haya IP verificada, sin riesgo de bloqueo malicioso.
 *
 * @param {import("express").Request} req - Petición autenticada.
 * @param {string|null} verifiedIp - IP verificada o null.
 * @returns {Array<object>} Dimensiones a contar.
 */
function changePasswordDimensions(req, verifiedIp) {
  const { accountIp, ip } = AUTH_RATE_LIMIT_DIMENSIONS;
  return [
    { name: "user", parts: [`user:${req.user?.id}`], ...accountIp },
    ...(verifiedIp ? [{ name: "ip", parts: [verifiedIp], ...ip }] : []),
  ];
}

// Ámbitos separados: un flujo no consume el límite de otro.
export const AUTH_RATE_LIMIT_POLICIES = Object.freeze({
  "change-password": changePasswordDimensions,
  login: loginDimensions,
  "password-reset": emailOrTokenDimensions,
  registration: emailOrTokenDimensions,
});
