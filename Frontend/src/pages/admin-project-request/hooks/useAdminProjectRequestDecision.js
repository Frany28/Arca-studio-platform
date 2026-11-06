import { invalidateAdminDashboardOverview } from "../../../api/adminDashboardOverview.js";
import { useProjectRequestWorkflowSelection } from "../../../hooks/useProjectRequestWorkflowSelection.js";
import { applyAdminDecisionResult } from "../../../utils/projectRequestAdminActions.js";
import { getProjectRequestDecisionFeedback } from "../../../utils/projectRequestSync.js";
import { submitAdminRequestDecision } from "../../admin-dashboard/utils/adminRequestDecision.js";

/**
 * Decisiones administrativas desde la consulta de una solicitud (Rechazar, Solicitar más
 * información y Aprobar). Reutiliza el modal de decisión, su validación del motivo y su botón
 * «Confirmar decisión», y la misma operación que el dashboard (`PATCH .../decision`); no
 * reconstruye reglas: el backend valida el estado y las revisiones necesarias.
 *
 * Sincronización tras la confirmación (Fase 2):
 * - La solicitud mostrada refleja de inmediato el estado devuelto por la API.
 * - Se invalida la caché del overview del dashboard; cola, métricas y proyectos se leen al
 *   volver a él, y el overview ya no reutiliza la lectura anterior.
 * - El detalle se relee en segundo plano sin reutilizar lecturas previas a la decisión, para
 *   incorporar el proyecto creado; el aviso es el de éxito propio, no «Solicitud actualizada».
 * - Un conflicto de estado (otra persona decidió) invalida el overview y relee el detalle con
 *   el aviso de cambios externos; el modal conserva el borrador y muestra el error.
 *
 * @param {Object} params - Acciones del detalle y de su sincronización.
 * @param {(requestId: number|string, update: Function) => void} params.applyConfirmedChange - Parche del detalle.
 * @param {(options?: {fresh?: boolean}) => Promise<Object>} params.revalidate - Relectura silenciosa del detalle.
 * @param {(options?: {fresh?: boolean}) => Promise<void>} params.revalidateWithFeedback - Relectura con aviso de cambios externos.
 * @returns {ReturnType<typeof useProjectRequestWorkflowSelection>} Estado y acciones del modal de decisión.
 */
export function useAdminProjectRequestDecision({ applyConfirmedChange, revalidate, revalidateWithFeedback }) {
  /**
   * Aplica una decisión confirmada a la consulta y programa las lecturas relacionadas.
   *
   * @param {Object} request - Solicitud decidida.
   * @param {Object} result - Respuesta de la decisión.
   * @returns {void}
   */
  const reflectDecision = (request, result) => {
    applyConfirmedChange(request.id, (current) => applyAdminDecisionResult(current, result));
    invalidateAdminDashboardOverview();
    void revalidate({ fresh: true });
  };

  return useProjectRequestWorkflowSelection({
    getSuccessFeedback: (request, values, result) => getProjectRequestDecisionFeedback(request, values.action, result),
    onStaleError: () => {
      invalidateAdminDashboardOverview();
      void revalidateWithFeedback({ fresh: true });
    },
    submitOperation: (request, values) => submitAdminRequestDecision(request, values, (result) => reflectDecision(request, result)),
  });
}
