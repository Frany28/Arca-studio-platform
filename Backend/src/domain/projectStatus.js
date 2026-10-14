export const PROJECT_STATUS = Object.freeze({
  PENDING: "pending",
  IN_PROCESS: "in_process",
  FINISHED: "finished",
  CANCELLED: "cancelled",
  ARCHIVED: "archived",
});

/**
 * Convierte el código heredado de finalización al único estado canónico del proyecto.
 * La compatibilidad temporal se limita a lecturas antiguas; no altera otros dominios.
 *
 * @param {string|null|undefined} status - Código de estado recibido de datos históricos.
 * @returns {string|null|undefined} Estado canónico o valor original si no es un alias.
 */
export function normalizeProjectStatus(status) {
  return status === "completed" ? PROJECT_STATUS.FINISHED : status;
}

/**
 * Reconoce proyectos finalizados según el contrato canónico y su alias histórico.
 * Centraliza el cierre operativo y la elegibilidad para visibilidad sin comprobar permisos.
 *
 * @param {string|null|undefined} status - Código de estado del proyecto.
 * @returns {boolean} Si el estado representa un proyecto finalizado.
 */
export function isProjectFinalized(status) {
  return normalizeProjectStatus(status) === PROJECT_STATUS.FINISHED;
}

/**
 * Identifica estados que impiden cambios operativos de archivos, comentarios y responsables.
 * Conserva la publicación de finalizados y el desarchivo como operaciones independientes.
 *
 * @param {string|null|undefined} status - Código de estado del proyecto.
 * @returns {boolean} Si las operaciones ordinarias deben rechazarse.
 */
export function isProjectOperationallyReadOnly(status) {
  return status === PROJECT_STATUS.ARCHIVED || isProjectFinalized(status);
}
