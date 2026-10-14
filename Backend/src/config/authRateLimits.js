import { authConfig } from "./auth.js";
import { normalizeEmailIdentity, normalizeEmailRecipient } from "../utils/rateLimitKey.js";
import { verifyAuthToken } from "../utils/tokens.js";

// Políticas de rate limiting de autenticación y correos de seguridad (hallazgo B-2), compartidas
// entre instancias mediante PostgreSQL.
//
// Dimensiones de autenticación aprobadas:
//   - cuenta + IP verificada: AUTH_LOGIN_RATE_LIMIT_MAX / AUTH_LOGIN_RATE_LIMIT_WINDOW_MS (5 / 15 min);
//   - cuenta: 20 / hora;
//   - IP verificada: 30 / 15 min.
// La cuenta es el correo normalizado o, en los pasos con enlace de correo, un token con firma válida.
//
// Correos de seguridad (por destinatario, con alias de Gmail unificados):
//   - registro (inicio y reenvío comparten límite): EMAIL_REGISTRATION_RATE_LIMIT_* (5 / hora);
//   - recuperación de contraseña: EMAIL_PASSWORD_RESET_RATE_LIMIT_* (5 / hora).
// Las futuras notificaciones de proyectos tendrán políticas propias y no usan estos límites.
//
// Sin IP verificada (mientras no esté activo el proxy firmado de Netlify) nunca se usa req.ip, que
// detrás de Netlify es la misma para todos los usuarios y produciría bloqueos colectivos. Una petición
// sin cuenta reconocible ni IP verificada no consume contador limitante; los controladores la rechazan
// antes de cualquier operación costosa.
//
// Detección de anomalías: cada ámbito suma además un contador de observación global que nunca bloquea
// y genera un registro estructurado al alcanzar su umbral (ver services/rateLimitService.js).

const HOUR_MS = 60 * 60 * 1000;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Lee un entero positivo de configuración con un valor por defecto.
 * Los valores ausentes, no numéricos o no positivos usan el predeterminado para no desactivar el límite.
 *
 * @param {string} name - Variable de entorno.
 * @param {number} fallback - Valor por defecto.
 * @returns {number} Valor configurado.
 */
