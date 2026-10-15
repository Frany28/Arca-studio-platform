import crypto from "node:crypto";
import bcrypt from "bcrypt";

import { ADMIN_USERS_PAGE_SIZE } from "../config/adminUsers.js";
import { ConflictError, NotFoundError } from "../errors/appError.js";
import {
  createAdminUserRecord,
  createAdminUserNoteRecord,
  archiveAdminUserNoteRecord,
  adminUserExists,
  findAdminUserAccessRecord,
  findAdminUserDetails,
  findAdminUserConflict,
  getAdminUserMetrics,
  listAdminUsers,
  listAdminUserNotes,
  updateAdminUserNoteRecord,
  updateAdminUserStatusRecord,
  updateAdminUserRecord,
} from "../repositories/adminUserRepository.js";
import { mapAdminUser, mapAdminUserDetails, mapAdminUserNote } from "../utils/adminUsers.js";
import { SESSION_REVOCATION_REASONS, revokeUserSessions } from "../repositories/sessionRepository.js";
import {
  decodeCursor,
  pageResult,
  parsePageLimit,
} from "../utils/pagination.js";

/**
 * Obtiene la página de usuarios administrados para que el flujo llamador pueda continuar.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {unknown} [query] - Criterios de consulta y paginación solicitados.
 * @returns {Promise<object>} Resultado producido por la operación.
 */
export async function getAdminUsersPage(query = {}) {
  const limit = Math.min(
    parsePageLimit(query.limit || ADMIN_USERS_PAGE_SIZE),
    ADMIN_USERS_PAGE_SIZE,
  );
  const cursor = decodeCursor(query.cursor);
  const [rows, metrics] = await Promise.all([
    listAdminUsers({
      cursor,
      limit,
      role: query.role,
      search: query.search,
      status: query.status,
    }),
    getAdminUserMetrics(),
  ]);
  const page = pageResult(rows, limit, mapAdminUser, (row) => [
    new Date(row.created_at).toISOString(),
    String(row.id),
  ]);

  return {
    metrics,
    nextCursor: page.nextCursor,
    users: page.items,
  };
}

