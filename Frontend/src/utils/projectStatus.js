export const FINISHED_PROJECT_STATUS = "finished";

/**
 * Normaliza únicamente el alias histórico de finalización de proyectos.
 * Compatibilidad temporal para respuestas y snapshots antiguos; filtros y grupos emiten finished.
 * @param {string|null|undefined} status Código original, sin recortar ni cambiar mayúsculas.
 * @returns {string|null|undefined} Código canónico o estado original desconocido.
 */
export function normalizeProjectStatus(status) {
  return status === "completed" ? FINISHED_PROJECT_STATUS : status;
}
