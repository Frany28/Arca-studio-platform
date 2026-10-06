import { api } from "../../../api/http.js";

/**
 * Guarda la valoración de workflow, la decisión de reunión y la justificación mediante la API.
 * Mantiene esos conceptos separados y deja el estado del modal y la recarga al workflow común.
 *
 * @param {Object} request - Solicitud activa cuyo ID identifica la revisión.
 * @param {Object} values - Valoración, reunión y nota normalizadas por el formulario.
 * @param {string} values.action - Valoración de workflow elegida por el arquitecto.
 * @param {string} values.note - Justificación técnica de la recomendación.
 * @param {string|null} [values.meetingRecommendation] - Decisión de reunión independiente del workflow.
 * @returns {Promise<void>} Finaliza cuando se confirma el guardado.
 * @throws {Error} Propaga fallos de revisión al workflow para permitir reintento.
 */
export async function submitArchitectRequestReview(request, { action, meetingRecommendation, note }) {
  await api.projectRequests.review({
    note,
    meetingRecommendation,
    projectRequestId: request.id,
    recommendation: action,
  });
}