/**
 * Obtiene el detalle de un usuario administrado para que el flujo llamador pueda continuar.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.actorUserId - Valor de `options.actorUserId` requerido por esta operación.
 * @param {string} options.userId - Valor de `options.userId` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function getAdminUserDetails({ actorUserId, userId }) {
  const user = await findAdminUserDetails({ actorUserId, userId });
  if (!user) {
    throw new NotFoundError("USER_NOT_FOUND", "El usuario seleccionado no existe.");
  }

  return mapAdminUserDetails(user);
}

/**
 * Obtiene la página de notas de un usuario administrado para que el flujo llamador pueda continuar.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.actorUserId - Valor de `options.actorUserId` requerido por esta operación.
 * @param {unknown} [options.query] - Valor de `options.query` requerido por esta operación.
 * @param {string} options.userId - Valor de `options.userId` requerido por esta operación.
 * @returns {Promise<object>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function getAdminUserNotesPage({ actorUserId, query = {}, userId }) {
  const limit = Math.min(parsePageLimit(query.limit || 25), 25);
  const exists = await adminUserExists(userId);
  if (!exists) throw new NotFoundError("USER_NOT_FOUND", "El usuario seleccionado no existe.");
  const rows = await listAdminUserNotes({
    adminUserId: actorUserId,
    cursor: decodeCursor(query.cursor),
    limit,
    targetUserId: userId,
  });
  const page = pageResult(rows, limit, mapAdminUserNote, (row) => [
    new Date(row.created_at).toISOString(),
    String(row.id),
  ]);
  return { notes: page.items, nextCursor: page.nextCursor };
}

/**
 * Crea una nota de usuario administrado con los datos validados recibidos.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.actorUserId - Valor de `options.actorUserId` requerido por esta operación.
 * @param {string} options.content - Valor de `options.content` requerido por esta operación.
 * @param {string} options.userId - Valor de `options.userId` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function createAdminUserNote({ actorUserId, content, userId }) {
  const note = await createAdminUserNoteRecord({ adminUserId: actorUserId, content, targetUserId: userId });
  if (!note) throw new NotFoundError("USER_NOT_FOUND", "El usuario seleccionado no existe.");
  return mapAdminUserNote(note);
}

/**
 * Actualiza una nota de usuario administrado conservando las reglas de acceso e integridad.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.actorUserId - Valor de `options.actorUserId` requerido por esta operación.
 * @param {string} options.content - Valor de `options.content` requerido por esta operación.
 * @param {string} options.noteId - Valor de `options.noteId` requerido por esta operación.
 * @param {string} options.userId - Valor de `options.userId` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function updateAdminUserNote({ actorUserId, content, noteId, userId }) {
  const note = await updateAdminUserNoteRecord({ adminUserId: actorUserId, content, noteId, targetUserId: userId });
  if (!note) throw new NotFoundError("NOTE_NOT_FOUND", "La nota seleccionada no existe.");
  return mapAdminUserNote(note);
}

/**
 * Archiva una nota de usuario administrado y conserva su historial sin eliminarlo físicamente.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.actorUserId - Valor de `options.actorUserId` requerido por esta operación.
 * @param {string} options.noteId - Valor de `options.noteId` requerido por esta operación.
 * @param {string} options.userId - Valor de `options.userId` requerido por esta operación.
 * @returns {Promise<void>} Finalización de la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function archiveAdminUserNote({ actorUserId, noteId, userId }) {
  const note = await archiveAdminUserNoteRecord({ adminUserId: actorUserId, noteId, targetUserId: userId });
  if (!note) throw new NotFoundError("NOTE_NOT_FOUND", "La nota seleccionada no existe.");
}

/**
 * Crea el valor de administrativo usuario con los datos validados recibidos.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {unknown} payload - Datos validados necesarios para completar la operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function createAdminUser(payload) {
  const conflict = await findAdminUserConflict({
    email: payload.email,
    phone: payload.phone,
    secondaryPhone: payload.secondaryPhone,
  });
  if (conflict.email_exists) {
    throw new ConflictError("EMAIL_ALREADY_EXISTS", "Este correo electrónico ya está registrado.");
  }
  if (conflict.phone_exists) {
    throw new ConflictError("PHONE_ALREADY_EXISTS", "Uno de los teléfonos ya está registrado.");
  }

  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("base64url"), 10);
  let created;
  try {
    created = await createAdminUserRecord({
      ...payload,
      firstName: payload.fullName.firstName,
      lastName: payload.fullName.lastName,
      passwordHash,
    });
  } catch (error) {
    if (error?.code === "23505") {
      const phoneConflict = String(error.constraint || "").includes("phone");
      throw new ConflictError(
        phoneConflict ? "PHONE_ALREADY_EXISTS" : "EMAIL_ALREADY_EXISTS",
        phoneConflict ? "Uno de los teléfonos ya está registrado." : "Este correo electrónico ya está registrado.",
        error,
      );
    }
    throw error;
  }
  if (!created) throw new NotFoundError("ROLE_NOT_FOUND", "El rol seleccionado no está disponible.");

  // Staging temporal: el futuro enlace de activación no forma parte todavía de
  // este flujo. La creación debe persistir para permitir las pruebas autorizadas.

  return mapAdminUser(created);
}

/**
 * Actualiza el valor de administrativo usuario estado conservando las reglas de acceso e integridad.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.actorUserId - Valor de `options.actorUserId` requerido por esta operación.
 * @param {unknown} options.status - Valor de `options.status` requerido por esta operación.
 * @param {string} options.userId - Valor de `options.userId` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function updateAdminUserStatus({ actorUserId, status, userId }) {
  if (Number(actorUserId) === Number(userId)) {
    throw new ConflictError(
      "SELF_STATUS_CHANGE_NOT_ALLOWED",
      "No puedes cambiar el estado de tu propia cuenta.",
    );
  }

  const updatedUser = await updateAdminUserStatusRecord({ status, userId });
  if (!updatedUser) {
    throw new NotFoundError("USER_NOT_FOUND", "El usuario seleccionado no existe.");
  }

  return mapAdminUser(updatedUser);
}

/**
 * Revoca todas las sesiones activas de otro usuario por decisión de un administrador (B-3).
 * El usuario deberá iniciar sesión de nuevo en todos sus dispositivos; su cuenta no cambia.
 * Un administrador no puede revocar sus propias sesiones por esta vía.
 *
 * @param {object} options - Datos de la revocación.
 * @param {number|string} options.actorUserId - Administrador que ejecuta la acción.
 * @param {number|string} options.userId - Usuario cuyas sesiones se revocan.
 * @returns {Promise<{ revokedCount: number }>} Número de sesiones revocadas.
 * @throws {ConflictError} Cuando el administrador intenta revocar sus propias sesiones.
 * @throws {NotFoundError} Cuando el usuario no existe o fue eliminado.
 */
