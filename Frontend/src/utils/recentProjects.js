export const RECENT_PROJECTS_LIMIT = 3;
export const RECENT_PROJECTS_FETCH_LIMIT = 25;

/**
 * Selecciona el ámbito de lectura de proyectos recientes según rol.
 * Clientes usan owned; cualquier otro código usa accessible.
 *
 * @param {string|null} roleCode - Código de rol sin normalización.
 * @returns {string} Ámbito para la consulta.
 */
export function getRecentProjectsScope(roleCode) {
  return roleCode === "client" ? "owned" : "accessible";
}

function getProjectTimestamp(project) {
  const timestamp = new Date(
    project?.updatedAt || project?.createdAt || 0,
  ).getTime();

  return Number.isNaN(timestamp) ? 0 : timestamp;
}

/**
 * Selecciona hasta tres proyectos recientes excluyendo archived o isArchived.
 * Deduplica IDs como texto, conservando la última aparición; ordena por updatedAt
 * o createdAt descendente, con fecha inválida cero y desempate por ID descendente.
 *
 * @param {Array} [projects=[]] - Proyectos candidatos; entradas no array producen [].
 * @returns {Array} Proyectos recientes seleccionados.
 */
export function selectRecentProjects(projects = []) {
  const projectsById = new Map();

  (Array.isArray(projects) ? projects : [])
    .filter((project) => project?.status !== "archived" && !project?.isArchived)
    .forEach((project) => {
    if (project?.id !== undefined && project?.id !== null) {
      projectsById.set(String(project.id), project);
    }
  });

  return Array.from(projectsById.values())
    .sort((left, right) => {
      const timestampDifference =
        getProjectTimestamp(right) - getProjectTimestamp(left);

      if (timestampDifference !== 0) {
        return timestampDifference;
      }

      return Number(right.id || 0) - Number(left.id || 0);
    })
    .slice(0, RECENT_PROJECTS_LIMIT);
}

/**
 * Reduce los proyectos recientes a datos de navegación aptos para caché.
 * Aplica selección previa y normaliza nombre y referencias opcionales, sin incluir
 * archivos, comentarios ni otros detalles completos del proyecto.
 *
 * @param {Array} [projects=[]] - Proyectos candidatos.
 * @returns {Array} Entradas con ID, publicación, nombre, slug, estado y updatedAt.
 */
export function toRecentProjectCacheEntries(projects = []) {
  return selectRecentProjects(projects).map((project) => ({
    id: project.id,
    isPublic: Boolean(project.isPublic),
    name: String(project.name || project.title || "Proyecto"),
    publicSlug: project.publicSlug ? String(project.publicSlug) : null,
    status: project.status ? String(project.status) : null,
    updatedAt: project.updatedAt ? String(project.updatedAt) : null,
  }));
}
