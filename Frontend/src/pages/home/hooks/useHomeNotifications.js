import { useEffect, useMemo, useState } from "react";

import { useImageCommentNotifications } from "../../../components/ui/Gallery/useImageComments.js";
import {
  useProjectComments,
  useRecentProjectComments,
} from "../../../hooks/useProjectComments.js";
import { getProjectNamesById } from "../../../utils/commentDisplay.js";
import { getCommentNavigationParams } from "../../../utils/commentSelection.js";
import { getProjectPath } from "../../../utils/projectRoutes.js";

/**
 * Combina fuentes por id, omite elementos sin id truthy y conserva la ?ltima versi?n.
 *
 * @param {Array} comments - Observaciones de las distintas fuentes.
 * @returns {Array} Observaciones ?nicas por id convertido a string.
 */
function mergeNotificationComments(comments) {
  const commentsById = new Map();

  comments.forEach((comment) => {
    if (comment?.id) {
      commentsById.set(String(comment.id), comment);
    }
  });

  return Array.from(commentsById.values());
}

/**
 * Combina observaciones recientes, enviadas y de im?genes para el drawer de Home.
 * Configura refrescos de 5 s al abrir y de 15 s para las fuentes agregadas al cerrar;
 * delega las cargas a hooks compartidos y navega hacia actividad u observaciones.
 *
 * @param {Object} params - Fuentes de observaciones y navegaci?n.
 * @param {Array} params.commentProjectRows - Proyectos usados para consultar observaciones.
 * @param {Function} params.navigate - Navegaci?n del router.
 * @param {Array} params.ownedProjectRows - Proyectos propios para resolver sus rutas.
 * @param {Object|null} params.user - Usuario pasado a los hooks de observaciones.
 * @returns {Object} Apertura del drawer, comentarios, proyecto inicial, carga/error y acciones de env?o/navegaci?n.
 */
export default function useHomeNotifications({
  commentProjectRows,
  navigate,
  ownedProjectRows,
  user,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const projectIds = useMemo(
    () => commentProjectRows.map((project) => project.id),
    [commentProjectRows],
  );
  const projectNamesById = useMemo(
    () => getProjectNamesById(commentProjectRows),
    [commentProjectRows],
  );

  const imageCommentNotifications = useImageCommentNotifications({
    projectIds,
    projectNamesById,
    refreshIntervalMs: isOpen ? 5000 : 15000,
  });

  const commentsProjectId = commentProjectRows[0]?.id ?? null;

  const {
    drawerComments: submittedDrawerComments,
    submitComment,
    refresh: refreshSubmittedComments,
    readError: submittedCommentsError,
    loading: submittedCommentsLoading,
  } = useProjectComments({
    enabled: false,
    projectId: commentsProjectId,
    refreshIntervalMs: isOpen ? 5000 : 0,
    user,
  });

  const {
    drawerComments: recentProjectComments,
    error: recentProjectCommentsError,
    loading: recentProjectCommentsLoading,
    refresh: refreshRecentComments,
  } = useRecentProjectComments({
    enabled: commentProjectRows.length > 0,
    projectIds,
    projectNamesById,
    refreshIntervalMs: isOpen ? 5000 : 15000,
    user,
  });

  const drawerComments = useMemo(() => {
    const commentsById = new Map();

    [...recentProjectComments, ...submittedDrawerComments].forEach(
      (comment) => {
        commentsById.set(String(comment.id), comment);
      },
    );

    return Array.from(commentsById.values());
  }, [recentProjectComments, submittedDrawerComments]);

  const comments = useMemo(
    () =>
      mergeNotificationComments([
        ...drawerComments,
        ...imageCommentNotifications,
      ]),
    [drawerComments, imageCommentNotifications],
  );

  const error = recentProjectCommentsError || submittedCommentsError;
  const loading = recentProjectCommentsLoading || submittedCommentsLoading;

  useEffect(() => {
    if (isOpen) {
      refreshRecentComments?.();
      refreshSubmittedComments?.();
    }
  }, [isOpen, refreshRecentComments, refreshSubmittedComments]);

  const close = () => {
    setIsOpen(false);
  };

  const toggle = () => {
    setIsOpen((current) => !current);
  };

  const openActivity = (activity) => {
    if (!activity?.to) {
      return;
    }

    setIsOpen(false);
    navigate(activity.to);
  };

  /**
   * Cierra el drawer y navega al proyecto con los par?metros de referencia de la observaci?n.
   * Si falta projectId usa el primer proyecto de observaciones; sin destino no navega.
   *
   * @param {Object} comment - Observaci?n seleccionada y referencia asociada.
   * @returns {void} Actualiza el drawer y solicita navegaci?n cuando hay destino.
   */
  const openComment = (comment) => {
    const params = getCommentNavigationParams(comment);

    setIsOpen(false);
    const targetProjectId = comment?.projectId || commentsProjectId;

    if (!targetProjectId) {
      return;
    }

    const targetProject = ownedProjectRows.find(
      (project) => project.id === Number(targetProjectId),
    );

    navigate(
      targetProject
        ? getProjectPath(targetProject, params.toString())
        : `/proyectos/${targetProjectId}?${params.toString()}`,
    );
  };

  return {
    close,
    comments,
    commentsProjectId,
    error,
    isOpen,
    loading,
    openActivity,
    openComment,
    submitComment,
    toggle,
  };
}