export async function revokeAdminUserSessions({ actorUserId, userId }) {
  if (Number(actorUserId) === Number(userId)) {
    throw new ConflictError(
      "SELF_SESSION_REVOKE_NOT_ALLOWED",
      "Usa el cierre de sesión de tu cuenta para revocar tus propias sesiones.",
    );
  }
  if (!(await adminUserExists(userId))) {
    throw new NotFoundError("USER_NOT_FOUND", "El usuario seleccionado no existe.");
  }

  const revokedCount = await revokeUserSessions({
    reason: SESSION_REVOCATION_REASONS.adminRevoked,
    userId,
  });
  return { revokedCount };
}

/**
 * Actualiza el valor de administrativo usuario conservando las reglas de acceso e integridad.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.actorUserId - Valor de `options.actorUserId` requerido por esta operación.
 * @param {unknown} options.payload - Valor de `options.payload` requerido por esta operación.
 * @param {string} options.userId - Valor de `options.userId` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function updateAdminUser({ actorUserId, payload, userId }) {
  const current = await findAdminUserAccessRecord(userId);
  if (!current) {
    throw new NotFoundError("USER_NOT_FOUND", "El usuario seleccionado no existe.");
  }
  if (
    Number(actorUserId) === Number(userId)
    && (current.status !== payload.status || current.role_code !== payload.roleCode)
  ) {
    throw new ConflictError(
      "SELF_ACCESS_CHANGE_NOT_ALLOWED",
      "No puedes cambiar tu propio rol o estado.",
    );
  }

  const conflict = await findAdminUserConflict({
    email: payload.email,
    excludeUserId: userId,
    phone: payload.phone,
    secondaryPhone: payload.secondaryPhone,
  });
  if (conflict.email_exists) {
    throw new ConflictError("EMAIL_ALREADY_EXISTS", "Este correo electrónico ya está registrado.");
  }
  if (conflict.phone_exists) {
    throw new ConflictError("PHONE_ALREADY_EXISTS", "Uno de los teléfonos ya está registrado.");
  }

  let updated;
  try {
    const passwordHash = payload.password
      ? await bcrypt.hash(payload.password, 10)
      : null;
    updated = await updateAdminUserRecord({
      ...payload,
      firstName: payload.fullName.firstName,
      lastName: payload.fullName.lastName,
      passwordHash,
      userId,
    });
  } catch (error) {
    if (error?.code === "23505") {
      const phoneConflict = String(error.constraint || "").includes("phone");
      throw new ConflictError(
        phoneConflict ? "PHONE_ALREADY_EXISTS" : "EMAIL_ALREADY_EXISTS",
        phoneConflict ? "Uno de los teléfonos ya está registrado." : "Este correo electrónico ya está registrado.",
        error,
      );
    }
    throw error;
  }
  if (updated?.reason === "role") {
    throw new NotFoundError("ROLE_NOT_FOUND", "El rol seleccionado no está disponible.");
  }
  if (!updated?.user) {
    throw new NotFoundError("USER_NOT_FOUND", "El usuario seleccionado no existe.");
  }

  return mapAdminUser(updated.user);
}
