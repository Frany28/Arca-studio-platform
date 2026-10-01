import { useEffect, useState } from "react";
import { api } from "../../../api/http.js";

export function useAdminAssignees({ empty, currentUser }) {
  const [adminAssignees, setAdminAssignees] = useState([]);

  const [adminAssigneesLoading, setAdminAssigneesLoading] = useState(
    currentUser.roleCode === "admin" && !empty,
  );

  useEffect(() => {
    if (currentUser.roleCode !== "admin" || empty) {
      return undefined;
    }

    const abortController = new AbortController();
    Promise.resolve()
      .then(() => {
        if (abortController.signal.aborted) return null;
        setAdminAssigneesLoading(true);
        return api.admin.listAssignees({ signal: abortController.signal });
      })
      .then((data) => {
        if (data && !abortController.signal.aborted) {
          setAdminAssignees(data.assignees || []);
        }
      })
      .catch((error) => {
        if (error?.name !== "AbortError") {
          setAdminAssignees([]);
        }
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setAdminAssigneesLoading(false);
        }
      });

    return () => abortController.abort();
  }, [currentUser.roleCode, empty]);

return { adminAssignees, adminAssigneesLoading };
}
