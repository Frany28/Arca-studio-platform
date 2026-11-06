/**
 * Disponibilidad de las acciones de la barra inferior de la consulta administrativa (Figma
 * 3727:687292; «Crear cotización», variantes 5749:491810 y 5749:492214) según el estado real de
 * la solicitud. Es una ayuda de interfaz: el backend sigue siendo la autoridad y rechaza con 409
 * cualquier decisión inválida (`PROJECT_REQUEST_INVALID_STATE`, `PROJECT_REQUEST_REVIEW_REQUIRED`).
 *
 * Política (ver `decideProjectRequest` en el backend y «Solicitudes de proyecto» en DESIGN_SYSTEM):
 * - `pending_review`: Rechazar, Solicitar más información y Aprobar habilitadas. Que exista una
 *   revisión válida de un arquitecto asignado lo comprueba el backend al confirmar.
 * - `pending_verification`: las decisiones se muestran deshabilitadas con el motivo; la revisión
 *   técnica empieza al asignar el primer arquitecto.
 * - `changes_requested`, `rejected` y `converted`: ya decididas; no se ofrecen decisiones.
 * - `converted` con proyecto vigente: «Ver proyecto» y «Crear cotización» (la cotización necesita
 *   cliente y proyecto, y el proyecto solo existe tras la aprobación).
 */

// Orden visual de Figma: la acción destructiva primero y la principal al final.
export const ADMIN_REQUEST_DECISION_ACTIONS = Object.freeze([
  { id: "reject", label: "Rechazar", theme: "Danger", type: "Outline" },
  { id: "changes_requested", label: "Solicitar más información", theme: "Info", type: "Outline" },
  { id: "approve", label: "Aprobar", theme: "Primary", type: "Solid" },
]);

const PENDING_VERIFICATION_NOTICE =
  "Para decidir, asigna un arquitecto y espera su revisión técnica.";

/**
 * Acciones disponibles para la solicitud mostrada.
 *
 * @param {Object|null} projectRequest - Detalle administrativo de la API.
 * @returns {{decisions: {disabled: boolean, notice: string}|null, convertedProject: Object|null,
 *   canCreateQuote: boolean}} Decisiones (null si no se ofrecen), proyecto creado y cotización.
 */
export function getAdminProjectRequestActions(projectRequest) {
  const status = projectRequest?.status;
  const convertedProject = status === "converted" && projectRequest?.convertedProject?.id != null
    ? projectRequest.convertedProject
    : null;

  let decisions = null;
  if (status === "pending_review") decisions = { disabled: false, notice: "" };
  else if (status === "pending_verification") decisions = { disabled: true, notice: PENDING_VERIFICATION_NOTICE };

  return { canCreateQuote: Boolean(convertedProject), convertedProject, decisions };
}

/**
 * Refleja en la solicitud mostrada la respuesta confirmada de una decisión, sin esperar a la
 * relectura: estado, fecha y motivos vigentes. El proyecto creado al aprobar no se compone aquí:
 * la respuesta no incluye su slug público, necesario para navegar, y llega completo con la
 * relectura del detalle que sigue a la decisión (el aviso de éxito ya nombra el proyecto).
 *
 * @param {Object} projectRequest - Solicitud mostrada.
 * @param {{projectRequest?: Object}} result - Respuesta de `PATCH /admin/project-requests/:id/decision`.
 * @returns {Object} Solicitud actualizada (la misma si la respuesta no la describe).
 */
export function applyAdminDecisionResult(projectRequest, result) {
  const decided = result?.projectRequest;
  if (!decided?.status || String(decided.id) !== String(projectRequest.id)) return projectRequest;

  return {
    ...projectRequest,
    correctionReason: decided.correctionReason ?? null,
    rejectionReason: decided.rejectionReason ?? null,
    reviewedAt: decided.reviewedAt ?? projectRequest.reviewedAt ?? null,
    status: decided.status,
  };
}
