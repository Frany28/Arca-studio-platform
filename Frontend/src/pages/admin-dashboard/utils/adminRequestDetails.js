import { getCompatibilityPresentation } from "../../../utils/projectRequestCompatibility.js";
import {
  getCompletenessPresentation,
  getFinancialViabilityPresentation,
} from "../../../utils/projectRequestMetrics.js";
import { getProjectRequestStatus } from "../../../utils/projectRequestStatus.js";
import { getProjectTypeLabel } from "../../../utils/projectTypeDisplay.js";
import { getMeetingRecommendationPresentation } from "../../../utils/projectRequestMeetingRecommendation.js";

/**
 * Selecciona la revisión técnica más reciente de una solicitud.
 * No depende del orden de la API: compara `updatedAt` y descarta fechas inválidas al final.
 *
 * @param {Array<{updatedAt?: string}>|null|undefined} reviews - Revisiones de arquitectos.
 * @returns {Object|null} Revisión más reciente o null si no existe ninguna.
 */
export function getLatestRequestReview(reviews) {
  if (!Array.isArray(reviews) || !reviews.length) return null;

  const toTime = (review) => {
    const time = new Date(review?.updatedAt).getTime();
    return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
  };
  return reviews.reduce((latest, review) => (toTime(review) > toTime(latest) ? review : latest));
}

/**
 * Construye el modelo del drawer "Detalles de Solicitud" combinando el resumen del overview
 * administrativo con la entrada de la cola técnica (ubicación, compatibilidad, revisiones).
 * Si la solicitud no está en la primera página de la cola, `isPartial` indica que faltan
 * esos datos para que la vista muestre estados vacíos en lugar de valores inventados.
 * La reunión y la nota salen de la misma revisión; una histórica reciente no hereda
 * reuniones anteriores. Completitud y viabilidad financiera son métricas propias de la API,
 * independientes de la compatibilidad; si faltan quedan en null para mostrar estados vacíos.
 * `clientUserId` procede de requestedBy; clientId conserva la identidad comercial del cliente.
 *
 * @param {Object} params - Fuentes ya cargadas por el dashboard.
 * @param {Object} params.summary - Solicitud de `overview.newRequests`.
 * @param {Object|null} [params.queueRequest] - Misma solicitud en `reviewQueue.requests`.
 * @returns {Object} Modelo de presentación del drawer.
 */
export function buildAdminRequestDetails({ summary, queueRequest = null }) {
  const source = { ...summary, ...(queueRequest || {}) };
  const status = getProjectRequestStatus(source.status);
  const latestReview = getLatestRequestReview(queueRequest?.reviews);

  return {
    clientId: queueRequest?.clientId ?? null,
    clientUserId: queueRequest?.requestedBy ?? null,
    compatibility: getCompatibilityPresentation(queueRequest?.compatibility),
    completeness: getCompletenessPresentation(queueRequest?.completeness),
    createdAt: source.createdAt || null,
    financialViability: getFinancialViabilityPresentation(queueRequest?.financialViability),
    id: source.id,
    isPartial: !queueRequest,
    justification: latestReview?.note?.trim() || null,
    location: queueRequest?.location?.trim() || null,
    projectName: source.projectName || "Solicitud de proyecto",
    projectTypeLabel: getProjectTypeLabel(source.projectType, "Sin tipo registrado"),
    recommendation: getMeetingRecommendationPresentation(latestReview?.meetingRecommendation),
    reviewerName: latestReview?.reviewer?.name || null,
    status: { label: status.label, theme: status.badgeTheme },
  };
}

/**
 * Busca una solicitud por ID numérico; los IDs pueden llegar como texto desde la UI.
 *
 * @param {Array<{id: number|string}>|null|undefined} requests - Colección donde buscar.
 * @param {number|string|null} requestId - ID buscado.
 * @returns {Object|null} Solicitud encontrada o null.
 */
export function findRequestById(requests, requestId) {
  if (requestId == null || !Array.isArray(requests)) return null;
  return requests.find((request) => Number(request.id) === Number(requestId)) || null;
}
