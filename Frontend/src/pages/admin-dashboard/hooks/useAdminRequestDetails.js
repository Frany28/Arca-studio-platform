import { useMemo, useState } from "react";

import { buildAdminRequestDetails, findRequestById } from "../utils/adminRequestDetails.js";
import { useAdminRequestClient } from "./useAdminRequestClient.js";

/**
 * Coordina el drawer "Detalles de Solicitud" del dashboard administrativo.
 * No realiza lecturas propias de la solicitud: combina el overview y la cola técnica que
 * el dashboard ya cargó, y delega la lectura del cliente en `useAdminRequestClient`.
 *
 * Conserva el ID seleccionado al cerrar para que el contenido no desaparezca durante la
 * animación de salida del drawer. Ver solicitud y las decisiones cierran el drawer y abren
 * el modal de workflow existente, evitando dos diálogos modales apilados.
 *
 * @param {Object} params - Fuentes ya cargadas y apertura del workflow.
 * @param {Array} params.newRequests - Solicitudes de `overview.newRequests`.
 * @param {{requests: Array, loading: boolean, error: string, retry: Function}} params.reviewQueue - Cola técnica.
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
  const client = useAdminRequestClient({
    clientId: details?.clientId ?? null,
    enabled: selection.open,
  });

  // La cola puede seguir cargando al abrir el drawer; la solicitud del overview existe,
  // pero sin la cola faltarían compatibilidad, revisiones y cliente.
  let status = "ready";
  if (!summary) status = "missing";
  else if (!queueRequest && reviewQueue.loading) status = "loading";

  /**
   * Abre el drawer para la solicitud elegida en "Nuevas solicitudes".
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
    retryQueue: reviewQueue.retry,
    status,
  };
}
