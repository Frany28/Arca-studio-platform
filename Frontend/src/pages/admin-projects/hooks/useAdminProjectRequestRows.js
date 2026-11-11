import { useEffect, useMemo, useState } from "react";

import { api } from "../../../api/http.js";
import { toProjectRequestRow } from "../utils/projectRequestRows.js";

// Máximo de páginas leídas por carga (100 solicitudes cada una): evita un bucle sin fin si el
// cursor no avanzara.
const MAX_PAGES = 20;

/**
 * Lee todas las páginas de solicitudes abiertas para mostrarlas en la tabla de Gestión de
 * proyectos. Cada lectura cancela la anterior al cambiar `requestKey` o desmontar.
 *
 * @param {AbortSignal} signal - Cancelación de la carga.
 * @returns {Promise<Array<Object>>} Solicitudes abiertas.
 */
async function loadAllOpenRequests(signal) {
  const requests = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await api.admin.listOpenProjectRequests({ cursor, signal });
    requests.push(...(data.projectRequests || []));
    cursor = data.nextCursor || null;
    if (!cursor) break;
  }
  return requests;
}

/**
 * Solicitudes abiertas como filas de la tabla de proyectos y asignación de sus responsables
 * con el contrato administrativo de solicitudes. Un fallo de lectura no oculta los proyectos:
 * se informa en `requestsError`.
 *
 * @param {{enabled: boolean, requestKey: number}} params - Habilita la lectura y fuerza recargas.
 * @returns {{requestRows: Array<Object>, requestsLoading: boolean, requestsError: string,
 *   updateRequestAssignees: (row: Object, assignees: Array<Object>) => Promise<void>}} Filas y acciones.
 */
export function useAdminProjectRequestRows({ enabled, requestKey }) {
  const [requests, setRequests] = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(enabled);
  const [requestsError, setRequestsError] = useState("");

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setRequestsLoading(true);
      setRequestsError("");
    });
    loadAllOpenRequests(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setRequests(data);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setRequests([]);
        setRequestsError("No se pudieron cargar las solicitudes.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setRequestsLoading(false);
      });
    return () => controller.abort();
  }, [enabled, requestKey]);

  const requestRows = useMemo(() => requests.map(toProjectRequestRow), [requests]);

  /**
   * Guarda los responsables de una solicitud y actualiza su fila con la respuesta del servidor.
   * Los errores se propagan al control de asignación, que publica su aviso.
   *
   * @param {{requestId: number}} row - Fila de la solicitud.
   * @param {Array<{id: number}>} assignees - Responsables seleccionados.
   * @returns {Promise<void>}
   */
  async function updateRequestAssignees(row, assignees) {
    const data = await api.admin.updateProjectRequestAssignees({
      assigneeIds: assignees.map((assignee) => Number(assignee.id)),
      projectRequestId: row.requestId,
    });
    setRequests((current) => current.map((request) => (
      request.id === row.requestId ? { ...request, assignees: data.assignees || [] } : request
    )));
  }

  return { requestRows, requestsError, requestsLoading, updateRequestAssignees };
}
