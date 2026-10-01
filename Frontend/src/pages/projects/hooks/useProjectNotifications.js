import { upsertCommentById, mergeCommentsById } from "../../../utils/commentCollection.js";
import { toDrawerComment } from "../utils/projectCommentPresentation.js";
import { mergeNotificationComments } from "../../../utils/mergeNotificationComments.js";
import { useEffect, useState } from "react";
import { api } from "../../../api/http.js";
import { useImageCommentNotifications } from "../../../components/ui/Gallery/useImageComments.js";
import { getProjectReadOnlyMessage, isProjectOperationallyReadOnly } from "../../../utils/projectReadOnly.js";

export function useProjectNotifications({
  user,
  isNotificationsDrawerOpen,
  project,
  resolvedProjectId,
}) {
  const [projectComments, setProjectComments] = useState([]);

  const [projectCommentsError, setProjectCommentsError] = useState("");

  const [projectCommentsLoading, setProjectCommentsLoading] = useState(false);

  const imageCommentNotifications = useImageCommentNotifications({
    projectIds: resolvedProjectId ? [resolvedProjectId] : [],
    refreshIntervalMs: isNotificationsDrawerOpen ? 5000 : 15000,
  });

  const notificationComments = mergeNotificationComments([
    ...projectComments.map((comment) => toDrawerComment(comment, user, project?.files)),
    ...imageCommentNotifications,
  ]);

  useEffect(() => {
    if (!resolvedProjectId) {
      setProjectComments([]);
      return undefined;
    }

    let isMounted = true;

    function loadProjectComments({ showLoading = false } = {}) {
      if (showLoading) {
        setProjectCommentsLoading(true);
      }

      setProjectCommentsError("");

      api.projects
        .listAllComments({ projectId: resolvedProjectId })
        .then((data) => {
          if (isMounted) {
            setProjectComments(
              (current) =>
                mergeCommentsById(
                  current,
                  Array.isArray(data.comments) ? data.comments : [],
                ),
            );
          }
        })
        .catch((error) => {
          if (isMounted) {
            setProjectCommentsError(
              error.message || "No se pudieron cargar las observaciones.",
            );
          }
        })
        .finally(() => {
          if (isMounted && showLoading) {
            setProjectCommentsLoading(false);
          }
        });
    }

    loadProjectComments({ showLoading: true });

    const unsubscribe = api.projects.subscribeToEvents({
      projectId: resolvedProjectId,
      onCommentCreated: (comment) => {
        if (isMounted) {
          setProjectComments((current) => upsertCommentById(current, comment));
        }
      },
    });
    const refreshIntervalId = window.setInterval(
      () => loadProjectComments(),
      isNotificationsDrawerOpen ? 5000 : 15000,
    );

    return () => {
      isMounted = false;
      window.clearInterval(refreshIntervalId);
      unsubscribe();
    };
  }, [isNotificationsDrawerOpen, resolvedProjectId]);

  const handleSubmitComment = async ({ message, parentCommentId = null }) => {
    if (isProjectOperationallyReadOnly(project)) {
      setProjectCommentsError(getProjectReadOnlyMessage(project));
      return;
    }

    if (!resolvedProjectId) {
      setProjectCommentsError("No se encontro el proyecto para comentar.");
      return;
    }

    setProjectCommentsLoading(true);
    setProjectCommentsError("");

    try {
      const data = await api.projects.createComment({
        content: message,
        parentCommentId,
        projectId: resolvedProjectId,
      });

      if (data.comment) {
        setProjectComments((current) => upsertCommentById(current, data.comment));
      }
    } catch (error) {
      setProjectCommentsError(
        error.message || "No se pudo guardar la observación.",
      );
    } finally {
      setProjectCommentsLoading(false);
    }
  };

  return {
    projectCommentsError,
    projectCommentsLoading,
    notificationComments,
    handleSubmitComment,
  };
}
