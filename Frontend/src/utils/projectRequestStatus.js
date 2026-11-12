// badgeTheme sigue los temas semánticos de `Badge` definidos en DESIGN_SYSTEM.md
// (Neutral: solicitud pendiente; Brand 2: en revisión; Success; Danger).
export const PROJECT_REQUEST_STATUS = {
  approved: { badgeTheme: "Success", label: "Aprobada", progress: 90 },
  changes_requested: { badgeTheme: "Neutral", label: "Requiere correcciones", progress: 40 },
  converted: { badgeTheme: "Success", label: "Proyecto creado", progress: 100 },
  pending_review: { badgeTheme: "Brand 2", label: "En revisión", progress: 65 },
  pending_verification: { badgeTheme: "Neutral", label: "En verificación", progress: 30 },
  rejected: { badgeTheme: "Danger", label: "Rechazada", progress: 100 },
};

/**
 * Resuelve etiqueta, progreso visual y tema de Badge desde el catálogo de solicitudes.
 * Estados desconocidos, incluido draft, usan Solicitud enviada con progreso 15 y tema Neutral.
 *
 * @param {string|null} status - Código de estado.
 * @returns {{badgeTheme: string, label: string, progress: number}} Datos de presentación.
 */
export function getProjectRequestStatus(status) {
  return PROJECT_REQUEST_STATUS[status] || {
    badgeTheme: "Neutral",
    label: "Solicitud enviada",
    progress: 15,
  };
}

/**
 * Permite edición de solicitudes únicamente en draft o changes_requested.
 * Evalúa el estado exacto, sin comprobar autoría ni permisos de API.
 *
 * @param {string|null} status - Estado de la solicitud.
 * @returns {boolean} Si el estado admite edición.
 */
export function isProjectRequestEditable(status) {
  return status === "draft" || status === "changes_requested";
}

/**
 * Indica si la solicitud sigue en evaluación (verificación administrativa o revisión técnica),
 * es decir, si todavía no existe una decisión que mostrar al cliente.
 *
 * @param {string|null} status - Estado de la solicitud.
 * @returns {boolean} Si el estado es pending_verification o pending_review.
 */
export function isProjectRequestUnderEvaluation(status) {
  return status === "pending_verification" || status === "pending_review";
}

/**
 * Motivo que corresponde al estado vigente de la solicitud: `rejectionReason` para un rechazo y
 * `correctionReason` para correcciones pendientes. El backend conserva el motivo de una corrección
 * anterior al rechazar, así que el campo nunca se elige por disponibilidad sino por estado: un
 * rechazo no muestra correcciones antiguas. Los demás estados no tienen motivo para el cliente.
 * Nunca lee notas internas.
 *
 * @param {{status?: string, rejectionReason?: string|null, correctionReason?: string|null}|null} projectRequest - Solicitud de la API.
 * @returns {string|null} Motivo recortado o null si el estado no tiene motivo o falta.
 */
export function getProjectRequestClientReason(projectRequest) {
  const reason = projectRequest?.status === "rejected"
    ? projectRequest.rejectionReason
    : projectRequest?.status === "changes_requested"
      ? projectRequest.correctionReason
      : null;
  return typeof reason === "string" && reason.trim() ? reason.trim() : null;
}

/**
 * Considera cerradas las solicitudes approved, converted o rejected.
 * Esta clasificación es independiente de si existe ya un proyecto convertido.
 *
 * @param {string|null} status - Estado de la solicitud.
 * @returns {boolean} Si la solicitud está cerrada.
 */
export function isProjectRequestClosed(status) {
  return ["approved", "converted", "rejected"].includes(status);
}
