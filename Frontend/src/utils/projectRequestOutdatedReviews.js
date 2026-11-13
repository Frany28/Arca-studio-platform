/*
 * Revisiones técnicas anteriores a los últimos cambios relevantes de una solicitud.
 *
 * El backend marca cada revisión (`reviews[].outdated`) y la solicitud (`hasOutdatedReviews`)
 * comparando la fecha de la revisión con la última edición administrativa que cambió respuestas
 * relevantes para la revisión técnica (auditoría `project_request.admin_update`). Estas
 * utilidades solo presentan esa marca; nunca la deducen de `updatedAt`.
 */

// Mismo mínimo que el backend para justificar una aprobación con revisiones desactualizadas.
export const OUTDATED_JUSTIFICATION_MIN_LENGTH = 10;
// Código del 409 con el que el backend rechaza aprobar sin la excepción explícita.
export const OUTDATED_REVIEWS_ERROR_CODE = "PROJECT_REQUEST_REVIEWS_OUTDATED";
// Etiqueta de una revisión que valoró datos que ya cambiaron.
export const OUTDATED_REVIEW_TAG_LABEL = "Anterior a los últimos cambios";

/**
 * Cuenta las revisiones técnicas marcadas como anteriores a los últimos cambios relevantes.
 *
 * @param {{reviews?: Array<{outdated?: boolean}>}|null|undefined} projectRequest - Solicitud del flujo.
 * @returns {number} Revisiones desactualizadas.
 */
export function countOutdatedReviews(projectRequest) {
  return (projectRequest?.reviews || []).filter((review) => review?.outdated === true).length;
}

/**
 * Indica si la solicitud tiene revisiones desactualizadas: la marca de la API o, si una decisión
 * rechazada lo reveló antes de releer, la marca local (`withOutdatedReviewsDetected`).
 *
 * @param {Object|null|undefined} projectRequest - Solicitud del flujo.
 * @returns {boolean} true si alguna revisión es anterior a los últimos cambios relevantes.
 */
export function hasOutdatedReviews(projectRequest) {
  return projectRequest?.hasOutdatedReviews === true || countOutdatedReviews(projectRequest) > 0;
}

/**
 * Explica el aviso de revisiones desactualizadas con su cantidad, si se conoce.
 *
 * @param {Object|null|undefined} projectRequest - Solicitud del flujo.
 * @returns {string} Frase del aviso.
 */
export function describeOutdatedReviews(projectRequest) {
  const count = countOutdatedReviews(projectRequest);
  if (count === 1) return "1 revisión técnica es anterior a los últimos cambios de la solicitud.";
  if (count > 1) return `${count} revisiones técnicas son anteriores a los últimos cambios de la solicitud.`;
  return "Hay revisiones técnicas anteriores a los últimos cambios de la solicitud.";
}

/**
 * Marca localmente la solicitud con revisiones desactualizadas cuando el backend rechaza una
 * aprobación por ese motivo y la copia mostrada aún no lo sabía (otra persona editó entretanto).
 * Así el modal pasa a pedir la confirmación y la justificación sin perder la selección.
 *
 * @param {Object} projectRequest - Solicitud seleccionada en el modal.
 * @returns {Object} Solicitud con `hasOutdatedReviews: true`.
 */
export function withOutdatedReviewsDetected(projectRequest) {
  return { ...projectRequest, hasOutdatedReviews: true };
}
