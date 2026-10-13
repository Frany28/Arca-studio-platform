import { isFinalizedProject } from "../../admin-dashboard/components/admin-active-projects/utils/adminProjectBulkActions.js";

/**
 * Cuenta la colección completa de proyectos accesibles antes de filtros y paginación.
 * Reutiliza los aliases existentes de finalización y no infiere totales desde una página.
 * @param {Object[]} projects Proyectos reales recogidos por cursor.
 * @returns {{total: number, inProgress: number, completed: number}} Indicadores de presentación.
 */
export function getAdminProjectMetrics(projects) {
  return {
    total: projects.length,
    inProgress: projects.filter((project) => project.status === "in_process").length,
    completed: projects.filter(isFinalizedProject).length,
  };
}
