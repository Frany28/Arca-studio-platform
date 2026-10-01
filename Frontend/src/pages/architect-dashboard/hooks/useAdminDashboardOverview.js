import { useEffect, useState } from "react";
import { loadAdminDashboardOverview } from "../../../api/adminDashboardOverview.js";

export function useAdminDashboardOverview({ empty, user, currentUser }) {
  const [adminOverview, setAdminOverview] = useState(null);

  const [adminOverviewError, setAdminOverviewError] = useState("");

  const [adminOverviewLoading, setAdminOverviewLoading] = useState(
    currentUser.roleCode === "admin" && !empty,
  );

  const [adminOverviewRequestKey, setAdminOverviewRequestKey] = useState(0);

  useEffect(() => {
    if (currentUser.roleCode !== "admin" || empty) {
      return undefined;
    }

    const abortController = new AbortController();

    Promise.resolve()
      .then(() => {
        if (abortController.signal.aborted) {
          return null;
        }

        setAdminOverviewLoading(true);
        setAdminOverviewError("");
        return loadAdminDashboardOverview({
          force: adminOverviewRequestKey > 0,
          scopeKey: user?.id || user?.email,
        });
      })
      .then((overview) => {
        if (overview && !abortController.signal.aborted) {
          setAdminOverview(overview);
        }
      })
      .catch((error) => {
        if (error?.name !== "AbortError") {
          setAdminOverviewError(
            error?.message || "No se pudo cargar la actividad administrativa.",
          );
        }
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setAdminOverviewLoading(false);
        }
      });

    return () => abortController.abort();
  }, [adminOverviewRequestKey, currentUser.roleCode, empty, user]);

  return {
    adminOverview,
    setAdminOverview,
    adminOverviewError,
    adminOverviewLoading,
    setAdminOverviewRequestKey,
  };
}
