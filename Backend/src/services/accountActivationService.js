import crypto from "node:crypto";
import bcrypt from "bcrypt";

import { authConfig } from "../config/auth.js";
import { ConflictError, NotFoundError } from "../errors/appError.js";
import {
  activatePendingAccount,
  findActivationAccount,
  hasValidActivationToken,
} from "../repositories/accountActivationRepository.js";
import { insertAuditLog } from "../repositories/auditLogRepository.js";
import { createPasswordResetToken } from "../repositories/passwordResetRepository.js";
import { createAuthToken, verifyAuthToken } from "../utils/tokens.js";
import { sendResendEmail } from "./resendEmailClient.js";

/*
 * Activación de cuentas pendientes (opción A). El administrador completa el correo de la cuenta y
 * envía el enlace; el titular demuestra que controla ese correo al abrirlo y define su contraseña.
 * Reutiliza el JWT firmado (con propósito propio), la tabla de tokens de un solo uso y Resend.
 */

export const ACCOUNT_ACTIVATION_PURPOSE = "account_activation";
const DEFAULT_EXPIRES_IN_SECONDS = 72 * 60 * 60;
const DEFAULT_FRONTEND_URL = "https://arcastudio.netlify.app";
const ACTIVATION_EMAIL_ERROR = "No pudimos enviar el correo de activación.";

/**
 * Vigencia del enlace de activación en segundos (`ACCOUNT_ACTIVATION_EXPIRES_IN_SECONDS`, 72 h por
 * defecto): la persona puede no ver el correo enseguida.
 *
 * @returns {number} Segundos de vigencia.
 */
function getActivationExpiresInSeconds() {
  const configured = Number(process.env.ACCOUNT_ACTIVATION_EXPIRES_IN_SECONDS);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_EXPIRES_IN_SECONDS;
}

/**
 * URL base del frontend con las mismas variables que el enlace de recuperación, para que
 * ambos enlaces apunten siempre a la misma aplicación publicada.
 *
 * @returns {string} URL sin barra final.
 */
function getFrontendBaseUrl() {
  const baseUrl = process.env.FRONTEND_URL || process.env.PUBLIC_APP_URL || process.env.APP_URL || DEFAULT_FRONTEND_URL;
  return String(baseUrl).replace(/\/$/, "");
}

/**
 * Huella SHA-256 del enlace, igual que en la recuperación de contraseña: la tabla de tokens
 * nunca guarda el token, solo esta huella para compararlo.
 *
 * @param {string} token - Token compacto.
 * @returns {string} Hash hexadecimal.
 */
function hashActivationToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Escapa texto para insertarlo en el HTML del correo: el nombre de la cuenta lo escribe un
 * administrador y nunca debe interpretarse como marcado.
 *
 * @param {unknown} value - Texto.
 * @returns {string} Texto escapado.
 */
function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/**
 * Verifica firma, vigencia y propósito de un enlace de activación. Un token de sesión, de
 * recuperación o de registro no sirve aquí (y uno de activación no sirve en esos flujos).
 *
 * @param {unknown} token - Token recibido.
 * @returns {{ email: string, tokenHash: string, userId: number }|null} Datos del enlace o null.
 */
export function parseActivationToken(token) {
  if (typeof token !== "string" || !token) return null;
  const payload = verifyAuthToken(token.trim(), { secret: authConfig.tokenSecret });
  if (
    !payload
    || payload.purpose !== ACCOUNT_ACTIVATION_PURPOSE
    || !/^\d+$/.test(String(payload.sub))
    || typeof payload.email !== "string"
  ) {
    return null;
  }
  return { email: payload.email, tokenHash: hashActivationToken(token.trim()), userId: Number(payload.sub) };
}

/**
 * Envía al correo de una cuenta pendiente un enlace de activación de un solo uso. Emitir uno nuevo
 * invalida los anteriores. Exige que la cuenta siga pendiente y tenga correo (lo completa antes el
 * administrador desde la edición de usuarios).
 *
 * @param {object} options - Datos de la operación.
 * @param {number} options.actorUserId - Administrador que envía el enlace.
 * @param {number} options.userId - Cuenta pendiente.
 * @returns {Promise<{ email: string, expiresAt: string }>} Destinatario y vencimiento.
 * @throws {NotFoundError|ConflictError} USER_NOT_FOUND, ACCOUNT_NOT_PENDING o ACCOUNT_EMAIL_REQUIRED.
 */
