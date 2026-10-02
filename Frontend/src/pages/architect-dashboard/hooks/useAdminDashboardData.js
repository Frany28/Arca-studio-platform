import { useEffect, useState } from "react";

import { api } from "../../../api/http.js";
import { loadAdminDashboardOverview } from "../../../api/adminDashboardOverview.js";

export function useAdminDashboardData({
  empty,
  roleCode,
  user,
  adminMetricsRequestKey,
  adminOverviewRequestKey,
}) {
  const [adminMetrics, setAdminMetrics] = useState(null);
  const [adminMetricsError, setAdminMetricsError] = useState("");
  const [adminMetricsLoading, setAdminMetricsLoading] = useState(
    roleCode === "admin" && !empty,
  );
  const [adminOverview, setAdminOverview] = useState(null);
  const [adminOverviewError, setAdminOverviewError] = useState("");
  const [adminOverviewLoading, setAdminOverviewLoading] = useState(
    roleCode === "admin" && !empty,
  );
  const [adminAssignees, setAdminAssignees] = useState([]);
  const [adminAssigneesLoading, setAdminAssigneesLoading] = useState(
    roleCode === "admin" && !empty,
  );

  useEffect(() => {
    if (roleCode !== "admin" || empty) {
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
  }, [adminMetricsRequestKey, roleCode, empty]);

  useEffect(() => {
    if (roleCode !== "admin" || empty) {
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
  }, [adminOverviewRequestKey, roleCode, empty, user]);

  useEffect(() => {
    if (roleCode !== "admin" || empty) {
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
  }, [roleCode, empty]);

  return {
    adminMetrics,
    adminMetricsError,
    adminMetricsLoading,
    adminOverview,
    adminOverviewError,
    adminOverviewLoading,
    adminAssignees,
    adminAssigneesLoading,
    setAdminOverview,
  };
}
