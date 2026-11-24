import { getUserNotifications, readUserNotification } from "../services/notificationService.js";

// Las notificaciones cambian con cada evento y son privadas: nunca se guardan en caché.
const NO_STORE = "private, no-store";

/**
 * Devuelve una página de notificaciones del usuario autenticado con su total de no leídas.
 * El usuario sale de la sesión; la consulta solo admite cursor y límite.
 *
 * @param {import("express").Request} req - Solicitud con la consulta validada.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con el middleware de errores.
 * @returns {Promise<void>}
 */
export async function getNotifications(req, res, next) {
  try {
    res.set("Cache-Control", NO_STORE).status(200).json(await getUserNotifications({ ...req.validatedQuery, user: req.user }));
  } catch (error) {
    next(error);
  }
}

/**
 * Marca como leída una notificación propia; una ajena o inexistente responde 404 sin distinguirlas.
 * Repetirla no cambia la primera fecha de lectura.
 *
 * @param {import("express").Request} req - Solicitud con el id validado.
 * @param {import("express").Response} res - Respuesta HTTP.
 * @param {Function} next - Continúa con el middleware de errores.
 * @returns {Promise<void>}
 */
export async function patchNotificationRead(req, res, next) {
  try {
    res.set("Cache-Control", NO_STORE).status(200).json(await readUserNotification({ notificationId: req.params.notificationId, user: req.user }));
  } catch (error) {
    next(error);
  }
}