export async function sendAccountActivationLink({ actorUserId, userId }) {
  const account = await findActivationAccount(userId);
  if (!account) throw new NotFoundError("USER_NOT_FOUND", "El usuario seleccionado no existe.");
  if (account.status !== "pending") {
    throw new ConflictError("ACCOUNT_NOT_PENDING", "Solo una cuenta pendiente puede recibir un enlace de activación.");
  }
  if (!account.email) {
    throw new ConflictError("ACCOUNT_EMAIL_REQUIRED", "Completa el correo de la cuenta antes de enviar el enlace de activación.");
  }

  const expiresInSeconds = getActivationExpiresInSeconds();
  const token = createAuthToken(
    { email: account.email, purpose: ACCOUNT_ACTIVATION_PURPOSE, sub: String(account.id) },
    { expiresInSeconds, secret: authConfig.tokenSecret },
  );
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
  await createPasswordResetToken(account.id, hashActivationToken(token), expiresAt);

  const activationUrl = `${getFrontendBaseUrl()}/activar-cuenta?token=${encodeURIComponent(token)}`;
  const hours = Math.ceil(expiresInSeconds / 3600);
  const name = `${account.firstName} ${account.lastName}`.trim();
  await sendResendEmail({
    html: `<div style="font-family: Arial, sans-serif; color: #1f1f1f; line-height: 1.5;">
      <h1 style="font-size: 22px; margin-bottom: 12px;">Activa tu cuenta de ARCA Studio</h1>
      <p>Hola ${escapeHtml(name)}, ARCA Studio creó una cuenta de cliente para ${escapeHtml(account.email)}.</p>
      <p>Para activarla, confirma tu correo y define tu contraseña:</p>
      <p><a href="${escapeHtml(activationUrl)}" style="display: inline-block; padding: 12px 18px; background: #ff4438; color: #ffffff; text-decoration: none; border-radius: 8px;">Activar cuenta</a></p>
      <p>Este enlace vencerá en ${hours} horas y solo puede usarse una vez.</p>
      <p>Si el botón no funciona, abre este enlace:</p>
      <p><a href="${escapeHtml(activationUrl)}">${escapeHtml(activationUrl)}</a></p>
      <p>Si no esperabas este correo, puedes ignorarlo: la cuenta no se activará.</p>
    </div>`,
    publicMessage: ACTIVATION_EMAIL_ERROR,
    subject: "Activa tu cuenta de ARCA Studio",
    text: [
      "Activa tu cuenta de ARCA Studio",
      `Visita el siguiente enlace para confirmar tu correo y definir tu contraseña: ${activationUrl}`,
      `Este enlace vencerá en ${hours} horas y solo puede usarse una vez.`,
      "Si no esperabas este correo, puedes ignorarlo: la cuenta no se activará.",
    ].join("\n\n"),
    to: account.email,
  });

  await insertAuditLog({
    action: "user.activation_link_sent",
    description: "Enlace de activación enviado al correo de una cuenta pendiente.",
    entityId: account.id,
    entityType: "user",
    newValues: { expiresAt },
    userId: actorUserId,
  });
  return { email: account.email, expiresAt };
}

/**
 * Indica si un enlace de activación sigue siendo utilizable, sin consumirlo.
 *
 * @param {unknown} token - Token recibido.
 * @returns {Promise<boolean>} true si la cuenta pendiente y el enlace son válidos.
 */
export async function isActivationTokenValid(token) {
  const parsed = parseActivationToken(token);
  return parsed ? hasValidActivationToken(parsed) : false;
}

/**
 * Activa la cuenta con la contraseña elegida por su titular. Solo funciona una vez, con el enlace
 * vigente y mientras el correo de la cuenta sea el mismo al que se envió.
 *
 * @param {object} options - Datos de la activación.
 * @param {string} options.password - Contraseña validada por activateAccountSchema.
 * @param {string} options.token - Enlace recibido.
 * @returns {Promise<boolean>} true si la cuenta quedó activa.
 */
export async function activateAccount({ password, token }) {
  const parsed = parseActivationToken(token);
  if (!parsed) return false;
  const passwordHash = await bcrypt.hash(password, 10);
  return activatePendingAccount({ ...parsed, passwordHash });
}
