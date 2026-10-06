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
 * @param {Object|null} params.user - Habilita la carga y participa en la derivación de permisos de edición.
 * @param {number} params.projectsRequestKey - Su cambio solicita una nueva carga completa.
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

  useEffect(() => {
    // La guarda pertenece a esta ejecución del efecto: al cambiar usuario o clave,
    // las respuestas anteriores dejan de actualizar estado. No cancela la petición HTTP.
    let isMounted = true;

    if (empty) {
      return () => {
        isMounted = false;
      };
    }

    queueMicrotask(() => {
      if (isMounted) {
        setProjectsLoading(true);
        setProjectsError("");
      }
    });

    if (!user) {
      queueMicrotask(() => {
        if (isMounted) setProjectsLoading(false);
      });
      return () => {
        isMounted = false;
      };
    }

    // Un fallo descarta la colección anterior y muestra un error genérico.
    // Sin usuario no se consulta y solo se finaliza loading; empty omite el flujo.
    api.projects
      .listAll()
      .then((data) => {
        if (isMounted) {
          setProjects(data.projects || []);
        }
      })
      .catch(() => {
        if (isMounted) {
          setProjects([]);
          setProjectsError("No se pudieron cargar los proyectos.");
        }
      })
      .finally(() => {
        if (isMounted) {
          setProjectsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [empty, projectsRequestKey, user]);

  return {
    projects,
    projectsError,
    projectsLoading,
    projectRows,
    projectGroups,
    setProjects,
  };
}
