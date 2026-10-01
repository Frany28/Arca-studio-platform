import { useEffect, useState } from "react";
import { api } from "../../../api/http.js";

export function useClientRequests({ user }) {
  const [projectRequests, setProjectRequests] = useState([]);

  const [projectRequestsError, setProjectRequestsError] = useState("");

  const [projectRequestsLoading, setProjectRequestsLoading] = useState(false);

  const [projectRequestsLoadingMore, setProjectRequestsLoadingMore] =
    useState(false);

  const [projectRequestsNextCursor, setProjectRequestsNextCursor] =
    useState(null);

  const [projectRequestsRevision, setProjectRequestsRevision] = useState(0);

  useEffect(() => {
    if (!user) return undefined;

    let isMounted = true;
    setProjectRequestsLoading(true);
    setProjectRequestsError("");

    api.projectRequests
      .list()
      .then((data) => {
        if (isMounted) {
          setProjectRequests(data.projectRequests || []);
          setProjectRequestsNextCursor(data.nextCursor || null);
        }
      })
      .catch(() => {
        if (isMounted) {
          setProjectRequests([]);
          setProjectRequestsError("No se pudieron cargar tus solicitudes.");
        }
      })
      .finally(() => {
        if (isMounted) setProjectRequestsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [projectRequestsRevision, user]);

  const loadMoreProjectRequests = async () => {
    if (!projectRequestsNextCursor || projectRequestsLoadingMore) return;

    setProjectRequestsLoadingMore(true);
    setProjectRequestsError("");

    try {
      const data = await api.projectRequests.list({
        cursor: projectRequestsNextCursor,
      });
      setProjectRequests((current) => {
        const byId = new Map(current.map((item) => [String(item.id), item]));
        (data.projectRequests || []).forEach((item) => {
          byId.set(String(item.id), item);
        });
        return Array.from(byId.values());
      });
      setProjectRequestsNextCursor(data.nextCursor || null);
    } catch {
      setProjectRequestsError("No se pudieron cargar más solicitudes.");
    } finally {
      setProjectRequestsLoadingMore(false);
    }
  };

  return {
    projectRequests,
    projectRequestsError,
    projectRequestsLoading,
    projectRequestsLoadingMore,
    projectRequestsNextCursor,
    setProjectRequestsRevision,
    loadMoreProjectRequests,
  };
}
