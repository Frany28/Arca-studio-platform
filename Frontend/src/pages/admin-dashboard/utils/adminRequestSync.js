// Estados que el overview lista en «Nuevas solicitudes» (mismo filtro que el backend).
const OVERVIEW_REQUEST_STATUSES = new Set(["pending_verification", "pending_review"]);

/**
 * Reconcilia «Nuevas solicitudes» con una decisión confirmada antes de que llegue la nueva
 * lectura: la solicitud que salió de verificación o revisión deja de listarse y, si sigue
 * pendiente, adopta el estado devuelto por la API. No inventa datos ni reordena la lista.
 *
 * @param {Object|null} overview - Overview mostrado.
 * @param {{id: number|string, status: string}|null|undefined} decidedRequest - Estado confirmado.
 * @returns {Object|null} Overview reconciliado (el mismo objeto si no hay cambios).
 */
export function removeDecidedOverviewRequest(overview, decidedRequest) {
  if (!overview || decidedRequest?.id == null || !decidedRequest.status) return overview;
  const requests = overview.newRequests || [];
  const decidedId = String(decidedRequest.id);
  if (!requests.some((request) => String(request.id) === decidedId)) return overview;

  const newRequests = OVERVIEW_REQUEST_STATUSES.has(decidedRequest.status)
    ? requests.map((request) => (String(request.id) === decidedId ? { ...request, status: decidedRequest.status } : request))
    : requests.filter((request) => String(request.id) !== decidedId);
  return { ...overview, newRequests };
}
