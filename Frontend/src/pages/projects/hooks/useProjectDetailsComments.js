import { useEffect, useState } from "react";

import { api } from "../../../api/http.js";
import {
  getProjectReadOnlyMessage,
  isProjectOperationallyReadOnly,
} from "../../../utils/projectReadOnly.js";
import {
  mergeCommentsById,
  upsertCommentById,
} from "../utils/projectDetailsPresentation.js";

export default function useProjectDetailsComments({
  isNotificationsDrawerOpen,
  project,
  resolvedProjectId,
}) {
  const [comments, setComments] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!resolvedProjectId) {
      setComments([]);
      return undefined;
    }

    let isMounted = true;

    function loadProjectComments({ showLoading = false } = {}) {
      if (showLoading) {
        setLoading(true);
      }

      setError("");

      api.projects
        .listAllComments({ projectId: resolvedProjectId })
        .then((data) => {
          if (isMounted) {
            setComments((current) =>
              mergeCommentsById(
                current,
                Array.isArray(data.comments) ? data.comments : [],
              ),
            );
          }
        })
        .catch((requestError) => {
          if (isMounted) {
            setError(
              requestError.message || "No se pudieron cargar las observaciones.",
            );
          }
        })
        .finally(() => {
          if (isMounted && showLoading) {
            setLoading(false);
          }
        });
    }

    loadProjectComments({ showLoading: true });

    const unsubscribe = api.projects.subscribeToEvents({
      projectId: resolvedProjectId,
      onCommentCreated: (comment) => {
        if (isMounted) {
          setComments((current) => upsertCommentById(current, comment));
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

  const submitComment = async ({ message, parentCommentId = null }) => {
    if (isProjectOperationallyReadOnly(project)) {
      setError(getProjectReadOnlyMessage(project));
      return;
    }

    if (!resolvedProjectId) {
      setError("No se encontro el proyecto para comentar.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const data = await api.projects.createComment({
        content: message,
        parentCommentId,
        projectId: resolvedProjectId,
      });

      if (data.comment) {
        setComments((current) => upsertCommentById(current, data.comment));
      }
    } catch (requestError) {
      setError(requestError.message || "No se pudo guardar la observación.");
    } finally {
      setLoading(false);
    }
  };

  return {
    comments,
    error,
    loading,
    submitComment,
  };
}
