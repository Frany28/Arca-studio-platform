import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../api/http.js";
import { formatRelativeTime } from "../utils/relativeTime.js";

const PAGE_SIZE = 20;
const EMPTY = Object.freeze({ error: "", loaded: false, loading: false, loadingMore: false, nextCursor: null, notifications: [], unreadCount: 0 });
const LOAD_ERROR = "No se pudieron cargar tus notificaciones.";

// Etiqueta del estado del evento en la tarjeta (Badge de ActivityItem).
const STATUS_LABELS = Object.freeze({
  "project_file.version_approved": "Archivo aprobado",
  "project_file.version_rejected": "Archivo rechazado",
  "project_request.changes_requested": "Correcciones solicitadas",
  "project_request.converted": "Solicitud aprobada",
  "project_request.rejected": "Solicitud rechazada",
});

/**
 * Adapta una notificación de la API a la tarjeta de actividad del drawer (ActivityItem): remitente
 * ARCA Studio, mensaje completo (incluye el motivo de un rechazo), estado del evento y, solo si el
 * usuario aún puede abrirlo, el proyecto. `unread` marca las nuevas.
 *
 * @param {Object} notification - Notificación de la API.
 * @param {number} [now] - Instante de referencia para la fecha relativa.
 * @returns {Object} Elemento para ActivityItem y el contexto original.
 */
export function toNotificationActivity(notification, now = Date.now()) {
  return {
    action: notification.message,
    id: `notification-${notification.id}`,
    name: "ARCA Studio",
    notification,
    projectName: notification.project?.name ?? undefined,
    status: STATUS_LABELS[notification.type] || notification.title,
    timestamp: formatRelativeTime(notification.createdAt, now),
    type: "status",
    unread: !notification.isRead,
  };
}

/**
 * Notificaciones del usuario autenticado para el drawer: primera página al abrirlo, «Mostrar más» con
 * la siguiente, total de no leídas y marca de lectura optimista (se revierte si la API falla). Cerrar
 * el drawer o desmontar aborta las lecturas; una respuesta obsoleta nunca sustituye a la vigente.
 *
 * @param {{ enabled: boolean }} options - Activa la lectura (drawer abierto y usuario no administrador).
 * @returns {{ items: Array<Object>, unreadCount: number, loading: boolean, loadingMore: boolean, error: string,
 *   hasMore: boolean, refresh: () => void, loadMore: () => Promise<void>, markRead: (notification: Object) => Promise<void> }}
 *   Estado y acciones.
 */
export function useUserNotifications({ enabled }) {
  const [state, setState] = useState(EMPTY);
  const [requestKey, setRequestKey] = useState(0);
  const moreRequest = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) setState((current) => ({ ...current, error: "", loading: true }));
    });
    api.notifications.list({ limit: PAGE_SIZE, signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted) return;
        setState({ ...EMPTY, loaded: true, nextCursor: payload?.nextCursor || null, notifications: payload?.notifications || [], unreadCount: Number(payload?.unreadCount) || 0 });
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.name === "AbortError") return;
        setState((current) => ({ ...current, error: error?.message || LOAD_ERROR, loading: false }));
      });
    return () => {
      controller.abort();
      moreRequest.current?.abort();
      moreRequest.current = null;
    };
  }, [enabled, requestKey]);

  const loadMore = useCallback(async () => {
    if (!state.nextCursor || moreRequest.current) return;
    const controller = new AbortController();
    moreRequest.current = controller;
    setState((current) => ({ ...current, loadingMore: true }));
    try {
      const payload = await api.notifications.list({ cursor: state.nextCursor, limit: PAGE_SIZE, signal: controller.signal });
      if (controller.signal.aborted) return;
      setState((current) => {
        const known = new Set(current.notifications.map((notification) => notification.id));
        return {
          ...current,
          loadingMore: false,
          nextCursor: payload?.nextCursor || null,
          notifications: [...current.notifications, ...(payload?.notifications || []).filter((notification) => !known.has(notification.id))],
        };
      });
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") return;
      setState((current) => ({ ...current, error: error?.message || LOAD_ERROR, loadingMore: false }));
    } finally {
      if (moreRequest.current === controller) moreRequest.current = null;
    }
  }, [state.nextCursor]);

  const markRead = useCallback(async (notification) => {
    if (!notification || notification.isRead) return;
    const setRead = (isRead) => setState((current) => ({
      ...current,
      notifications: current.notifications.map((candidate) => (candidate.id === notification.id ? { ...candidate, isRead } : candidate)),
      unreadCount: Math.max(0, current.unreadCount + (isRead ? -1 : 1)),
    }));
    setRead(true);
    try {
      const result = await api.notifications.markRead({ notificationId: notification.id });
      if (Number.isFinite(result?.unreadCount)) setState((current) => ({ ...current, unreadCount: result.unreadCount }));
    } catch {
      setRead(false);
    }
  }, []);

  return {
    error: state.error,
    hasMore: Boolean(state.nextCursor),
    items: state.notifications.map((notification) => toNotificationActivity(notification)),
    loadMore,
    loading: enabled && (state.loading || (!state.loaded && !state.error)),
    loadingMore: state.loadingMore,
    markRead,
    refresh: () => setRequestKey((key) => key + 1),
    unreadCount: state.unreadCount,
  };
}
