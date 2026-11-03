export const PROJECT_STATUS = Object.freeze({
  DRAFT: "draft",
  PENDING: "pending",
  IN_PROCESS: "in_process",
  FINISHED: "finished",
  CANCELLED: "cancelled",
  ARCHIVED: "archived",
});

// Motivo común del 409 PROJECT_DRAFT: un draft no admite archivos, comentarios ni responsables.
export const PROJECT_DRAFT_READ_ONLY_MESSAGE =
  "El proyecto es un borrador (Draft): completa sus datos y actívalo antes de realizar cambios.";

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
 * Reconoce un proyecto preliminar (draft), también cuando está archivado desde draft: al
 * desarchivarlo vuelve a draft. Un draft solo es visible para administración y no admite
 * operaciones de archivos, comentarios ni responsables.
 *
 * @param {string|null|undefined} status - Código de estado del proyecto.
 * @param {string|null|undefined} [archivedFromStatus] - Estado previo de un proyecto archivado.
 * @returns {boolean} Si el proyecto es un draft.
 */
export function isProjectDraft(status, archivedFromStatus = null) {
  return status === PROJECT_STATUS.DRAFT
    || (status === PROJECT_STATUS.ARCHIVED && archivedFromStatus === PROJECT_STATUS.DRAFT);
}

/**
 * Identifica estados que impiden cambios operativos de archivos, comentarios y responsables.
 * Conserva la publicación de finalizados y el desarchivo como operaciones independientes.
 *
 * @param {string|null|undefined} status - Código de estado del proyecto.
 * @returns {boolean} Si las operaciones ordinarias deben rechazarse.
 */
export function isProjectOperationallyReadOnly(status) {
  return status === PROJECT_STATUS.ARCHIVED || status === PROJECT_STATUS.DRAFT || isProjectFinalized(status);
}
