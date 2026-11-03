import { DRAFT_PROJECT_STATUS, FINISHED_PROJECT_STATUS, normalizeProjectStatus } from "./projectStatus.js";

/**
 * Reconoce finished como estado canónico de proyecto finalizado.
 * Admite temporalmente el alias histórico sin normalizar mayúsculas ni espacios.
 *
 * @param {Object|string|null} projectOrStatus - Proyecto o código de estado.
 * @returns {boolean} Si el proyecto está finalizado.
 */
export function isProjectFinalized(projectOrStatus) {
  const status = typeof projectOrStatus === "string"
    ? projectOrStatus
    : projectOrStatus?.status;

  return normalizeProjectStatus(status) === FINISHED_PROJECT_STATUS;
}

/**
 * Marca drafts, archivados y finalizados como no modificables en la interfaz (archivos, comentarios
 * y responsables). Evalúa estado operativo, sin comprobar el rol ni los permisos del usuario.
 *
 * @param {Object|string|null} projectOrStatus - Proyecto o código de estado.
 * @returns {boolean} Si debe tratarse como solo lectura.
 */
export function isProjectOperationallyReadOnly(projectOrStatus) {
  const status = typeof projectOrStatus === "string"
    ? projectOrStatus
    : projectOrStatus?.status;

  return status === "archived" || status === DRAFT_PROJECT_STATUS || isProjectFinalized(status);
}

/**
 * Devuelve el motivo de solo lectura de un draft o un finalizado, o el mensaje de desarchivo.
 * El consumidor debe comprobar antes el modo de solo lectura: cualquier otro estado
 * recibe el mensaje de desarchivo, aunque no sea archived.
 *
 * @param {Object|string|null} projectOrStatus - Proyecto o código de estado.
 * @returns {string} Mensaje para impedir modificaciones.
 */
export function getProjectReadOnlyMessage(projectOrStatus) {
  const status = typeof projectOrStatus === "string" ? projectOrStatus : projectOrStatus?.status;
  if (status === DRAFT_PROJECT_STATUS) return "El proyecto es un borrador (Draft): completa sus datos y actívalo antes de realizar cambios.";
  return isProjectFinalized(projectOrStatus)
    ? "El proyecto finalizado es de solo lectura."
    : "Desarchiva el proyecto para realizar cambios.";
}
