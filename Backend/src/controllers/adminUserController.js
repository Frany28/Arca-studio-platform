import {
  archiveAdminUserNote,
  createAdminUser,
  createAdminUserNote,
  getAdminUserDetails,
  getAdminUserNotesPage,
  getAdminUsersPage,
  updateAdminUser,
  updateAdminUserNote,
  updateAdminUserStatus,
  revokeAdminUserSessions,
} from "../services/adminUserService.js";
import { getAdminUserProfilePhoto } from "../services/profilePhotoService.js";

/**
 * Transmite la foto de perfil de un usuario administrado sin cargar el contenido completo en memoria.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function streamAdminUserProfilePhoto(req, res, next) {
  try {
    const photo = await getAdminUserProfilePhoto({ userId: req.params.userId });

    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Content-Type", photo.contentType);
    res.setHeader("Cache-Control", "private, max-age=60, must-revalidate");
    if (photo.contentLength !== undefined) {
      res.setHeader("Content-Length", String(photo.contentLength));
    }
    photo.body.on?.("error", next);
    photo.body.pipe(res.status(200));
  } catch (error) {
    next(error);
  }
}

/**
 * Procesa la creación de el valor de administrativo usuario y construye la respuesta HTTP correspondiente.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function postAdminUser(req, res, next) {
  try {
    const user = await createAdminUser(req.body);
    res.set("Cache-Control", "no-store");
    res.status(201).json({
      message: "Usuario creado correctamente.",
      user,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Obtiene el valor de administrativo usuarios para que el flujo llamador pueda continuar.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function getAdminUsers(req, res, next) {
  try {
    const page = await getAdminUsersPage(req.validatedQuery);

    res.set("Cache-Control", "private, max-age=15");
    res.status(200).json(page);
  } catch (error) {
    next(error);
  }
}

/**
 * Procesa el valor de patch administrativo usuario para completar la responsabilidad asignada al módulo.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function patchAdminUser(req, res, next) {
  try {
    const user = await updateAdminUser({
      actorUserId: req.user.id,
      payload: req.body,
      userId: req.params.userId,
    });
    res.set("Cache-Control", "no-store");
    res.status(200).json({ message: "Usuario actualizado correctamente.", user });
  } catch (error) {
    next(error);
  }
}

/**
 * Obtiene el valor de administrativo usuario para que el flujo llamador pueda continuar.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function getAdminUser(req, res, next) {
  try {
    const user = await getAdminUserDetails({ actorUserId: req.user.id, userId: req.params.userId });
    res.set("Cache-Control", "no-store");
    res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
}

/**
 * Obtiene el valor de administrativo usuario notes para que el flujo llamador pueda continuar.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function getAdminUserNotes(req, res, next) {
  try {
    const page = await getAdminUserNotesPage({
      actorUserId: req.user.id,
      query: req.validatedQuery,
      userId: req.params.userId,
    });
    res.set("Cache-Control", "no-store");
    res.status(200).json(page);
  } catch (error) { next(error); }
}

/**
 * Procesa la creación de una nota de usuario administrado y construye la respuesta HTTP correspondiente.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function postAdminUserNote(req, res, next) {
  try {
    const note = await createAdminUserNote({ actorUserId: req.user.id, content: req.body.content, userId: req.params.userId });
    res.set("Cache-Control", "no-store");
    res.status(201).json({ message: "Nota guardada correctamente.", note });
  } catch (error) { next(error); }
}

/**
 * Procesa el valor de patch administrativo usuario note para completar la responsabilidad asignada al módulo.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function patchAdminUserNote(req, res, next) {
  try {
    const note = await updateAdminUserNote({
      actorUserId: req.user.id,
      content: req.body.content,
      noteId: req.params.noteId,
      userId: req.params.userId,
    });
    res.set("Cache-Control", "no-store");
    res.status(200).json({ message: "Nota actualizada correctamente.", note });
  } catch (error) { next(error); }
}

/**
 * Archiva el valor de usuario note y conserva su historial sin eliminarlo físicamente.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @returns {Promise<void>} Finalización de la operación.
 */
async function archiveUserNote(req) {
  await archiveAdminUserNote({
    actorUserId: req.user.id,
    noteId: req.params.noteId,
    userId: req.params.userId,
  });
}

/**
 * Archiva el valor de administrativo usuario note by id y conserva su historial sin eliminarlo físicamente.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function archiveAdminUserNoteById(req, res, next) {
  try {
    await archiveUserNote(req);
    res.set("Cache-Control", "no-store");
    res.status(200).json({ message: "Nota archivada correctamente." });
  } catch (error) { next(error); }
}

// Compatibilidad temporal: el antiguo DELETE conserva su contrato, pero nunca elimina datos.
/**
 * Archiva el valor de administrativo usuario note by legacy delete y conserva su historial sin eliminarlo físicamente.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function archiveAdminUserNoteByLegacyDelete(req, res, next) {
  try {
    await archiveUserNote(req);
    res.set("Cache-Control", "no-store");
    res.status(204).end();
  } catch (error) { next(error); }
}

/**
 * Procesa el valor de patch administrativo usuario estado para completar la responsabilidad asignada al módulo.
 * Coordina la solicitud HTTP, delega la lógica y construye la respuesta correspondiente.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function patchAdminUserStatus(req, res, next) {
  try {
    const user = await updateAdminUserStatus({
      actorUserId: req.user.id,
      status: req.body.status,
      userId: req.params.userId,
    });
    res.set("Cache-Control", "no-store");
    const statusMessages = {
      active: "Usuario habilitado correctamente.",
      blocked: "Usuario suspendido correctamente.",
      inactive: "Usuario deshabilitado correctamente.",
    };
    res.status(200).json({
      message: statusMessages[user.status],
      user,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Revoca todas las sesiones de un usuario administrado y responde con el número revocado.
 * La autorización de administrador, el límite y la validación de `userId` los aplica la ruta.
 *
 * @param {import("express").Request} req - Solicitud con `params.userId` validado.
 * @param {import("express").Response} res - Respuesta HTTP utilizada para devolver el resultado.
 * @param {Function} next - Función que entrega errores o continúa la cadena de middlewares.
 * @returns {Promise<void>} Finalización de la operación.
 */
export async function postAdminUserSessionRevocation(req, res, next) {
  try {
    const result = await revokeAdminUserSessions({
      actorUserId: req.user.id,
      userId: req.params.userId,
    });
    res.set("Cache-Control", "no-store");
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
