import { useCallback, useEffect, useRef, useState } from "react";

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
 * @param {boolean} [params.loadOverview=true] - Permite reutilizar métricas sin cargar el overview.
 * @param {boolean} [params.loadAssignees=true] - Permite omitir el catálogo cuando no hay asignación editable.
 * @returns {Object} Métricas, overview y responsables con loading; errores independientes
 * de métricas y overview, setAdminOverview para reconciliar asignaciones desde la página y
 * revalidate para releer métricas y overview en segundo plano.
 *
 * Cada lectura de métricas u overview recibe un número de secuencia: solo se aplica la
 * respuesta de la lectura más reciente, de modo que una respuesta tardía nunca sobrescribe
 * datos más nuevos. `revalidate` conserva lo mostrado (sin loading ni error). Si hay una lectura
 * explícita del mismo recurso en curso (pudo empezar antes de la mutación), la revalidación queda
 * pendiente y se ejecuta al terminar esa lectura, de modo que siempre se lee el estado posterior.
 */
export function useAdminDashboardData({
  empty,
  roleCode,
  user,
  adminMetricsRequestKey,
  adminOverviewRequestKey,
  loadOverview = true,
  loadAssignees = true,
}) {
  const [adminMetrics, setAdminMetrics] = useState(null);
  const [adminMetricsError, setAdminMetricsError] = useState("");
  const [adminMetricsLoading, setAdminMetricsLoading] = useState(
    roleCode === "admin" && !empty,
  );
  const [adminOverview, setAdminOverview] = useState(null);
  const [adminOverviewError, setAdminOverviewError] = useState("");
  const [adminOverviewLoading, setAdminOverviewLoading] = useState(
    roleCode === "admin" && !empty && loadOverview,
  );
  const [adminAssignees, setAdminAssignees] = useState([]);
  const [adminAssigneesLoading, setAdminAssigneesLoading] = useState(
    roleCode === "admin" && !empty && loadAssignees,
  );
  // Secuencia de la última lectura iniciada por recurso y lecturas explícitas en curso.
  const readsRef = useRef({
    metrics: 0,
    metricsBusy: false,
    metricsQueued: false,
    overview: 0,
    overviewBusy: false,
    overviewQueued: false,
  });
  const activeRef = useRef(true);
  // Revalidación vigente para ejecutar la pendiente al terminar una lectura explícita.
  const revalidateResourceRef = useRef(null);
  // Ámbito de la caché del overview. Los efectos dependen de este valor y no del objeto `user`:
  // AuthContext publica un objeto nuevo al confirmar la misma sesión (p. ej. tras un 401 que
  // /auth/me desmiente), y eso no debe repetir lecturas. Otra cuenta cambia el id y sí relee.
  const scopeKey = user?.id || user?.email;

  /**
   * Libera la marca de lectura explícita de un recurso si `read` es la última iniciada y, si
   * entretanto se pidió una revalidación, la ejecuta ahora.
   *
   * @param {"metrics"|"overview"} resource - Recurso leído.
   * @param {number|null} read - Secuencia de la lectura que termina.
   * @returns {void}
   */
  const settleExplicitRead = (resource, read) => {
    const reads = readsRef.current;
    if (read === null || read !== reads[resource]) return;
    reads[`${resource}Busy`] = false;
    if (reads[`${resource}Queued`]) {
      reads[`${resource}Queued`] = false;
      revalidateResourceRef.current?.(resource);
    }
  };

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (roleCode !== "admin" || empty) {
      return undefined;
    }

    // La microtarea evita iniciar la consulta si el efecto ya se limpió.
    // Métricas recibe la señal de cancelación; un error conserva el valor anterior.
    const abortController = new AbortController();
    let read = null;
    Promise.resolve()
      .then(() => {
        if (abortController.signal.aborted) {
          return null;
        }

        readsRef.current.metrics += 1;
        readsRef.current.metricsBusy = true;
        read = readsRef.current.metrics;
        setAdminMetricsLoading(true);
        setAdminMetricsError("");
        return api.admin.getDashboardMetrics({
          signal: abortController.signal,
        });
      })
      .then((data) => {
        if (data && read === readsRef.current.metrics) {
          setAdminMetrics(data.metrics || null);
        }
      })
      .catch((error) => {
        if (error?.name !== "AbortError" && read === readsRef.current.metrics) {
          setAdminMetricsError(
            error?.message || "No se pudieron cargar las métricas.",
          );
        }
      })
      .finally(() => {
        settleExplicitRead("metrics", read);
        if (!abortController.signal.aborted) {
          setAdminMetricsLoading(false);
        }
      });

    return () => abortController.abort();
  }, [adminMetricsRequestKey, roleCode, empty]);

  useEffect(() => {
    if (roleCode !== "admin" || empty || !loadOverview) {
      return undefined;
    }

    const abortController = new AbortController();
    let read = null;

    Promise.resolve()
      .then(() => {
        if (abortController.signal.aborted) {
          return null;
        }

        readsRef.current.overview += 1;
        readsRef.current.overviewBusy = true;
        read = readsRef.current.overview;
        setAdminOverviewLoading(true);
        setAdminOverviewError("");
        // El helper reutiliza caché de 15 s y peticiones activas por ID/correo.
        // force evita reutilizar caché vigente, pero sigue deduplicando peticiones activas.
        // Esta señal no se envía al helper: la limpieza impide aplicar su resultado exitoso.
        return loadAdminDashboardOverview({
          force: adminOverviewRequestKey > 0,
          scopeKey,
        });
      })
      .then((overview) => {
        if (overview && !abortController.signal.aborted && read === readsRef.current.overview) {
          setAdminOverview(overview);
        }
      })
      .catch((error) => {
        if (error?.name !== "AbortError" && read === readsRef.current.overview) {
          setAdminOverviewError(
            error?.message || "No se pudo cargar la actividad administrativa.",
          );
        }
      })
      .finally(() => {
        settleExplicitRead("overview", read);
        if (!abortController.signal.aborted) {
          setAdminOverviewLoading(false);
        }
      });

    return () => abortController.abort();
  }, [adminOverviewRequestKey, roleCode, empty, scopeKey, loadOverview]);

  useEffect(() => {
    if (roleCode !== "admin" || empty || !loadAssignees) {
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
  }, [roleCode, empty, loadAssignees]);

  /**
   * Relee métricas y overview en segundo plano tras una mutación confirmada o al reanudar la
   * vista. Conserva lo mostrado: sin loading y, si falla, sin sustituir los datos por un error
   * (el reintento explícito sigue disponible en cada sección). El overview se pide con `force`
   * para no reutilizar la caché de 15 s.
   *
   * @param {"metrics"|"overview"} resource - Recurso a releer.
   * @returns {void}
   */
  const revalidateResource = useCallback((resource) => {
    if (roleCode !== "admin" || empty || !activeRef.current) return;
    const reads = readsRef.current;
    if (reads[`${resource}Busy`]) {
      reads[`${resource}Queued`] = true;
      return;
    }

    if (resource === "metrics") {
      reads.metrics += 1;
      const read = reads.metrics;
      api.admin.getDashboardMetrics()
        .then((data) => {
          if (activeRef.current && read === readsRef.current.metrics) {
            setAdminMetrics(data?.metrics || null);
            setAdminMetricsError("");
          }
        })
        // Fallo deliberadamente silencioso: se conservan las métricas mostradas.
        .catch(() => {});
      return;
    }

    if (resource === "overview" && loadOverview) {
      reads.overview += 1;
      const read = reads.overview;
      loadAdminDashboardOverview({ force: true, scopeKey })
        .then((overview) => {
          if (overview && activeRef.current && read === readsRef.current.overview) {
            setAdminOverview(overview);
            setAdminOverviewError("");
          }
        })
        // Fallo deliberadamente silencioso: se conserva el overview mostrado.
        .catch(() => {});
    }
  }, [empty, loadOverview, roleCode, scopeKey]);

  useEffect(() => {
    revalidateResourceRef.current = revalidateResource;
  });

  const revalidate = useCallback(() => {
    revalidateResource("metrics");
    revalidateResource("overview");
  }, [revalidateResource]);

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
    revalidate,
  };
}
