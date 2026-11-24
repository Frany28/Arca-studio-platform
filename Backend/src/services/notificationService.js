import { NotFoundError, ValidationError } from "../errors/appError.js";
import { countUnreadNotifications, listUserNotifications, markNotificationRead } from "../repositories/notificationRepository.js";
import { decodeCursor, encodeCursor } from "../utils/pagination.js";

// Notificaciones del usuario autenticado: lectura paginada y marca de lectura. El usuario y su
// alcance salen siempre de la sesión (nunca de la petición), así que no se pueden consultar ni marcar
// notificaciones ajenas. Las escriben otros módulos (solicitudes y revisión de archivos).

/**
 * Representa una notificación para el panel: textos, estado de lectura, tipo y contexto autorizado.
 * `project` es null si el usuario ya no puede acceder al proyecto del evento.
 *
 * @param {object} row - Fila del repositorio.
 * @returns {object} Notificación pública.
 */
function toNotification(row) {
  return {
    createdAt: row.created_at,
    entity: { id: row.entity_id === null ? null : Number(row.entity_id), type: row.entity_type },
    id: Number(row.id),
    isRead: Boolean(row.is_read),
    message: row.message,
    project: row.project_id === null ? null : { id: Number(row.project_id), name: row.project_name },
    readAt: row.read_at ?? null,
    title: row.title,
    type: row.type,
  };
}

/**
 * Lista una página de notificaciones del usuario con el total de no leídas.
 *
 * @param {{ user: object, cursor?: string, limit: number }} options - Sesión y página.
 * @returns {Promise<{ notifications: object[], nextCursor: string|null, unreadCount: number }>} Página.
 * @throws {ValidationError} Si el cursor no es válido.
 */
export async function getUserNotifications({ cursor, limit, user }) {
  const decoded = cursor ? decodeCursor(cursor) : null;
  if (cursor && !decoded) throw new ValidationError("Los datos enviados no son válidos.", { "query.cursor": "Cursor inválido." });
  const userId = Number(user.id);
  const rows = await listUserNotifications({
    clientId: user.clientId ? Number(user.clientId) : null,
    cursor: decoded,
    limit,
    roleCode: user.role?.code ?? "",
    userId,
  });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    nextCursor: rows.length > limit && last ? encodeCursor([String(last.cursor_value), String(last.id)]) : null,
    notifications: page.map(toNotification),
    unreadCount: await countUnreadNotifications(userId),
  };
}

/**
 * Marca como leída una notificación propia y devuelve el nuevo total de no leídas.
 *
 * @param {{ notificationId: number, user: object }} request - Notificación y sesión.
 * @returns {Promise<{ notification: { id: number, isRead: true, readAt: Date }, unreadCount: number }>} Resultado.
 * @throws {NotFoundError} NOTIFICATION_NOT_FOUND si no existe o es de otro usuario (sin distinguirlo).
 */
export async function readUserNotification({ notificationId, user }) {
  const userId = Number(user.id);
  const updated = await markNotificationRead({ notificationId, userId });
  if (!updated) throw new NotFoundError("NOTIFICATION_NOT_FOUND", "Notificación no encontrada.");
  return {
    notification: { id: Number(updated.id), isRead: true, readAt: updated.read_at },
    unreadCount: await countUnreadNotifications(userId),
  };
}
