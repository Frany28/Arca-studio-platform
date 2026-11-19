import { nonDraftProjectCondition } from "./projectDraftVisibility.js";

/**
 * Condición SQL de acceso a los comentarios de un proyecto: administrador siempre; arquitecto
 * asignado o responsable y cliente propietario, fuera de draft. Es la regla de proyecto sobre la
 * que se aplica, con la revisión activada, la audiencia de cada versión (projectCommentAudienceSql).
 *
 * @param {{ id: number, clientId?: number|null, role?: { code?: string } }} user - Usuario autenticado.
 * @param {string} [projectAlias] - Alias de public.projects.
 * @returns {{ params: unknown[], sql: string }} Condición con parámetros desde $1.
 */
export function getProjectAccessCondition(user, projectAlias = "p") {
  const roleCode = user?.role?.code;

  if (roleCode === "admin") {
    return {
      params: [],
      sql: "true",
    };
  }

  if (roleCode === "architect") {
    return {
      params: [user.id],
      sql: `((${projectAlias}.assigned_architect_id = $1 or exists (
        select 1 from public.project_assignees assignment
        where assignment.project_id = ${projectAlias}.id
          and assignment.user_id = $1
      )) and ${nonDraftProjectCondition(projectAlias)})`,
    };
  }

  if (roleCode === "client" && user.clientId) {
    return {
      params: [user.clientId],
      sql: `(${projectAlias}.client_id = $1 and ${nonDraftProjectCondition(projectAlias)})`,
    };
  }

  return {
    params: [],
    sql: "false",
  };
}
