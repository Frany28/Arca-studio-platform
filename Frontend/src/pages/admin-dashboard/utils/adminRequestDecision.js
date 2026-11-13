import { api } from "../../../api/http.js";

/**
 * Traduce la decisión administrativa y la guarda sin crear proyectos localmente.
 * Tras la confirmación notifica al dashboard para refrescar overview, métricas y proyectos.
 * El workflow común conserva el estado del modal y la recarga de cola.
 *
 * @param {Object} request - Solicitud activa cuyo ID identifica la decisión.
 * @param {Object} values - Acción y nota normalizadas por el formulario.
 * @param {string} values.action - approve, reject o changes_requested.
 * @param {string} values.note - Nota interna al aprobar o motivo para las otras acciones.
 * @param {boolean} [values.acknowledgeOutdatedReviews] - Confirma aprobar con revisiones desactualizadas.
 * @param {string} [values.outdatedReviewsJustification] - Justificación auditada de esa excepción.
 * @param {Function} onAdminDecisionCommitted - Recibe la respuesta y programa los refrescos externos; no se espera su retorno.
 * @returns {Promise<{project: Object|null, projectRequest: Object}>} Respuesta confirmada: estado
 *   vigente de la solicitud y, al aprobar, el proyecto creado por el backend.
 * @throws {Error} Propaga fallos de API o errores síncronos del callback al workflow.
 */
export async function submitAdminRequestDecision(request, { acknowledgeOutdatedReviews, action, note, outdatedReviewsJustification }, onAdminDecisionCommitted) {
  const approving = action === "approve";
  const result = await api.admin.decideProjectRequest({
    acknowledgeOutdatedReviews: approving && acknowledgeOutdatedReviews === true ? true : undefined,
    action: action === "changes_requested" ? "request_changes" : action,
    outdatedReviewsJustification: approving && acknowledgeOutdatedReviews === true ? outdatedReviewsJustification : undefined,
    internalNotes: action === "approve" ? note || undefined : undefined,
    projectRequestId: request.id,
    reason: action === "approve" ? undefined : note,
  });
  // El backend decide la conversión; la página vuelve a leer los proyectos.
  onAdminDecisionCommitted(result);
  return result;
}
