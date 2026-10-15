import bcrypt from "bcrypt";

import { authConfig } from "../config/auth.js";
import { ConflictError, NotFoundError } from "../errors/appError.js";
import { findActiveUserById } from "../repositories/userRepository.js";
import {
  completePendingRegistration,
  findPendingRegistrationByEmail,
  findRegistrationUserConflict,
  findValidPendingRegistration,
  refreshPendingRegistration,
  upsertPendingRegistration,
} from "../repositories/registrationRepository.js";
import { verifyAuthToken } from "../utils/tokens.js";
import { issueUserSession } from "./sessionService.js";
import {
  createRegistrationEmailPayload,
  hashRegistrationToken,
  sendRegistrationEmail,
} from "./registrationEmailService.js";

/**
 * Procesa el valor de conflict error para completar la responsabilidad asignada al módulo.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {string} code - Valor de `code` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
function conflictError(code) {
  return code === "PHONE_ALREADY_EXISTS"
    ? new ConflictError(code, "Este número de teléfono ya está registrado.")
    : new ConflictError("EMAIL_ALREADY_EXISTS", "Este correo electrónico ya está registrado.");
}

/**
 * Interpreta el valor de token y descarta los formatos que no sean válidos.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {string} token - Valor de `token` requerido por esta operación.
 * @returns {object} Resultado producido por la operación.
 */
function parseToken(token) {
  const payload = verifyAuthToken(token, { secret: authConfig.tokenSecret });
  if (!payload || payload.purpose !== "user_registration" || !payload.email) return null;
  return { email: String(payload.email).toLowerCase(), tokenHash: hashRegistrationToken(token) };
}

/**
 * Comprueba el valor de no usuario conflict y rechaza la operación cuando no se cumple.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.email - Valor de `options.email` requerido por esta operación.
 * @param {unknown} options.phone - Valor de `options.phone` requerido por esta operación.
 * @returns {Promise<void>} Finalización de la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
async function assertNoUserConflict({ email, phone }) {
  const conflict = await findRegistrationUserConflict({ email, phone });
  if (conflict.email_exists) throw conflictError("EMAIL_ALREADY_EXISTS");
  if (conflict.phone_exists) throw conflictError("PHONE_ALREADY_EXISTS");
}

/**
 * Inicia el valor de registro y conserva el estado necesario para completarlo después.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {unknown} payload - Datos validados necesarios para completar la operación.
 * @returns {Promise<object>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function startRegistration(payload) {
  await assertNoUserConflict(payload);
  const mail = createRegistrationEmailPayload(payload.email);
  try {
    await upsertPendingRegistration({
      ...payload,
      firstName: payload.fullName.firstName,
      lastName: payload.fullName.lastName,
      tokenHash: mail.tokenHash,
      expiresAt: mail.expiresAt,
    });
  } catch (error) {
    if (error?.constraint === "user_registrations_phone_key") throw conflictError("PHONE_ALREADY_EXISTS");
    throw error;
  }
  await sendRegistrationEmail({ email: payload.email, registrationUrl: mail.registrationUrl });
  return { message: "Enviamos un enlace de verificación a tu correo electrónico." };
}

/**
 * Reenvía el valor de registro generando credenciales temporales nuevas cuando corresponde.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {string} email - Valor de `email` requerido por esta operación.
 * @returns {Promise<object>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function resendRegistration(email) {
  const pending = await findPendingRegistrationByEmail(email);
  if (!pending) throw new NotFoundError("REGISTRATION_NOT_FOUND", "No encontramos un registro pendiente para este correo.");
  const mail = createRegistrationEmailPayload(pending.email);
  await refreshPendingRegistration({ email, tokenHash: mail.tokenHash, expiresAt: mail.expiresAt });
  await sendRegistrationEmail({ email: pending.email, registrationUrl: mail.registrationUrl });
  return { message: "Enviamos un nuevo enlace de verificación." };
}

/**
 * Verifica el valor de registro y rechaza valores vencidos o inconsistentes.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {string} token - Valor de `token` requerido por esta operación.
 * @returns {Promise<object>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function verifyRegistration(token) {
  const parsed = parseToken(token);
  const pending = parsed ? await findValidPendingRegistration(parsed) : null;
  if (!pending) throw new NotFoundError("INVALID_REGISTRATION_TOKEN", "El enlace de registro no es válido, expiró o ya fue utilizado.");
  return { email: pending.email, valid: true };
}

/**
 * Procesa el valor de complete registro para completar la responsabilidad asignada al módulo.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.token - Valor de `options.token` requerido por esta operación.
 * @param {string} options.password - Valor de `options.password` requerido por esta operación.
 * @returns {Promise<object>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function completeRegistration({ token, password }) {
  const parsed = parseToken(token);
  if (!parsed) throw new NotFoundError("INVALID_REGISTRATION_TOKEN", "El enlace de registro no es válido, expiró o ya fue utilizado.");
  const passwordHash = await bcrypt.hash(password, 10);
  let completed;
  try {
    completed = await completePendingRegistration({ ...parsed, passwordHash });
  } catch (error) {
    if (["EMAIL_ALREADY_EXISTS", "PHONE_ALREADY_EXISTS"].includes(error?.code)) throw conflictError(error.code);
    if (error?.code === "23505") {
      throw conflictError(String(error.constraint).includes("phone") ? "PHONE_ALREADY_EXISTS" : "EMAIL_ALREADY_EXISTS");
    }
    throw error;
  }
  if (!completed) throw new NotFoundError("INVALID_REGISTRATION_TOKEN", "El enlace de registro no es válido, expiró o ya fue utilizado.");
  const user = await findActiveUserById(completed.userId);
  // La cuenta recién creada inicia una sesión revocable (B-3) igual que un inicio de sesión normal.
  const { token: sessionToken } = await issueUserSession(user.id);
  return { token: sessionToken, user };
}
