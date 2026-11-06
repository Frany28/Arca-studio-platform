import { useEffect, useMemo, useRef, useState } from "react";

import { buildAdminRequestDetails, findRequestById } from "../utils/adminRequestDetails.js";
import { useAdminRequestClient } from "./useAdminRequestClient.js";

/**
 * Coordina el drawer "Detalles de Solicitud" del dashboard administrativo.
 * No realiza lecturas propias de la solicitud: combina el overview y la cola técnica que
 * el dashboard ya cargó, y delega la lectura del cliente en `useAdminRequestClient`.
 *
 * Conserva el ID seleccionado al cerrar para que el contenido no desaparezca durante la
 * animación de salida del drawer. Las decisiones del menú cierran el drawer y abren el modal
 * de workflow existente, evitando dos diálogos modales apilados; «Ver solicitud» navega a la
 * consulta completa desde el dashboard.
 *
 * @param {Object} params - Fuentes ya cargadas y apertura del workflow.
 * @param {Array} params.newRequests - Solicitudes de `overview.newRequests`.
 * @param {{requests: Array, loading: boolean, loadingMore: boolean, error: string, retry: Function, loadUntil: Function}} params.reviewQueue - Cola técnica paginada.
 * @param {(request: Object, options?: {initialAction?: string}) => void} params.openRequestWorkflow - Abre el modal de decisión.
 * @returns {Object} Estado de apertura, vista resuelta, cliente y acciones del drawer.
 */
export function useAdminRequestDetails({ newRequests, reviewQueue, openRequestWorkflow }) {
  const [selection, setSelection] = useState({ open: false, requestId: null });
  const summary = findRequestById(newRequests, selection.requestId);
  const queueRequest = findRequestById(reviewQueue.requests, selection.requestId);
  const details = useMemo(
    () => (summary ? buildAdminRequestDetails({ queueRequest, summary }) : null),
    [queueRequest, summary],
  );
  // Una búsqueda por solicitud abierta: si una página falla no se reintenta en bucle; el
  // reintento explícito de la cola vuelve a habilitarla.
  const lookedUpRef = useRef(null);
  const { hasMore, loadUntil, loading: queueLoading, loadingMore } = reviewQueue;
  const shouldLookUp = selection.open && Boolean(summary) && !queueRequest && !queueLoading && !loadingMore && hasMore;
  useEffect(() => {
    if (!shouldLookUp || lookedUpRef.current === selection.requestId) return;
    lookedUpRef.current = selection.requestId;
    void loadUntil?.(selection.requestId);
  }, [loadUntil, selection.requestId, shouldLookUp]);
  const client = useAdminRequestClient({
    userId: details?.clientUserId ?? null,
    enabled: selection.open,
  });

  // La cola puede seguir cargando al abrir el drawer (primera página o las siguientes, si la
  // solicitud no estaba en la primera); sin ella faltarían compatibilidad, revisiones y cliente.
  let status = "ready";
  if (!summary) status = "missing";
  else if (!queueRequest && (reviewQueue.loading || reviewQueue.loadingMore)) status = "loading";

  /**
   * Abre el drawer para la solicitud elegida en "Nuevas solicitudes". Si no está entre las
   * páginas cargadas de la cola, recorre las siguientes para mostrar sus datos completos.
   *
   * @param {{id: number|string}} request - Solicitud del overview.
   * @returns {void}
   */
  const open = (request) => setSelection({ open: true, requestId: request.id });

  const close = () => setSelection((current) => ({ ...current, open: false }));

  /**
   * Cierra el drawer y abre el modal de workflow con la acción preseleccionada.
   * Prefiere la versión de la cola porque incluye descripción, archivos y revisiones.
   *
   * @param {string} [initialAction] - approve, reject o changes_requested; omitido muestra la vista por defecto.
   * @returns {void}
   */
  const openWorkflow = (initialAction) => {
    const request = queueRequest || summary;
    if (!request) return;
    close();
    openRequestWorkflow(request, { initialAction });
  };

  return {
    client,
    close,
    details,
    isOpen: selection.open,
    open,
    openWorkflow,
    queueError: queueRequest ? "" : reviewQueue.error,
    retryQueue: () => {
      lookedUpRef.current = null;
      reviewQueue.retry();
    },
    status,
  };
}
