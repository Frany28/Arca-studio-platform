import { api } from "../../../api/http.js";

/**
 * Concentra las mutaciones administrativas de proyectos compartidas por Dashboard y Gestión.
 * Solo reconcilia la colección local después de que la API confirme cada operación y
 * notifica al consumidor para refrescar lecturas derivadas (métricas, overview).
 *
 * @param {Object} params - Sincronización con la colección del consumidor.
 * @param {Function} params.setProjects - Setter de `useDashboardProjects`.
 * @param {() => void} [params.onProjectsChanged] - Se invoca tras una acción de proyecto confirmada.
 * @returns {{
 *   updateProjectAssignees: (project: Object, assignees: Object[]) => Promise<void>,
 *   runProjectAction: (params: {action: string, projects: Object[], isPublic?: boolean}) => Promise<Object>,
 *   applyProjectBulkAction: (params: {action: string, projects: Object[]}) => Promise<Object>,
 * }} Operaciones de dominio; todas propagan los errores de la API.
 */
export function useAdminProjectMutations({ setProjects, onProjectsChanged }) {
  /**
   * Guarda responsables del proyecto y reconcilia todos los campos de asignación.
   * Los errores se propagan a los controles existentes para publicar su feedback.
   * @param {Object} project - Proyecto que se actualiza.
   * @param {Array} assignees - Responsables seleccionados.
   * @returns {Promise<void>} Completa el guardado y su actualización local.
   * @throws {Error} Propaga fallos de la API administrativa.
   */
  const updateProjectAssignees = async (project, assignees) => {
    const data = await api.admin.updateProjectAssignees({
      assigneeIds: assignees.map((assignee) => Number(assignee.id)),
      projectId: project.id,
    });

    setProjects((currentProjects) =>
      currentProjects.map((currentProject) =>
        currentProject.id === project.id
          ? {
              ...currentProject,
              assignees: data.assignees || [],
              assignedArchitect: data.assignees?.[0] || null,
              assignedArchitects: data.assignees || [],
            }
          : currentProject,
      ),
    );
  };

  /**
   * Ejecuta archive, unarchive o change_visibility con el contrato bulk-action existente.
   * Fusiona en la colección únicamente los proyectos devueltos por el servidor.
   * @param {Object} params - Acción del contrato, proyectos afectados e isPublic explícito.
   * @param {"archive"|"change_visibility"|"unarchive"} params.action - Acción administrativa.
   * @param {Object[]} params.projects - Proyectos cuyo ID se envía.
   * @param {boolean} [params.isPublic] - Visibilidad requerida por change_visibility.
   * @returns {Promise<Object>} Respuesta de la API administrativa.
   * @throws {Error} Propaga fallos de validación, reglas de negocio o red.
   */
  const runProjectAction = async ({ action, projects, isPublic }) => {
    const data = await api.admin.updateProjects({
      action,
      isPublic: action === "change_visibility" ? isPublic : undefined,
      projectIds: projects.map((project) => Number(project.id)),
    });
    const updatedProjects = new Map(
      (data.projects || []).map((project) => [Number(project.id), project]),
    );

    setProjects((currentProjects) =>
      currentProjects.map((project) => {
        const updatedProject = updatedProjects.get(Number(project.id));
        return updatedProject ? { ...project, ...updatedProject } : project;
      }),
    );
    onProjectsChanged?.();

    return data;
  };

  /**
   * Conserva la semántica masiva del dashboard: change_visibility alterna la visibilidad
   * común de la selección (la tabla solo lo habilita cuando todos la comparten).
   * @param {Object} params - Acción y proyectos originales seleccionados por la tabla.
   * @returns {Promise<Object>} Resultado devuelto por la API administrativa.
   * @throws {Error} Propaga fallos al feedback de la tabla.
   */
  const applyProjectBulkAction = ({ action, projects }) => runProjectAction({
    action,
    projects,
    isPublic: action === "change_visibility"
      ? !projects.every((project) => project.isPublic)
      : undefined,
  });

  return { updateProjectAssignees, runProjectAction, applyProjectBulkAction };
}