function positiveIntegerSetting(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export const AUTH_RATE_LIMIT_DIMENSIONS = Object.freeze({
  account: Object.freeze({ max: 20, windowMs: HOUR_MS }),
  accountIp: Object.freeze({ max: authConfig.loginRateLimitMax, windowMs: authConfig.loginRateLimitWindowMs }),
  ip: Object.freeze({ max: 30, windowMs: FIFTEEN_MINUTES_MS }),
});

export const EMAIL_RATE_LIMITS = Object.freeze({
  passwordReset: Object.freeze({
    max: positiveIntegerSetting("EMAIL_PASSWORD_RESET_RATE_LIMIT_MAX", 5),
    windowMs: positiveIntegerSetting("EMAIL_PASSWORD_RESET_RATE_LIMIT_WINDOW_MS", HOUR_MS),
  }),
  registration: Object.freeze({
    max: positiveIntegerSetting("EMAIL_REGISTRATION_RATE_LIMIT_MAX", 5),
    windowMs: positiveIntegerSetting("EMAIL_REGISTRATION_RATE_LIMIT_WINDOW_MS", HOUR_MS),
  }),
});

// Umbrales de observación por ámbito (todas las instancias suman en el mismo contador).
export const ANOMALY_THRESHOLDS = Object.freeze({
  "change-password": Object.freeze({ alertAt: 50, windowMs: FIFTEEN_MINUTES_MS }),
  "email-password-reset": Object.freeze({ alertAt: 50, windowMs: HOUR_MS }),
  "email-registration": Object.freeze({ alertAt: 50, windowMs: HOUR_MS }),
  login: Object.freeze({ alertAt: 300, windowMs: FIVE_MINUTES_MS }),
  "password-reset": Object.freeze({ alertAt: 200, windowMs: FIFTEEN_MINUTES_MS }),
  registration: Object.freeze({ alertAt: 200, windowMs: FIFTEEN_MINUTES_MS }),
});

/**
 * Identifica la cuenta de un token de enlace solo si su firma y su propósito son válidos.
 * Los tokens falsificados no crean contadores en PostgreSQL; el controlador los rechaza igualmente con
 * su verificación completa (existencia, caducidad y uso), que esta comprobación no sustituye.
 *
 * @param {unknown} value - Token recibido en el cuerpo.
 * @param {"user_registration"|"password_reset"} purpose - Propósito esperado del token.
 * @returns {string|null} Identidad con prefijo, o null si el token no es criptográficamente válido.
 */
function verifiedTokenIdentity(value, purpose) {
  if (typeof value !== "string" || value.length > 4096) return null;
  const token = value.trim();
  const payload = verifyAuthToken(token, { secret: authConfig.tokenSecret });
  return payload?.purpose === purpose ? `token:${token}` : null;
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
 * Dimensión de observación global de un ámbito: nunca bloquea y avisa al alcanzar su umbral.
 * Suma todas las peticiones del ámbito, también las que no tienen cuenta reconocible.
 *
 * @param {string} scope - Ámbito observado.
 * @returns {Array<object>} Dimensión de observación, o ninguna si el ámbito no tiene umbral.
 */
function anomalyDimensions(scope) {
  const threshold = ANOMALY_THRESHOLDS[scope];
  return threshold ? [{ name: "scope-volume", observeOnly: true, parts: ["all"], ...threshold }] : [];
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
  return [...identityDimensions(emailIdentity(req.body?.email), verifiedIp), ...anomalyDimensions("login")];
}

/**
 * Dimensiones del registro: la cuenta es el correo o, en los pasos del enlace, un token de registro válido.
 * Los tokens con firma inválida o de otro propósito no generan contador de cuenta.
 *
 * @param {import("express").Request} req - Petición de registro.
 * @param {string|null} verifiedIp - IP verificada o null.
 * @returns {Array<object>} Dimensiones a contar.
 */
function registrationDimensions(req, verifiedIp) {
  const identity = emailIdentity(req.body?.email) || verifiedTokenIdentity(req.body?.token, "user_registration");
  return [...identityDimensions(identity, verifiedIp), ...anomalyDimensions("registration")];
}

/**
 * Dimensiones de la recuperación: la cuenta es el correo o, en los pasos del enlace, un token válido.
 * Los tokens con firma inválida o de otro propósito no generan contador de cuenta.
 *
 * @param {import("express").Request} req - Petición de recuperación.
 * @param {string|null} verifiedIp - IP verificada o null.
 * @returns {Array<object>} Dimensiones a contar.
 */
function passwordResetDimensions(req, verifiedIp) {
  const identity = emailIdentity(req.body?.email) || verifiedTokenIdentity(req.body?.token, "password_reset");
  return [...identityDimensions(identity, verifiedIp), ...anomalyDimensions("password-reset")];
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
    ...anomalyDimensions("change-password"),
  ];
}

/**
 * Construye la política de envío de correos de seguridad por destinatario (alias de Gmail unificados).
 * Se aplica después de validar la petición y antes de consultar si la cuenta existe, de modo que cuenta
 * igual para correos registrados y no registrados (sin revelar cuáles existen) y bloquea antes de enviar.
 *
 * @param {string} scope - Ámbito del correo (email-registration, email-password-reset).
 * @param {{ max: number, windowMs: number }} limit - Límite por destinatario.
 * @returns {(req: import("express").Request) => Array<object>} Política del ámbito.
 */
function recipientPolicy(scope, limit) {
  return function recipientDimensions(req) {
    const recipient = normalizeEmailRecipient(req.body?.email);
    return [
      ...(recipient ? [{ name: "recipient", parts: [`recipient:${recipient}`], ...limit }] : []),
      ...anomalyDimensions(scope),
    ];
  };
}

// Ámbitos separados: un flujo no consume el límite de otro.
export const AUTH_RATE_LIMIT_POLICIES = Object.freeze({
  "change-password": changePasswordDimensions,
  "email-password-reset": recipientPolicy("email-password-reset", EMAIL_RATE_LIMITS.passwordReset),
  "email-registration": recipientPolicy("email-registration", EMAIL_RATE_LIMITS.registration),
  login: loginDimensions,
  "password-reset": passwordResetDimensions,
  registration: registrationDimensions,
});
