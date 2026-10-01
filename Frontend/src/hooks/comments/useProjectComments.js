import { upsertCommentById, mergeCommentsById } from "../../utils/commentCollection.js";
import { toDrawerComment } from "../../utils/commentMappers.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api/http.js";

export function useProjectComments({
  enabled = true,
  projectId,
  refreshIntervalMs = 0,
  user,
}) {
  const [comments, setComments] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !projectId) {
      setComments([]);
      setError("");
      setLoading(false);
      return undefined;
    }

    let isMounted = true;

    setLoading(true);
    setError("");

    api.projects
      .listAllComments({ projectId })
      .then((data) => {
        if (isMounted) {
          setComments(Array.isArray(data.comments) ? data.comments : []);
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
        if (isMounted) {
          setLoading(false);
        }
      });

    const unsubscribe = api.projects.subscribeToEvents({
      projectId,
      onCommentCreated: (comment) => {
        if (isMounted) {
          setComments((current) => upsertCommentById(current, comment));
        }
      },
      onError: () => {
        if (refreshIntervalMs > 0 && isMounted) {
          api.projects
            .listAllComments({ projectId })
            .then((data) => {
              if (isMounted) {
                setComments(Array.isArray(data.comments) ? data.comments : []);
              }
            })
            .catch(() => {});
        }
      },
    });
    const refreshIntervalId =
      refreshIntervalMs > 0
        ? window.setInterval(() => {
            api.projects
              .listAllComments({ projectId })
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
              .catch(() => {});
          }, refreshIntervalMs)
        : null;

    return () => {
      isMounted = false;
      if (refreshIntervalId) {
        window.clearInterval(refreshIntervalId);
      }
      unsubscribe();
    };
  }, [enabled, projectId, refreshIntervalMs]);

  const submitComment = useCallback(
    async (input) => {
      // Support both `submitComment("text")` and `submitComment({ message, parentCommentId })`
      const payload =
        typeof input === "string"
          ? { message: input, parentCommentId: null }
          : input || {};

      const { message, parentCommentId } = payload;
      const targetProjectId =
        payload.projectId == null || payload.projectId === ""
          ? projectId
          : payload.projectId;

      if (!targetProjectId) {
        setError("No se encontro el proyecto para comentar.");
        return;
      }

      const normalizedParent =
        parentCommentId == null || parentCommentId === ""
          ? null
          : Number.isFinite(Number(parentCommentId))
            ? Number(parentCommentId)
            : parentCommentId;

      setLoading(true);
      setError("");

      try {
        const data = await api.projects.createComment({
          commentType: payload.commentType,
          content: message,
          image: payload.image,
          parentCommentId: normalizedParent,
          projectId: targetProjectId,
          selection: payload.selection,
          targetId: payload.targetId,
        });

        if (data && data.comment) {
          setComments((current) => upsertCommentById(current, data.comment));
        }
      } catch (requestError) {
        setError(requestError.message || "No se pudo guardar la observación.");
        throw requestError;
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  const refresh = useCallback(async () => {
    if (!projectId) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const data = await api.projects.listAllComments({ projectId });

      setComments(Array.isArray(data.comments) ? data.comments : []);
    } catch (requestError) {
      setError(
        requestError.message || "No se pudieron cargar las observaciones.",
      );
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const drawerComments = useMemo(
    () =>
      comments.map((comment) => toDrawerComment(comment, user)),
    [comments, user],
  );

  return {
    comments,
    drawerComments,
    error,
    loading,
    submitComment,
    refresh,
  };
}
