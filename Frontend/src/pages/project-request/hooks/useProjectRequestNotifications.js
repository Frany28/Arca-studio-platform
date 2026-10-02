import { useEffect, useMemo, useState } from "react";

import { useRecentProjects } from "../../../auth/RecentProjectsContext.jsx";
import { useImageCommentNotifications } from "../../../components/ui/Gallery/useImageComments.js";
import { useRecentProjectComments } from "../../../hooks/useProjectComments.js";
import { getProjectNamesById } from "../../../utils/commentDisplay.js";
import { getCommentNavigationParams } from "../../../utils/commentSelection.js";
import { getProjectPath } from "../../../utils/projectRoutes.js";

/**
 * Combina observaciones recientes y de im?genes de los proyectos del contexto compartido.
 * Configura refrescos de 5 s con drawer abierto y 15 s cerrado, refresca al abrir
 * y resuelve la ruta y referencia de una observaci?n seleccionada.
 *
 * @param {Object} params - Dependencias de sesi?n y navegaci?n.
 * @param {Function} params.navigate - Navegaci?n del router.
 * @param {Object|null} params.user - Usuario pasado al hook de observaciones recientes.
 * @returns {Object} Comentarios ?nicos por id, carga/error, apertura del drawer y acciones de navegaci?n/apertura.
 */
export default function useProjectRequestNotifications({
  navigate,
  user,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const { projects: recentProjects } = useRecentProjects();

  const projectIds = useMemo(
    () => recentProjects.map((project) => project.id),
    [recentProjects],
  );
  const projectNamesById = useMemo(
    () => getProjectNamesById(recentProjects),
    [recentProjects],
  );

  const imageCommentNotifications = useImageCommentNotifications({
    projectIds,
    projectNamesById,
    refreshIntervalMs: isOpen ? 5000 : 15000,
  });

  const {
    drawerComments: recentProjectComments,
    error,
    loading,
    refresh,
  } = useRecentProjectComments({
    enabled: projectIds.length > 0,
    projectIds,
    projectNamesById,
    refreshIntervalMs: isOpen ? 5000 : 15000,
    user,
  });

  const comments = useMemo(() => {
    const commentsById = new Map();

    [...recentProjectComments, ...imageCommentNotifications].forEach((comment) => {
      if (comment?.id !== undefined && comment?.id !== null) {
        commentsById.set(String(comment.id), comment);
      }
    });

    return Array.from(commentsById.values());
  }, [imageCommentNotifications, recentProjectComments]);

  useEffect(() => {
    if (isOpen) {
      refresh?.();
    }
  }, [isOpen, refresh]);

  const toggle = () => {
    setIsOpen((current) => !current);
  };

  const close = () => {
    setIsOpen(false);
  };

  const openComment = (comment) => {
    const targetProjectId = comment?.projectId;

    if (!targetProjectId) {
      return;
    }

    const params = getCommentNavigationParams(comment);
    const targetProject = recentProjects.find(
      (project) => String(project.id) === String(targetProjectId),
    );

    setIsOpen(false);
    navigate(
      targetProject
        ? getProjectPath(targetProject, params.toString())
        : `/proyectos/${targetProjectId}?${params.toString()}`,
    );
  };

  return {
    close,
    comments,
    error,
    isOpen,
    loading,
    openComment,
    setOpen: setIsOpen,
    toggle,
  };
}
