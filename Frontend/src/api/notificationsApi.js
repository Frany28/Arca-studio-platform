import { apiRequest, toQueryString } from "./client.js";

// Notificaciones del usuario autenticado (/notifications). El backend limita todo a la sesión: no
// existe forma de pedir las de otro usuario.
export const notificationsApi = {
  /**
   * Lista una página de notificaciones propias con el total de no leídas.
   *
   * @param {{ cursor?: string, limit?: number, signal?: AbortSignal }} [params] - Página y cancelación.
   * @returns {Promise<{ notifications: Array<Object>, nextCursor: string|null, unreadCount: number }>} Página.
   */
  list({ cursor, limit, signal } = {}) {
    return apiRequest(`/notifications${toQueryString({ cursor, limit })}`, { signal });
  },

  /**
   * Marca como leída una notificación propia (idempotente).
   *
   * @param {{ notificationId: number, signal?: AbortSignal }} params - Notificación y cancelación.
   * @returns {Promise<{ notification: Object, unreadCount: number }>} Estado nuevo.
   */
  markRead({ notificationId, signal }) {
    return apiRequest(`/notifications/${encodeURIComponent(notificationId)}/read`, { method: "PATCH", signal });
  },
};
