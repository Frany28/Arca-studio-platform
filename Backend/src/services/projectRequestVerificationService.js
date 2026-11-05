import crypto from "node:crypto";

import { authConfig } from "../config/auth.js";
import { AppError, NotFoundError } from "../errors/appError.js";
import { findProjectRequestOwnedByUser } from "../repositories/projectRequestRepository.js";
import {
  consumeProjectRequestVerificationCode,
  discardProjectRequestVerificationCode,
  findProjectRequestVerificationSentAt,
  lockProjectRequestVerification,
  recordProjectRequestVerificationFailure,
  storeProjectRequestVerificationCode,
} from "../repositories/projectRequestVerificationRepository.js";
import { sendResendEmail } from "./resendEmailClient.js";

export const PROJECT_REQUEST_VERIFICATION = Object.freeze({
  codeTtlSeconds: 10 * 60,
  maxAttempts: 5,
  resendCooldownSeconds: 60,
});

const EDITABLE_STATUSES = new Set(["draft", "changes_requested"]);
// Propósito incluido en el HMAC: un código de envío no sirve para otra operación.
const CODE_PURPOSE = "project_request_submit";

/**
 * Genera un código numérico de seis dígitos con el generador criptográfico del sistema.
 *
 * @returns {string} Código con ceros a la izquierda.
 */
export function generateVerificationCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Calcula el HMAC del código ligado a la operación, la solicitud y el usuario, para guardarlo
 * sin conservar el código y para que no sea válido en otra solicitud ni para otro usuario.
 *
 * @param {object} options - Datos del código.
 * @param {string} options.code - Código de seis dígitos.
 * @param {number|string} options.projectRequestId - Solicitud del envío.
 * @param {number|string} options.userId - Usuario que solicitó el código.
 * @returns {string} HMAC SHA-256 en hexadecimal.
 */
export function hashVerificationCode({ code, projectRequestId, userId }) {
  return crypto
    .createHmac("sha256", authConfig.tokenSecret)
    .update(`${CODE_PURPOSE}:${Number(projectRequestId)}:${Number(userId)}:${code}`)
    .digest("hex");
}

/**
 * Compara dos hashes en tiempo constante para no revelar coincidencias parciales.
 * Un hash ausente o de otra longitud se rechaza antes de la comparación.
 *
 * @param {string|null} expected - Hash guardado.
 * @param {string} received - Hash del código recibido.
 * @returns {boolean} true si coinciden.
 */
