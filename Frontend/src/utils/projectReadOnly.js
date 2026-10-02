const FINALIZED_PROJECT_STATUSES = new Set(["completed", "finished"]);

/**
 * Reconoce completed y finished como estados de proyecto finalizado.
 * Compara el valor exacto sin normalizar mayúsculas ni espacios.
 *
 * @param {Object|string|null} projectOrStatus - Proyecto o código de estado.
 * @returns {boolean} Si el proyecto está finalizado.
 */
export function isProjectFinalized(projectOrStatus) {
  const status = typeof projectOrStatus === "string"
    ? projectOrStatus
    : projectOrStatus?.status;

  return FINALIZED_PROJECT_STATUSES.has(status);
}

/**
 * Marca archivados y finalizados como no modificables en la interfaz.
 * Evalúa estado operativo, sin comprobar el rol ni los permisos del usuario.
 *
 * @param {Object|string|null} projectOrStatus - Proyecto o código de estado.
 * @returns {boolean} Si debe tratarse como solo lectura.
 */
export function isProjectOperationallyReadOnly(projectOrStatus) {
  const status = typeof projectOrStatus === "string"
    ? projectOrStatus
    : projectOrStatus?.status;

  return status === "archived" || FINALIZED_PROJECT_STATUSES.has(status);
}

/**
 * Devuelve el motivo de solo lectura para finalizados o el mensaje de desarchivo.
 * El consumidor debe comprobar antes el modo de solo lectura: cualquier estado
 * no finalizado recibe el mensaje de desarchivo, aunque no sea archived.
 *
 * @param {Object|string|null} projectOrStatus - Proyecto o código de estado.
 * @returns {string} Mensaje para impedir modificaciones.
 */
export function getProjectReadOnlyMessage(projectOrStatus) {
  return isProjectFinalized(projectOrStatus)
    ? "El proyecto finalizado es de solo lectura."
    : "Desarchiva el proyecto para realizar cambios.";
}
