// Etapas del proceso en el orden del diseño. Primer contacto y Propuesta inicial ocurren después
// de la aprobación: el primer contacto solo se completa con su registro real (`firstContactAt`) y la
// propuesta inicial no tiene registro en la solicitud, por lo que nunca se marca completa.
const REQUEST_STAGES = Object.freeze([
  { id: "submitted", title: "Solicitud enviada" },
  { id: "preliminary", title: "Evaluación preliminar" },
  { id: "review", title: "Revisión" },
  { id: "first-contact", title: "Primer contacto" },
  { id: "initial-proposal", title: "Propuesta inicial" },
]);

const COMPLETED = (status = "Completado") => ({ status, tone: "completed" });
const CURRENT = (status = "Pendiente") => ({ status, tone: "current" });
const UPCOMING = (status = "Pendiente") => ({ status, tone: "upcoming" });

// Estado de cada etapa por estado de la solicitud (pending_verification: verificación y
// asignación; pending_review: revisión técnica; el resto, decisiones administrativas).
const STAGE_STATES_BY_STATUS = Object.freeze({
  // Aprobada: el primer contacto con ARCA es la etapa en curso hasta que se registre.
  approved: [COMPLETED(), COMPLETED(), COMPLETED("Aprobada"), CURRENT(), UPCOMING()],
  changes_requested: [COMPLETED(), COMPLETED(), CURRENT("Correcciones solicitadas"), UPCOMING(), UPCOMING()],
  converted: [COMPLETED(), COMPLETED(), COMPLETED("Aprobada"), CURRENT(), UPCOMING()],
  pending_review: [COMPLETED(), COMPLETED(), CURRENT(), UPCOMING(), UPCOMING()],
  pending_verification: [COMPLETED(), CURRENT(), UPCOMING(), UPCOMING(), UPCOMING()],
  rejected: [COMPLETED(), COMPLETED(), COMPLETED("Rechazada"), UPCOMING("No aplica"), UPCOMING("No aplica")],
});

// Estados aprobados en los que el registro del primer contacto hace avanzar el seguimiento.
const APPROVED_STATUSES = new Set(["approved", "converted"]);

/**
 * Etapas del proceso de una solicitud a partir de su estado real y de los eventos registrados.
 * Un estado desconocido solo marca como completada la solicitud enviada. En una solicitud
 * aprobada, el primer contacto se completa únicamente con `firstContactAt` (registro real del
 * administrador) y la propuesta inicial pasa entonces a ser la etapa en curso, sin completarse.
 *
 * @param {string|null|undefined} status - Estado de la solicitud.
 * @param {{firstContactAt?: string|null}} [events] - Eventos registrados de la solicitud.
 * @returns {Array<{id: string, title: string, status: string, tone: "completed"|"current"|"upcoming"}>} Etapas.
 */
export function buildProjectRequestStages(status, { firstContactAt = null } = {}) {
  let states = STAGE_STATES_BY_STATUS[status] || [COMPLETED(), UPCOMING(), UPCOMING(), UPCOMING(), UPCOMING()];
  if (APPROVED_STATUSES.has(status) && firstContactAt) {
    states = [...states.slice(0, 3), COMPLETED(), CURRENT()];
  }
  return REQUEST_STAGES.map((stage, index) => ({ ...stage, ...states[index] }));
}

