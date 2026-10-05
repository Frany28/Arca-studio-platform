import { useEffect, useState } from "react";

import { api } from "../../../api/http.js";
import { loadAdminDashboardOverview } from "../../../api/adminDashboardOverview.js";

/**
 * Carga métricas, overview administrativo y responsables disponibles para el dashboard.
 * Solo consulta con rol admin y fuera del escenario vacío; cada lectura conserva
 * su loading independiente. La página consume actividad y solicitudes desde el overview.
 *
 * @param {Object} params - Contexto de sesión y claves externas de refresco.
 * @param {boolean} params.empty - Omite las consultas del escenario de ejemplo vacío.
 * @param {string} params.roleCode - Rol usado para habilitar las lecturas administrativas.
 * @param {Object|null} params.user - Usuario cuyo ID o correo delimita la caché del overview.
 * @param {number} params.adminMetricsRequestKey - Un cambio vuelve a consultar las métricas.
 * @param {number} params.adminOverviewRequestKey - Un cambio recarga el overview; si es mayor que cero fuerza lectura.
 * @returns {Object} Métricas, overview y responsables con loading; errores independientes
 * de métricas y overview, y setAdminOverview para reconciliar asignaciones desde la página.
 */
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

    // La microtarea evita iniciar la consulta si el efecto ya se limpió.
    // Métricas recibe la señal de cancelación; un error conserva el valor anterior.
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
        // El helper reutiliza caché de 15 s y peticiones activas por ID/correo.
        // force evita reutilizar caché vigente, pero sigue deduplicando peticiones activas.
        // Esta señal no se envía al helper: la limpieza impide aplicar su resultado exitoso.
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
        // El catálogo no depende de las claves de refresco. Un fallo no publica
        // un error propio: vacía responsables; la señal y la guarda protegen esta lectura.
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
