import { upsertCommentById, mergeCommentsById } from "../../utils/commentCollection.js";
import { toDrawerComment, getEnvironmentCommentId } from "../../utils/commentMappers.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api/http.js";

export function useEnvironmentComments({
  enabled = true,
  refreshIntervalMs = 0,
  user,
}) {
  const [comments, setComments] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const fetchComments = useCallback(async () => {
    const data = await api.environmentComments.listAll();
    return Array.isArray(data.comments) ? data.comments : [];
  }, []);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let isMounted = true;

    queueMicrotask(() => {
      if (!isMounted) return;
      setLoading(true);
      setError("");
    });

    fetchComments()
      .then((nextComments) => {
        if (isMounted) setComments(nextComments);
      })
      .catch((requestError) => {
        if (isMounted) {
          setError(
            requestError.message || "No se pudieron cargar las observaciones.",
          );
        }
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    const refreshIntervalId =
      refreshIntervalMs > 0
        ? window.setInterval(() => {
            fetchComments()
              .then((nextComments) => {
                if (isMounted) {
                  setComments((current) =>
                    mergeCommentsById(current, nextComments),
                  );
                }
              })
              .catch(() => {});
          }, refreshIntervalMs)
        : null;

    return () => {
      isMounted = false;
      if (refreshIntervalId) window.clearInterval(refreshIntervalId);
    };
  }, [enabled, fetchComments, refreshIntervalMs]);

  const submitComment = useCallback(async (input) => {
    const payload =
      typeof input === "string"
        ? { message: input, parentCommentId: null }
        : input || {};
    const parentCommentId = payload.parentCommentId
      ? getEnvironmentCommentId(payload.parentCommentId)
      : null;

    setLoading(true);
    setError("");

    try {
      const data = await api.environmentComments.create({
        content: payload.message,
        parentCommentId,
      });

      if (data?.comment) {
        setComments((current) => upsertCommentById(current, data.comment));
      }
    } catch (requestError) {
      setError(requestError.message || "No se pudo guardar la observación.");
      throw requestError;
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      setComments(await fetchComments());
    } catch (requestError) {
      setError(
        requestError.message || "No se pudieron cargar las observaciones.",
      );
    } finally {
      setLoading(false);
    }
  }, [fetchComments]);

  const drawerComments = useMemo(
    () => comments.map((comment) => toDrawerComment(comment, user)),
    [comments, user],
  );

  return {
    comments,
    drawerComments,
    error,
    loading,
    refresh,
    submitComment,
  };
}