function hashesMatch(expected, received) {
  if (!expected || expected.length !== received.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

/**
 * Exige un usuario vinculado a un cliente, el único que puede enviar solicitudes.
 * Se comprueba antes de cualquier acceso a PostgreSQL o al proveedor de correo.
 *
 * @param {unknown} user - Usuario autenticado.
 * @returns {void}
 * @throws {AppError} CLIENT_REQUIRED cuando el usuario no es cliente.
 */
function requireClientUser(user) {
  if (!user?.clientId) {
    throw new AppError({
      code: "CLIENT_REQUIRED",
      message: "Solo los clientes pueden enviar solicitudes de proyecto.",
      status: 403,
    });
  }
}

/**
 * Explica por qué no se registró un código: solicitud ajena o inexistente, estado que no admite
 * envío o plazo mínimo entre envíos todavía vigente.
 *
 * @param {number|string} projectRequestId - Solicitud del código.
 * @param {object} user - Cliente autenticado.
 * @returns {Promise<never>} Siempre lanza.
 * @throws {AppError} PROJECT_REQUEST_NOT_FOUND, PROJECT_REQUEST_NOT_SUBMITTABLE o
 *   VERIFICATION_CODE_RECENTLY_SENT (con `retryAfter` en segundos).
 */
async function throwIssueRejection(projectRequestId, user) {
  const current = await findProjectRequestOwnedByUser(projectRequestId, user);
  if (!current) {
    throw new NotFoundError("PROJECT_REQUEST_NOT_FOUND", "No se encontró la solicitud de proyecto.");
  }
  if (!EDITABLE_STATUSES.has(current.status)) {
    throw new AppError({
      code: "PROJECT_REQUEST_NOT_SUBMITTABLE",
      message: "La solicitud no se encuentra en un estado que permita enviarla.",
      status: 409,
    });
  }
  const sentAt = await findProjectRequestVerificationSentAt(projectRequestId, user);
  const elapsedSeconds = sentAt ? (Date.now() - new Date(sentAt).getTime()) / 1000 : Infinity;
  const retryAfterSeconds = Math.max(1, Math.ceil(PROJECT_REQUEST_VERIFICATION.resendCooldownSeconds - elapsedSeconds));
  const error = new AppError({
    code: "VERIFICATION_CODE_RECENTLY_SENT",
    message: `Ya enviamos un código. Podrás solicitar otro en ${retryAfterSeconds} segundos.`,
    status: 429,
  });
  // El middleware central publica retryAfter en la respuesta y en la cabecera Retry-After.
  error.retryAfter = retryAfterSeconds;
  throw error;
}

/**
 * Construye el asunto y los cuerpos HTML y de texto del correo con el código.
 * Escapa el nombre del proyecto en HTML e indica el vencimiento y el uso único.
 *
 * @param {string} code - Código de seis dígitos.
 * @param {string} projectName - Nombre de la solicitud.
 * @returns {{ html: string, subject: string, text: string }} Contenido del correo.
 */
function buildVerificationEmail(code, projectName) {
  const minutes = PROJECT_REQUEST_VERIFICATION.codeTtlSeconds / 60;
  const safeName = String(projectName || "tu proyecto").replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
  return {
    html: `<div style="font-family:Arial,sans-serif;color:#2a2929;line-height:1.5"><h1>Código de validación</h1><p>Usa este código para enviar la solicitud «${safeName}» en ARCA Studio:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>Vence en ${minutes} minutos y solo puede utilizarse una vez. Si no solicitaste este código, ignora este correo.</p></div>`,
    subject: "Tu código de validación de ARCA Studio",
    text: `Tu código para enviar la solicitud «${projectName || "tu proyecto"}» es ${code}. Vence en ${minutes} minutos y solo puede utilizarse una vez.`,
  };
}

/**
 * Emite un código de validación para enviar una solicitud propia y editable y lo envía al correo
 * del cliente. Sustituye el código anterior (reinicia intentos y vencimiento) y respeta un plazo
 * mínimo entre envíos. Si el correo falla, anula el código para permitir pedir otro.
 *
 * @param {object} options - Datos de la emisión.
 * @param {number|string} options.projectRequestId - Solicitud que se va a enviar.
 * @param {object} options.user - Cliente autenticado (id, clientId, email).
 * @returns {Promise<{ expiresAt: string, resendAvailableAt: string }>} Vencimiento y próximo reenvío.
 * @throws {AppError} Rechazos de emisión o errores del proveedor de correo.
 */
export async function issueProjectRequestVerificationCode({ projectRequestId, user }) {
  requireClientUser(user);
  if (!user.email) {
    throw new AppError({ code: "EMAIL_REQUIRED", message: "Tu cuenta no tiene un correo para recibir el código.", status: 409 });
  }

  const code = generateVerificationCode();
  const codeHash = hashVerificationCode({ code, projectRequestId, userId: user.id });
  const expiresAt = new Date(Date.now() + PROJECT_REQUEST_VERIFICATION.codeTtlSeconds * 1000);
  const stored = await storeProjectRequestVerificationCode({
    codeHash,
    expiresAt,
    projectRequestId,
    resendCooldownSeconds: PROJECT_REQUEST_VERIFICATION.resendCooldownSeconds,
    user,
  });
  if (!stored) await throwIssueRejection(projectRequestId, user);

  const current = await findProjectRequestOwnedByUser(projectRequestId, user);
  try {
    await sendResendEmail({
      ...buildVerificationEmail(code, current?.projectName),
      publicMessage: "No pudimos enviar el código de validación. Inténtalo de nuevo.",
      to: user.email,
    });
  } catch (error) {
    await discardProjectRequestVerificationCode(projectRequestId, codeHash);
    throw error;
  }

  const sentAt = new Date(stored.sentAt || Date.now());
  return {
    expiresAt: expiresAt.toISOString(),
    resendAvailableAt: new Date(sentAt.getTime() + PROJECT_REQUEST_VERIFICATION.resendCooldownSeconds * 1000).toISOString(),
  };
}

/**
 * Construye un error de verificación con código y estado públicos, sin `fields`:
 * el código no es un campo de formulario del contrato de validación.
 *
 * @param {string} code - Código público.
 * @param {string} message - Mensaje visible.
 * @param {number} [status=400] - Estado HTTP.
 * @returns {AppError} Error de aplicación.
 */
function verificationError(code, message, status = 400) {
  return new AppError({ code, message, status });
}

/**
 * Verifica y consume el código dentro de la transacción del envío, con la fila bloqueada.
 * Un código ausente, vencido o bloqueado rechaza el envío; uno incorrecto suma un intento que
 * se confirma aunque el envío no continúe (por eso se devuelve el error en lugar de lanzarlo).
 * Uno correcto se elimina (uso único) antes de cambiar el estado de la solicitud.
 *
 * @param {{ query: Function }} executor - Cliente de la transacción del envío.
 * @param {object} options - Datos de la verificación.
 * @param {string} options.code - Código recibido.
 * @param {number|string} options.projectRequestId - Solicitud enviada.
 * @param {object} options.user - Cliente autenticado.
 * @returns {Promise<AppError|null>} Error a lanzar tras confirmar la transacción, o null si es válido.
 */
export async function verifyAndConsumeProjectRequestCode(executor, { code, projectRequestId, user }) {
  const state = await lockProjectRequestVerification(executor, projectRequestId, user);
  // Revalida el estado con la fila bloqueada: un cambio concurrente no debe consumir el código.
  if (!state || !EDITABLE_STATUSES.has(state.status)) {
    return verificationError("PROJECT_REQUEST_NOT_SUBMITTABLE", "La solicitud no se encuentra en un estado que permita enviarla.", 409);
  }
  if (!state.codeHash) {
    return verificationError("VERIFICATION_CODE_REQUIRED", "Solicita un código de validación para enviar la solicitud.");
  }
  if (!state.expiresAt || new Date(state.expiresAt).getTime() <= Date.now()) {
    return verificationError("VERIFICATION_CODE_EXPIRED", "El código venció. Solicita uno nuevo.");
  }
  if (state.attempts >= PROJECT_REQUEST_VERIFICATION.maxAttempts) {
    return verificationError("VERIFICATION_CODE_LOCKED", "Superaste los intentos permitidos. Solicita un nuevo código.", 429);
  }

  const received = hashVerificationCode({ code: String(code), projectRequestId, userId: user.id });
  if (!hashesMatch(state.codeHash, received)) {
    const attempts = await recordProjectRequestVerificationFailure(executor, projectRequestId);
    const remaining = Math.max(0, PROJECT_REQUEST_VERIFICATION.maxAttempts - attempts);
    return remaining > 0
      ? verificationError("VERIFICATION_CODE_INVALID", `El código no es correcto. Te quedan ${remaining} ${remaining === 1 ? "intento" : "intentos"}.`)
      : verificationError("VERIFICATION_CODE_LOCKED", "Superaste los intentos permitidos. Solicita un nuevo código.", 429);
  }

  await consumeProjectRequestVerificationCode(executor, projectRequestId);
  return null;
}
