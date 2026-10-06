import { useProjectRequestWorkflow } from "../../../hooks/useProjectRequestWorkflow.js";
import { submitArchitectRequestReview } from "../utils/architectRequestReview.js";
import { submitAdminRequestDecision } from "../../admin-dashboard/utils/adminRequestDecision.js";
import { useAdminRequestAssignments } from "../../admin-dashboard/hooks/useAdminRequestAssignments.js";

/**
 * Conserva la fachada del dashboard componiendo estado común y operaciones por rol.
 * El núcleo compartido recibe el envío; asignación y login pertenecen al hook admin.
 * Los callbacks mantienen la sincronización externa sin cambiar el contrato público.
 *
 * @param {Object} params - Contexto del dashboard y sincronización externa.
 * @param {boolean} params.empty - Deshabilita la lectura de la cola en el escenario vacío.
 * @param {string} params.roleCode - Habilita la cola para admin/architect y distingue decisión de revisión.
 * @param {Object|null} params.firstAdminRequest - Solicitud prioritaria del overview para las acciones de login.
 * @param {Function} params.onRequestAssigneesUpdated - Recibe ID y responsables confirmados para actualizar el overview.
 * @param {Function} params.onAdminDecisionCommitted - Solicita refrescar overview, métricas y proyectos tras una decisión admin.
 * @returns {Object} reviewQueue agrupa lectura/error/reintento; workflow, selección/error/envío;
 * assignment, modal/borrador/envío/feedback; loginActions, accesos a asignación y revisión.
 */
export function useDashboardRequestWorkflow({
  empty,
  roleCode,
  firstAdminRequest,
  onRequestAssigneesUpdated,
  onAdminDecisionCommitted,
}) {
  const { reviewQueue, workflow } = useProjectRequestWorkflow({
    enabled: ["admin", "architect"].includes(roleCode) && !empty,
    empty,
    scopeKey: roleCode,
    submitOperation: roleCode === "admin"
      ? (request, values) => submitAdminRequestDecision(request, values, onAdminDecisionCommitted)
      : submitArchitectRequestReview,
  });
  const { assignment, loginActions } = useAdminRequestAssignments({
    firstAdminRequest,
    reviewRequests: reviewQueue.requests,
    openRequestWorkflow: workflow.open,
    retryReviewQueue: reviewQueue.retry,
    onRequestAssigneesUpdated,
  });

  return { reviewQueue, workflow, assignment, loginActions };
}
