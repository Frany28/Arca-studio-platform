import { EXTERNAL_REQUEST_TIMEOUTS, fetchWithTimeout, isTimeoutError } from "../utils/externalRequest.js";

const RESEND_EMAILS_URL = "https://api.resend.com/emails";

/**
 * Construye el error de envío con el contrato que usa el middleware central: código, estado
 * HTTP y un mensaje público genérico que no expone detalles del proveedor.
 *
 * @param {string} message - Mensaje interno para los registros.
 * @param {string} code - Código público del error.
 * @param {number} status - Estado HTTP.
 * @param {string} publicMessage - Mensaje visible para el usuario.
 * @returns {Error} Error con code, status y publicMessage.
 */
function emailError(message, code, status, publicMessage) {
  return Object.assign(new Error(message), { code, publicMessage, status });
}

/**
 * Envía un correo transaccional mediante Resend con el plazo configurado para correo.
 * No reintenta: un reintento tras un plazo agotado podría duplicar el mensaje. Requiere
 * RESEND_API_KEY y MAIL_FROM (o RESEND_FROM_EMAIL), igual que el correo de registro.
 *
 * @param {object} message - Contenido del correo.
 * @param {string} message.to - Destinatario.
 * @param {string} message.subject - Asunto.
 * @param {string} message.html - Cuerpo HTML ya escapado.
 * @param {string} message.text - Cuerpo de texto.
 * @param {string} message.publicMessage - Mensaje público si el envío falla.
 * @returns {Promise<void>} Finaliza cuando el proveedor acepta el correo.
 * @throws {Error} EMAIL_SERVICE_NOT_CONFIGURED (503), EMAIL_SERVICE_TIMEOUT (504),
 *   EMAIL_SERVICE_UNAVAILABLE (502) o EMAIL_DELIVERY_FAILED (502).
 */
export async function sendResendEmail({ html, publicMessage, subject, text, to }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM || process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    throw emailError("RESEND_API_KEY and MAIL_FROM are required", "EMAIL_SERVICE_NOT_CONFIGURED", 503, publicMessage);
  }

  let response;
  try {
    response = await fetchWithTimeout(RESEND_EMAILS_URL, {
      body: JSON.stringify({ from, html, subject, text, to: [to] }),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      method: "POST",
    }, EXTERNAL_REQUEST_TIMEOUTS.emailMs);
  } catch (error) {
    const timedOut = isTimeoutError(error);
    throw emailError(
      timedOut ? "Email request timed out" : "Email provider unreachable",
      timedOut ? "EMAIL_SERVICE_TIMEOUT" : "EMAIL_SERVICE_UNAVAILABLE",
      timedOut ? 504 : 502,
      publicMessage,
    );
  }

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw emailError(data?.message || "Unable to send email", "EMAIL_DELIVERY_FAILED", 502, publicMessage);
  }
}
