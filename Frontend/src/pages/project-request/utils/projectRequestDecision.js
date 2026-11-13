import { getProjectRequestClientReason } from "../../../utils/projectRequestStatus.js";

// Texto de la columna derecha cuando la solicitud fue aprobada. Figma (3727:543790) afirma que
// se envió un correo; la solicitud no registra esa comunicación, así que el texto describe el
// siguiente paso sin dar por hecho un envío, una reunión ni una fecha.
export const APPROVED_NEXT_STEP_MESSAGE =
  "Su solicitud fue aprobada por nuestro equipo. El siguiente paso es coordinar una reunión inicial: nos comunicaremos con usted a través de los datos de contacto registrados para acordarla.";
export const MISSING_REJECTION_REASON_MESSAGE = "El motivo del rechazo no está disponible en este momento.";
export const MISSING_CORRECTION_REASON_MESSAGE = "La información solicitada no está disponible en este momento.";

// Acción principal del pie según el estado. `kind` lo resuelve la página en navegación.
export const DECISION_PRIMARY_ACTIONS = Object.freeze({
  correct: { kind: "correct", label: "Corregir solicitud" },
  createNew: { kind: "createNew", label: "Crear nueva solicitud" },
  viewProject: { kind: "viewProject", label: "Ver proyecto" },
});

/**
 * Contenido de «Estado de la solicitud» (Figma 3727:543790) para una solicitud con decisión
 * administrativa. Conserva la sección de dos columnas y adapta su título y texto al estado real:
 * aprobada → «Primer contacto» y el siguiente paso; rechazada → «Motivo del rechazo» con
 * `rejectionReason`; correcciones → «Información solicitada» con `correctionReason`. El motivo se
 * elige por estado (`getProjectRequestClientReason`) y, si falta, se usa un texto neutral en lugar
 * de inventar una razón (`isReasonMissing` permite distinguirlo).
 *
 * @param {Object|null} projectRequest - Solicitud del cliente leída de la API.
 * @returns {{sectionTitle: string, message: string, isReasonMissing: boolean, primaryAction: Object|null}|null}
 *   Presentación de la decisión, o null si el estado no corresponde a esta pantalla.
 */
export function getProjectRequestDecisionPresentation(projectRequest) {
  const status = projectRequest?.status;
  if (status === "converted" || status === "approved") {
    return {
      isReasonMissing: false,
      message: APPROVED_NEXT_STEP_MESSAGE,
      // Solo se ofrece el proyecto cuando es accesible para el cliente: el borrador (draft) que
      // crea la aprobación es interno hasta «Finalizar configuración»; uno eliminado no tiene destino.
      primaryAction: projectRequest.convertedProjectId && projectRequest.convertedProjectAvailable
        ? DECISION_PRIMARY_ACTIONS.viewProject
        : null,
      sectionTitle: "Primer contacto",
    };
  }
  if (status === "rejected" || status === "changes_requested") {
    const reason = getProjectRequestClientReason(projectRequest);
    const isRejected = status === "rejected";
    return {
      isReasonMissing: !reason,
      message: reason || (isRejected ? MISSING_REJECTION_REASON_MESSAGE : MISSING_CORRECTION_REASON_MESSAGE),
      primaryAction: isRejected ? DECISION_PRIMARY_ACTIONS.createNew : DECISION_PRIMARY_ACTIONS.correct,
      sectionTitle: isRejected ? "Motivo del rechazo" : "Información solicitada",
    };
  }
  return null;
}
