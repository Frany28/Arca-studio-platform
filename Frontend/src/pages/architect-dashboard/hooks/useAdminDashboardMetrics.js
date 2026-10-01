import { useEffect, useState } from "react";
import { api } from "../../../api/http.js";

export function useAdminDashboardMetrics({ empty, currentUser }) {
  const [adminMetrics, setAdminMetrics] = useState(null);

  const [adminMetricsError, setAdminMetricsError] = useState("");

  const [adminMetricsLoading, setAdminMetricsLoading] = useState(
    currentUser.roleCode === "admin" && !empty,
  );

  const [adminMetricsRequestKey, setAdminMetricsRequestKey] = useState(0);

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

        setAdminMetricsLoading(true);
        setAdminMetricsError("");
        return api.admin.getDashboardMetrics({
          signal: abortController.signal,
        });
      })
      .then((data) => {
        if (data) {
          setAdminMetrics(data.metrics || null);
        }
      })
      .catch((error) => {
        if (error?.name !== "AbortError") {
          setAdminMetricsError(
            error?.message || "No se pudieron cargar las métricas.",
          );
        }
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setAdminMetricsLoading(false);
        }
      });

    return () => abortController.abort();
  }, [adminMetricsRequestKey, currentUser.roleCode, empty]);

  return {
    adminMetrics,
    adminMetricsError,
    adminMetricsLoading,
    setAdminMetricsRequestKey,
  };
}
