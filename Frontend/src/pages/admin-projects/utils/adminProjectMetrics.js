import { isFinalizedProject } from "../../admin-dashboard/components/admin-active-projects/utils/adminProjectBulkActions.js";

/**
 * Cuenta la colección completa de proyectos accesibles antes de filtros y paginación.
 * Cuenta finished con la política compartida y admite temporalmente datos históricos.
 * @param {Object[]} projects Proyectos reales recogidos por cursor.
 * @returns {{total: number, inProgress: number, finished: number}} Indicadores de presentación.
 */
export function getAdminProjectMetrics(projects) {
  return {
    total: projects.length,
    inProgress: projects.filter((project) => project.status === "in_process").length,
    finished: projects.filter(isFinalizedProject).length,
  };
}
