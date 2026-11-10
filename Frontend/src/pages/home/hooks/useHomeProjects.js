import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../../api/http.js";
import { getSessionDataScopeKey } from "../../../auth/sessionDataScope.js";
import { useRetryAfterSessionConfirmation } from "../../../hooks/useRetryAfterSessionConfirmation.js";
import { getProjectAssigneeAvatar } from "../../../utils/projectAssigneeDisplay.js";
import { getProjectImageSource } from "../../../utils/projectImage.js";
import { isProjectOperationallyReadOnly } from "../../../utils/projectReadOnly.js";
import { groupProjectsByStatus } from "../../../utils/projectStatusGroups.js";

function getProjectAssigneeAvatars(project) {
  const assigneeAvatar = getProjectAssigneeAvatar(project);
  return assigneeAvatar ? [assigneeAvatar] : [];
}

/**
 * Adapta el proyecto a una fila conservando sus campos originales.
 * Obtiene avatar e imagen con los helpers compartidos de presentaci?n.
 *
 * @param {Object} project - Proyecto recibido de la API.
 * @returns {Object} Proyecto con assigneeAvatars, image y title.
 */
function toProjectRow(project) {
  return {
    ...project,
    assigneeAvatars: getProjectAssigneeAvatars(project),
    image: getProjectImageSource(project),
    title: project.name,
  };
}

/**
 * Carga los proyectos mediante la API y deriva filas propias, públicas y grupos por estado.
 * Excluye proyectos de solo lectura del conjunto usado para observaciones. La lectura depende
 * del ámbito de la sesión (cuenta, rol y cliente; ver getSessionDataScopeKey), no de la
 * referencia de `user`: confirmar la misma sesión no la repite. Cambiar de ámbito, recargar o
 * desmontar cancela la lectura en curso, cuya respuesta ya no actualiza el estado.
 *
 * @param {Object} params - Contexto de la carga.
 * @param {Object|null} params.user - Usuario; clientId identifica los proyectos propios.
 * @returns {Object} Filas derivadas, grupos, carga, error como texto y acción loadProjects.
 */
export default function useHomeProjects({ user }) {
  const [projects, setProjects] = useState([]);
  const [projectsError, setProjectsError] = useState("");
  const [projectsLoading, setProjectsLoading] = useState(true);
  // Lectura vigente: una nueva la sustituye y la anterior se aborta (todas sus páginas).
  const projectsRequestRef = useRef(null);
  const sessionScopeKey = getSessionDataScopeKey(user);
  const { clear: clearProjectsRetry, scheduleIfUnauthenticated: scheduleProjectsRetry } =
    useRetryAfterSessionConfirmation(user);

  const projectRows = useMemo(
    () => projects.map((project) => toProjectRow(project)),
    [projects],
  );

  const ownedProjectRows = useMemo(
    () =>
      projectRows.filter((project) => project.client?.id === user?.clientId),
    [projectRows, user?.clientId],
  );

  const commentProjectRows = useMemo(
    () =>
      ownedProjectRows.filter(
        (project) => !isProjectOperationallyReadOnly(project),
      ),
    [ownedProjectRows],
  );

  const publicProjectRows = useMemo(
    () =>
      projectRows.filter(
        (project) => project.isPublic && project.client?.id !== user?.clientId,
      ),
    [projectRows, user?.clientId],
  );

  const projectGroups = useMemo(
    () => groupProjectsByStatus(ownedProjectRows),
    [ownedProjectRows],
  );

  /**
   * Recarga proyectos (acción «Actualizar») y aplica únicamente la respuesta de la lectura más
   * reciente: iniciar otra aborta la anterior. Conserva los datos durante la espera; si la carga
   * vigente falla, los vacía. Una lectura abortada no modifica el estado.
   * Si el primer intento recibe 401 UNAUTHENTICATED y AuthContext confirma la misma sesión, se
   * repite una sola vez (useRetryAfterSessionConfirmation); un segundo fallo deja el error.
   *
   * @returns {Promise<void>} Actualiza datos, carga y error; no devuelve los proyectos.
   */
  const loadProjects = useCallback(() => {
    clearProjectsRetry();

    const readProjects = async (isRetry) => {
      projectsRequestRef.current?.abort();
      const controller = new AbortController();
      projectsRequestRef.current = controller;
      const { signal } = controller;
      setProjectsLoading(true);
      setProjectsError("");

      if (!sessionScopeKey) {
        setProjects([]);
        setProjectsLoading(false);
        return;
      }

      try {
        const data = await api.projects.listAll({ signal });
        if (!signal.aborted) {
          setProjects(data.projects || []);
        }
      } catch (error) {
        if (!signal.aborted) {
          setProjects([]);
          setProjectsError("No se pudieron cargar los proyectos.");
          if (!isRetry) scheduleProjectsRetry(error, signal, () => readProjects(true));
        }
      } finally {
        if (!signal.aborted) {
          setProjectsLoading(false);
        }
      }
    };

    return readProjects(false);
  }, [clearProjectsRetry, scheduleProjectsRetry, sessionScopeKey]);

  // Lee al montar y al cambiar el ámbito de la sesión. La limpieza aborta la lectura vigente:
  // el montaje doble del StrictMode de desarrollo no completa una lectura duplicada.
  useEffect(() => {
    loadProjects();

    return () => projectsRequestRef.current?.abort();
  }, [loadProjects]);

  return {
    commentProjectRows,
    loadProjects,
    ownedProjectRows,
    projectGroups,
    projectsError,
    projectsLoading,
    publicProjectRows,
  };
}
