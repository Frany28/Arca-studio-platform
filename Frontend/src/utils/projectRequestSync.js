import { getProjectRequestStatus } from "./projectRequestStatus.js";

/*
 * Reglas compartidas de sincronización de solicitudes de proyecto entre el dashboard, la cola
 * técnica y la consulta administrativa. Sin tiempo real: las vistas se actualizan con la
 * respuesta de una mutación confirmada, invalidan las lecturas relacionadas y revalidan al
 * volver a la pestaña o recuperar la conexión. Estos helpers solo deciden qué cambió y qué se
 * comunica; no leen ni guardan datos.
 */

// Errores de la API que indican que la copia local de la solicitud ya no refleja PostgreSQL:
// otra persona la decidió, cerró o eliminó. Exigen volver a leer, no reintentar a ciegas.
// Otros conflictos (por ejemplo, nombre de proyecto repetido o revisión requerida) no
// cambian el estado y conservan la copia actual.
const STALE_PROJECT_REQUEST_ERROR_CODES = new Set([
  "PROJECT_REQUEST_CLOSED",
  "PROJECT_REQUEST_INVALID_STATE",
  "PROJECT_REQUEST_NOT_FOUND",
]);

/**
 * Indica si un error de mutación revela que la solicitud cambió o desapareció en el backend.
 *
 * @param {{code?: string}|null|undefined} error - Error normalizado por el cliente HTTP.
 * @returns {boolean} true si conviene revalidar la solicitud y sus listas.
 */
export function isStaleProjectRequestError(error) {
  return STALE_PROJECT_REQUEST_ERROR_CODES.has(error?.code);
}

/**
 * Huella de los datos de una solicitud que pueden cambiar por acciones de otros usuarios:
 * estado, decisión, proyecto convertido, responsables, revisiones y compatibilidad guardada.
 * Se compara entre lecturas para saber si una revalidación trajo cambios reales.
 *
 * @param {Object|null} request - Solicitud leída de la API.
 * @returns {string} Huella estable; vacía si no hay solicitud.
 */
export function getProjectRequestSyncSignature(request) {
  if (!request) return "";
  return JSON.stringify([
    request.status ?? null,
    request.updatedAt ?? null,
    request.reviewedAt ?? null,
    request.convertedProject?.id ?? null,
    (request.assignees || []).map((assignee) => String(assignee.id)).sort(),
    (request.reviews || []).map((review) => [review.reviewer?.id ?? null, review.updatedAt ?? null]),
    request.compatibility?.score ?? null,
  ]);
}

/**
 * Compara dos lecturas de la misma solicitud mediante su huella de sincronización.
 *
 * @param {Object|null} previous - Lectura mostrada.
 * @param {Object|null} next - Lectura nueva.
 * @returns {boolean} true si la nueva lectura trae cambios visibles.
 */
export function hasProjectRequestChanged(previous, next) {
  return getProjectRequestSyncSignature(previous) !== getProjectRequestSyncSignature(next);
}

/**
 * Aviso informativo (no de éxito) para cambios hechos por otras personas y confirmados por una
 * nueva lectura. Nombra el nuevo estado cuando cambió; si no, describe la actualización.
 *
 * @param {Object} previous - Lectura mostrada antes de revalidar.
 * @param {Object} next - Lectura confirmada por la API.
 * @returns {{theme: "Info", title: string, content: string, description: string}} Aviso.
 */
export function getExternalProjectRequestUpdateFeedback(previous, next) {
  const statusChanged = previous?.status !== next?.status;
  return {
    content: next?.projectName || "",
    description: statusChanged
      ? `Ahora está en estado «${getProjectRequestStatus(next?.status).label}». Se muestra la información más reciente.`
      : "Se registraron cambios en responsables o revisiones. Se muestra la información más reciente.",
    theme: "Info",
    title: "Solicitud actualizada",
  };
}

/**
 * Aviso de éxito de una decisión administrativa confirmada por la API. La aprobación informa
 * también del proyecto creado por el backend, con el nombre que devolvió la respuesta.
 *
 * @param {Object} request - Solicitud decidida.
 * @param {"approve"|"reject"|"changes_requested"} action - Decisión enviada.
 * @param {{project?: {name?: string}|null}|null} [result] - Respuesta de la decisión.
 * @returns {{theme: "Success", title: string, content: string, description: string}} Aviso.
 */
export function getProjectRequestDecisionFeedback(request, action, result) {
  if (action === "approve") {
    return {
      content: result?.project?.name || request?.projectName || "",
      description: "Proyecto creado correctamente.",
      theme: "Success",
      title: "Solicitud aprobada",
    };
  }
  if (action === "reject") {
    return {
      content: request?.projectName || "",
      description: "El cliente recibirá el motivo del rechazo.",
      theme: "Success",
      title: "Solicitud rechazada",
    };
  }
  return {
    content: request?.projectName || "",
    description: "El cliente podrá editar la solicitud y volver a enviarla.",
    theme: "Success",
    title: "Correcciones solicitadas",
  };
}

/**
 * Aviso de éxito de la revisión técnica guardada por un arquitecto asignado.
 *
 * @param {Object} request - Solicitud revisada.
 * @returns {{theme: "Success", title: string, content: string, description: string}} Aviso.
 */
export function getProjectRequestReviewFeedback(request) {
  return {
    content: request?.projectName || "",
    description: "La administración ya puede consultar tu recomendación.",
    theme: "Success",
    title: "Revisión guardada",
  };
}
