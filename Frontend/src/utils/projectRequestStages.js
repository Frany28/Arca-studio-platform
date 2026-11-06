// Etapas del proceso en el orden del diseño. Primer contacto y Propuesta inicial ocurren
// después de la decisión y no se registran en la solicitud, por lo que nunca se marcan completas.
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
  approved: [COMPLETED(), COMPLETED(), COMPLETED("Aprobada"), UPCOMING(), UPCOMING()],
  changes_requested: [COMPLETED(), COMPLETED(), CURRENT("Correcciones solicitadas"), UPCOMING(), UPCOMING()],
  converted: [COMPLETED(), COMPLETED(), COMPLETED("Aprobada"), UPCOMING(), UPCOMING()],
  pending_review: [COMPLETED(), COMPLETED(), CURRENT(), UPCOMING(), UPCOMING()],
  pending_verification: [COMPLETED(), CURRENT(), UPCOMING(), UPCOMING(), UPCOMING()],
  rejected: [COMPLETED(), COMPLETED(), COMPLETED("Rechazada"), UPCOMING("No aplica"), UPCOMING("No aplica")],
});

/**
 * Etapas del proceso de una solicitud a partir de su estado real.
 * Un estado desconocido solo marca como completada la solicitud enviada.
 *
 * @param {string|null|undefined} status - Estado de la solicitud.
 * @returns {Array<{id: string, title: string, status: string, tone: "completed"|"current"|"upcoming"}>} Etapas.
 */
export function buildProjectRequestStages(status) {
  const states = STAGE_STATES_BY_STATUS[status] || [COMPLETED(), UPCOMING(), UPCOMING(), UPCOMING(), UPCOMING()];
  return REQUEST_STAGES.map((stage, index) => ({ ...stage, ...states[index] }));
}

