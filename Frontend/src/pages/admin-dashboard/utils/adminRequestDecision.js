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
 * @param {Function} onAdminDecisionCommitted - Programa los refrescos externos; no se espera su retorno.
 * @returns {Promise<void>} Completa la decisión y notifica su confirmación.
 * @throws {Error} Propaga fallos de API o errores síncronos del callback al workflow.
 */
export async function submitAdminRequestDecision(request, { action, note }, onAdminDecisionCommitted) {
  await api.admin.decideProjectRequest({
    action: action === "changes_requested" ? "request_changes" : action,
    internalNotes: action === "approve" ? note || undefined : undefined,
    projectRequestId: request.id,
    reason: action === "approve" ? undefined : note,
  });
  // El backend decide la conversión; la página vuelve a leer los proyectos.
  onAdminDecisionCommitted();
}
