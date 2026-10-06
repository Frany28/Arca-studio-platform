import { api } from "../../../api/http.js";

/**
 * Guarda la recomendación técnica de la solicitud mediante la API de revisión.
 * Deja el estado del modal y la recarga de cola al workflow común.
 *
 * @param {Object} request - Solicitud activa cuyo ID identifica la revisión.
 * @param {Object} values - Acción y nota normalizadas por el formulario.
 * @param {string} values.action - Recomendación elegida por el arquitecto.
 * @param {string} values.note - Justificación técnica de la recomendación.
 * @returns {Promise<void>} Finaliza cuando se confirma el guardado.
 * @throws {Error} Propaga fallos de revisión al workflow para permitir reintento.
 */
export async function submitArchitectRequestReview(request, { action, note }) {
  await api.projectRequests.review({
    note,
    projectRequestId: request.id,
    recommendation: action,
  });
}
