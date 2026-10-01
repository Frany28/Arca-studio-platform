import { useEffect, useState } from "react";
import { api } from "../../../api/http.js";

export function useProjectReviewQueue({ empty, currentUser }) {
  const [reviewRequests, setReviewRequests] = useState([]);

  const [reviewRequestsError, setReviewRequestsError] = useState("");

  const [reviewRequestsLoading, setReviewRequestsLoading] = useState(
    ["admin", "architect"].includes(currentUser.roleCode) && !empty,
  );

  const [reviewRequestsRevision, setReviewRequestsRevision] = useState(0);

  useEffect(() => {
    if (!["admin", "architect"].includes(currentUser.roleCode) || empty) {
      setReviewRequests([]);
      setReviewRequestsLoading(false);
      return undefined;
    }

    let active = true;
    setReviewRequestsLoading(true);
    setReviewRequestsError("");
    api.projectRequests
      .listReviewQueue()
      .then((data) => {
        if (active) setReviewRequests(data.projectRequests || []);
      })
      .catch((error) => {
        if (active) {
          setReviewRequests([]);
          setReviewRequestsError(error?.message || "No se pudieron cargar las solicitudes.");
        }
      })
      .finally(() => {
        if (active) setReviewRequestsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [currentUser.roleCode, empty, reviewRequestsRevision]);

  return {
    reviewRequests,
    reviewRequestsError,
    reviewRequestsLoading,
    setReviewRequestsRevision,
  };
}
