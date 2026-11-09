import { useEffect, useMemo, useState } from "react";

import { api } from "../api/http.js";
import { getProjectImageSource } from "../utils/projectImage.js";
import { getProjectAssigneeAvatar } from "../utils/projectAssigneeDisplay.js";
import { groupProjectsByStatus } from "../utils/projectStatusGroups.js";
import { isProjectOperationallyReadOnly } from "../utils/projectReadOnly.js";

/**
 * Adapta un proyecto a las filas del dashboard conservando sus campos originales.
 * Añade portada, título y avatar del responsable mediante helpers compartidos;
 * editable exige disponibilidad operativa y rol admin o asignación al usuario actual.
 *
 * @param {Object} project - Proyecto recibido de la API o actualizado localmente.
 * @param {Object|null} user - Usuario usado para resolver la posibilidad de edición.
 * @returns {Object} Proyecto con image, title, assigneeAvatars y editable para presentación.
 */
function toProjectRow(project, user) {
  const assigneeAvatar = getProjectAssigneeAvatar(project);
  const isAssignedEmployee = (project.assignees || project.assignedArchitects || []).some(
    (assignee) => Number(assignee.id) === Number(user?.id),
  );

  return {
    ...project,
    assigneeAvatars: assigneeAvatar ? [assigneeAvatar] : [],
    editable:
      !isProjectOperationallyReadOnly(project) && (
        user?.role === "admin" ||
        project.assignedArchitect?.id === user?.id ||
        isAssignedEmployee
      ),
    image: getProjectImageSource(project),
    title: project.name,
  };
}

/**
 * Carga los proyectos accesibles y deriva filas y grupos por estado para el dashboard.
 * Delega a listAll la recolección de páginas por cursor, sin exponer paginación,
 * filtros ni selección propios; setProjects permite sincronizar mutaciones de la página.
 *
 * @param {Object} params - Contexto de lectura y refresco externo.
 * @param {boolean} params.empty - Omite la lectura en el escenario vacío.
 * @param {Object|null} params.user - Habilita la carga y participa en la derivación de permisos de edición;
 *   la lectura solo se repite si cambia su sesión (id y rol), no la referencia del objeto.
 * @param {number} params.projectsRequestKey - Su cambio solicita una nueva carga completa; cancela la anterior.
 * @returns {Object} projects, projectsLoading, projectsError, projectRows, projectGroups y setProjects.
 * Los grupos omiten estados vacíos y reúnen estados no reconocidos en Otros, según el helper compartido.
 */
export function useDashboardProjects({ empty, user, projectsRequestKey }) {
  const [projects, setProjects] = useState([]);
  const [projectsError, setProjectsError] = useState("");
  const [projectsLoading, setProjectsLoading] = useState(!empty);

  const projectRows = useMemo(
    () => projects.map((project) => toProjectRow(project, user)),
    [projects, user],
  );
  const projectGroups = useMemo(
    () => groupProjectsByStatus(projectRows),
    [projectRows],
  );

  // La colección depende de la sesión (cuenta y rol), no de la identidad del objeto `user`:
  // AuthContext publica un objeto nuevo al confirmar la misma sesión, y eso no debe repetir la
  // lectura completa. Cambiar de cuenta o de rol sí la repite.
  const sessionKey = user ? `${user.id ?? user.email}:${user.role}` : null;

  useEffect(() => {
    // Cambiar de sesión o de clave, o desmontar, cancela la lectura en curso (todas sus
    // páginas); una respuesta abortada nunca actualiza el estado.
    const controller = new AbortController();
    const { signal } = controller;

    if (empty) {
      return () => controller.abort();
    }

    queueMicrotask(() => {
      if (!signal.aborted) {
        setProjectsLoading(true);
        setProjectsError("");
      }
    });

    if (!sessionKey) {
      queueMicrotask(() => {
        if (!signal.aborted) setProjectsLoading(false);
      });
      return () => controller.abort();
    }

    // Un fallo descarta la colección anterior y muestra un error genérico.
    // Sin usuario no se consulta y solo se finaliza loading; empty omite el flujo.
    api.projects
      .listAll({ signal })
      .then((data) => {
        if (!signal.aborted) {
          setProjects(data.projects || []);
        }
      })
      .catch(() => {
        if (!signal.aborted) {
          setProjects([]);
          setProjectsError("No se pudieron cargar los proyectos.");
        }
      })
      .finally(() => {
        if (!signal.aborted) {
          setProjectsLoading(false);
        }
      });

    return () => controller.abort();
  }, [empty, projectsRequestKey, sessionKey]);

  return {
    projects,
    projectsError,
    projectsLoading,
    projectRows,
    projectGroups,
    setProjects,
  };
}
