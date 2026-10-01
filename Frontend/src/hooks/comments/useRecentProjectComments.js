import { upsertCommentById, mergeCommentsById } from "../../utils/commentCollection.js";
import { toDrawerComment, normalizeProjectIds } from "../../utils/commentMappers.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api/http.js";
import { canAccessObservations } from "../../utils/observationAccess.js";

export function useRecentProjectComments({
  enabled = true,
  projectIds = [],
  projectNamesById = {},
  refreshIntervalMs = 0,
  user,
}) {
  const observationsAllowed = enabled && canAccessObservations(user);
  const projectIdsKey = useMemo(
    () => normalizeProjectIds(projectIds).join(","),
    [projectIds],
  );
  const normalizedProjectIds = useMemo(
    () =>
      projectIdsKey
        ? projectIdsKey.split(",").map((projectId) => Number(projectId))
        : [],
    [projectIdsKey],
  );
  const [comments, setComments] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!observationsAllowed || normalizedProjectIds.length === 0) {
      const resetId = window.setTimeout(() => {
        setComments([]);
        setError("");
        setLoading(false);
      }, 0);
      return () => window.clearTimeout(resetId);
    }

    let isMounted = true;

    setLoading(true);
    setError("");

    Promise.all(
      normalizedProjectIds.map((projectId) =>
        api.projects.listAllComments({ projectId }),
      ),
    )
      .then((responses) => {
        if (isMounted) {
          setComments(
            responses.flatMap((data) =>
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
        if (isMounted) {
          setLoading(false);
        }
      });

    const unsubscribers = normalizedProjectIds.map((projectId) =>
      api.projects.subscribeToEvents({
        projectId,
        onCommentCreated: (comment) => {
          if (isMounted) {
            setComments((current) => upsertCommentById(current, comment));
          }
        },
      }),
    );
    const refreshIntervalId =
      refreshIntervalMs > 0
        ? window.setInterval(() => {
            Promise.all(
              normalizedProjectIds.map((projectId) =>
                api.projects.listAllComments({ projectId }),
              ),
            )
              .then((responses) => {
                if (isMounted) {
                  setComments((current) =>
                    mergeCommentsById(
                      current,
                      responses.flatMap((data) =>
                        Array.isArray(data.comments) ? data.comments : [],
                      ),
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
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [normalizedProjectIds, observationsAllowed, refreshIntervalMs]);

  const refresh = useCallback(async () => {
    if (!observationsAllowed || normalizedProjectIds.length === 0) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const responses = await Promise.all(
        normalizedProjectIds.map((projectId) =>
          api.projects.listAllComments({ projectId }),
        ),
      );

      setComments(
        responses.flatMap((data) =>
          Array.isArray(data.comments) ? data.comments : [],
        ),
      );
    } catch (requestError) {
      setError(
        requestError.message || "No se pudieron cargar las observaciones.",
      );
    } finally {
      setLoading(false);
    }
  }, [normalizedProjectIds, observationsAllowed]);

  const drawerComments = useMemo(
    () => observationsAllowed
      ? comments.map((comment) => toDrawerComment(comment, user, projectNamesById))
      : [],
    [comments, observationsAllowed, projectNamesById, user],
  );

  return {
    comments,
    drawerComments,
    error,
    loading,
    refresh,
  };
}
