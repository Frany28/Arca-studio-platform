// Edición administrativa de solicitudes: qué estados se pueden corregir y qué respuestas cambian.

// Solo las solicitudes en evaluación (aún sin decisión). Un borrador pertenece al cliente, una
// devuelta para correcciones está en sus manos y las aprobadas, convertidas, rechazadas o
// canceladas ya tienen una decisión que la edición no debe alterar.
export const ADMIN_EDITABLE_PROJECT_REQUEST_STATUSES = Object.freeze(["pending_verification", "pending_review"]);

// Respuestas del formulario en la forma del registro (toProjectRequestRecord). Son las únicas que
// la edición puede modificar: cliente, solicitante, responsables, revisiones y estado quedan fuera.
export const PROJECT_REQUEST_ANSWER_FIELDS = Object.freeze([
  "projectName",
  "projectType",
  "location",
  "formattedAddress",
  "locationCoordinates",
  "providerPlaceId",
  "description",
  "projectSize",
  "developmentMode",
  "landStatus",
  "legalDocumentationStatus",
  "legalDocumentTypes",
  "hasMultipleOwners",
  "hasPlans",
  "standRequirements",
  "investmentRange",
  "capitalAvailability",
  "startTime",
  "decisionMaker",
  "quality",
  "experience",
  "referenceLink",
]);

// Respuestas que sustentan la revisión técnica: las que leen la compatibilidad, la viabilidad
// financiera y las observaciones de revisión (tipo, tamaño, modalidad, terreno, documentación,
// planos, stand, inversión, capital, inicio y calidad), más el alcance que el arquitecto valora
// (ubicación y descripción). Cambiar una de ellas deja desactualizadas las revisiones previas.
// No cuentan el nombre, la precisión geográfica de la misma dirección (dirección normalizada,
// coordenadas, proveedor), el enlace de referencia ni las respuestas que solo afectan a la
// completitud (quién decide y experiencia previa).
export const REVIEW_RELEVANT_ANSWER_FIELDS = Object.freeze([
  "projectType",
  "location",
  "description",
  "projectSize",
  "developmentMode",
  "landStatus",
  "legalDocumentationStatus",
  "legalDocumentTypes",
  "hasMultipleOwners",
  "hasPlans",
  "standRequirements",
  "investmentRange",
  "capitalAvailability",
  "startTime",
  "quality",
]);

/**
 * Filtra, de los campos cambiados en una edición, los que afectan a la revisión técnica.
 * La auditoría los guarda como `reviewRelevantFields`: es lo que marca como anteriores las
 * revisiones registradas antes de esa edición.
 *
 * @param {Array<string>} changedFields - Campos cambiados (listChangedProjectRequestAnswers).
 * @returns {Array<string>} Campos relevantes para la revisión, en el orden recibido.
 */
export function listReviewRelevantChanges(changedFields) {
  return (changedFields || []).filter((field) => REVIEW_RELEVANT_ANSWER_FIELDS.includes(field));
}

/**
 * Indica si el administrador puede editar los datos de una solicitud en el estado indicado.
 * La política es explícita: solo las solicitudes pendientes de evaluación o revisión, para no
 * modificar borradores del cliente, solicitudes devueltas ni decisiones ya tomadas.
 *
 * @param {string|null|undefined} status - Estado actual de la solicitud.
 * @returns {boolean} true si la edición administrativa está permitida.
 */
export function isProjectRequestEditableByAdmin(status) {
  return ADMIN_EDITABLE_PROJECT_REQUEST_STATUSES.includes(status);
}

/**
 * Lista las respuestas que difieren entre dos versiones del registro de una solicitud.
 * Compara por valor (incluidos arreglos, coordenadas y el bloque del stand) y distingue
 * `false`, `0` y `null`; la auditoría guarda solo estos nombres, nunca los valores.
 *
 * @param {object} before - Registro previo a la edición.
 * @param {object} after - Registro resultante.
 * @returns {Array<string>} Campos de PROJECT_REQUEST_ANSWER_FIELDS que cambiaron, en su orden.
 */
export function listChangedProjectRequestAnswers(before, after) {
  return PROJECT_REQUEST_ANSWER_FIELDS.filter(
    (field) => JSON.stringify(before?.[field] ?? null) !== JSON.stringify(after?.[field] ?? null),
  );
}

/**
 * Compara la versión que el administrador editó con la vigente en PostgreSQL. La versión es el
 * `updatedAt` leído al abrir el formulario (precisión de milisegundos, la del contrato JSON).
 *
 * @param {Date|string|null} currentUpdatedAt - `updated_at` vigente de la solicitud.
 * @param {string} expectedUpdatedAt - `updatedAt` con el que se abrió el formulario.
 * @returns {boolean} true si nadie modificó la solicitud desde entonces.
 */
export function isSameProjectRequestVersion(currentUpdatedAt, expectedUpdatedAt) {
  const current = new Date(currentUpdatedAt).getTime();
  const expected = new Date(expectedUpdatedAt).getTime();
  return Number.isFinite(current) && current === expected;
}
