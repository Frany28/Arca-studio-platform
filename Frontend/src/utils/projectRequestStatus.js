export const PROJECT_REQUEST_STATUS = {
  approved: { label: "Aprobada", progress: 90 },
  changes_requested: { label: "Requiere correcciones", progress: 40 },
  converted: { label: "Proyecto creado", progress: 100 },
  pending_review: { label: "En revisión", progress: 65 },
  pending_verification: { label: "En verificación", progress: 30 },
  rejected: { label: "Rechazada", progress: 100 },
};

/**
 * Resuelve etiqueta y progreso visual desde el catálogo de solicitudes.
 * Estados desconocidos, incluido draft, usan Solicitud enviada con progreso 15.
 *
 * @param {string|null} status - Código de estado.
 * @returns {Object} label y progress de presentación.
 */
export function getProjectRequestStatus(status) {
  return PROJECT_REQUEST_STATUS[status] || {
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
 * Considera cerradas las solicitudes approved, converted o rejected.
 * Esta clasificación es independiente de si existe ya un proyecto convertido.
 *
 * @param {string|null} status - Estado de la solicitud.
 * @returns {boolean} Si la solicitud está cerrada.
 */
export function isProjectRequestClosed(status) {
  return ["approved", "converted", "rejected"].includes(status);
}
