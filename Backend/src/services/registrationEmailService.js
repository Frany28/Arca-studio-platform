import crypto from "node:crypto";

import { authConfig } from "../config/auth.js";
import { EXTERNAL_REQUEST_TIMEOUTS, fetchWithTimeout, isTimeoutError } from "../utils/externalRequest.js";
import { createAuthToken } from "../utils/tokens.js";

const EXPIRES_IN_SECONDS = 15 * 60;

/**
 * Obtiene el valor de URL desde la configuración del entorno.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @returns {unknown} Resultado producido por la operación.
 */
function frontendUrl() {
  return String(process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || process.env.APP_URL || "https://arcastudio.netlify.app").replace(/\/$/, "");
}

/**
 * Escapa el valor de html para impedir que se interprete como contenido HTML.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {unknown} value - Valor de `value` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/**
 * Procesa el valor de correo error para completar la responsabilidad asignada al módulo.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {unknown} message - Valor de `message` requerido por esta operación.
 * @param {string} code - Valor de `code` requerido por esta operación.
 * @param {unknown} [status] - Valor de `status` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
function emailError(message, code, status = 502) {
  return Object.assign(new Error(message), {
    code,
    publicMessage: "No pudimos enviar el correo de verificación.",
    status,
  });
}

/**
 * Envía la petición a Resend con el plazo de correo y traduce los fallos de red o de plazo.
 * No se reintenta: un reintento tras un plazo agotado podría duplicar el correo.
 *
 * @param {RequestInit} options - Opciones de la petición.
 * @returns {Promise<Response>} Respuesta de Resend.
 * @throws {Error} EMAIL_SERVICE_TIMEOUT (504) o EMAIL_SERVICE_UNAVAILABLE (502), con mensaje público genérico.
 */
async function sendEmailRequest(options) {
  try {
    return await fetchWithTimeout("https://api.resend.com/emails", options, EXTERNAL_REQUEST_TIMEOUTS.emailMs);
  } catch (error) {
    const timedOut = isTimeoutError(error);
    throw emailError(
      timedOut ? "Registration email request timed out" : "Registration email provider unreachable",
      timedOut ? "EMAIL_SERVICE_TIMEOUT" : "EMAIL_SERVICE_UNAVAILABLE",
      timedOut ? 504 : 502,
    );
  }
}

/**
 * Calcula la huella de el token de registro para compararlo sin conservar el valor original.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {string} token - Valor de `token` requerido por esta operación.
 * @returns {boolean} Resultado producido por la operación.
 */
export function hashRegistrationToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Crea los datos del correo de registro con los datos validados recibidos.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {string} email - Valor de `email` requerido por esta operación.
 * @returns {object} Resultado producido por la operación.
 */
export function createRegistrationEmailPayload(email) {
  const token = createAuthToken(
    { email, purpose: "user_registration" },
    { expiresInSeconds: EXPIRES_IN_SECONDS, secret: authConfig.tokenSecret },
  );
  return {
    token,
    tokenHash: hashRegistrationToken(token),
    expiresAt: new Date(Date.now() + EXPIRES_IN_SECONDS * 1000).toISOString(),
    registrationUrl: `${frontendUrl()}/crear-contrasena?token=${encodeURIComponent(token)}`,
  };
}

/**
 * Envía el valor de registro correo y traduce los fallos externos al contrato de errores.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.email - Valor de `options.email` requerido por esta operación.
 * @param {string} options.registrationUrl - Valor de `options.registrationUrl` requerido por esta operación.
 * @returns {Promise<void>} Finalización de la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function sendRegistrationEmail({ email, registrationUrl }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM || process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) throw emailError("RESEND_API_KEY and MAIL_FROM are required", "EMAIL_SERVICE_NOT_CONFIGURED", 503);
  const safeUrl = escapeHtml(registrationUrl);
  const response = await sendEmailRequest({
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Verifica tu correo electrónico",
      html: `<div style="font-family:Arial,sans-serif;color:#2a2929;line-height:1.5"><h1>Verifica tu correo electrónico</h1><p>Confirma tu correo para terminar de crear tu cuenta en ARCA Studio.</p><p><a href="${safeUrl}" style="display:inline-block;padding:12px 18px;background:#ff4438;color:#fff;text-decoration:none;border-radius:8px">Verificar correo</a></p><p>Este enlace vencerá en 15 minutos y solo puede utilizarse una vez.</p><p>Si el botón no funciona, abre este enlace: <a href="${safeUrl}">${safeUrl}</a></p></div>`,
      text: `Verifica tu correo para crear tu cuenta en ARCA Studio: ${registrationUrl}\n\nEste enlace vencerá en 15 minutos.`,
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw emailError(data?.message || "Unable to send registration email", "EMAIL_DELIVERY_FAILED");
  }
}
