import { useCallback, useEffect, useState } from "react";

import { loadAdminDashboardOverview } from "../api/adminDashboardOverview.js";
import { toAdminDrawerActivity } from "../utils/adminActivity.js";

/**
 * Carga y adapta la actividad administrativa para el panel de notificaciones.
 * Delega al loader la caché de 15 segundos y la deduplicación por ID o correo;
 * sin ambos utiliza admin-session. refresh omite la caché, pero reutiliza requests
 * pendientes; ante error conserva la actividad, expone error y devuelve [].
 * El cleanup descarta respuestas del efecto sin abortarlas. Desactivar enabled
 * conserva el estado; el refresco manual no está cubierto por esa guarda de montaje.
 *
 * @param {Object} [params={}] - Contexto de lectura.
 * @param {boolean} [params.enabled=false] - Habilita la carga automática.
 * @param {Object|null} [params.user] - Determina el ámbito de caché; no verifica su rol.
 * @returns {Object} activity, error, loading y refresh, que devuelve Promise<Array>.
 */
export function useAdminRecentActivity({ enabled = false, user } = {}) {
  const [activity, setActivity] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const scopeKey = user?.id || user?.email;

  const loadActivity = useCallback(async ({ force = false } = {}) => {
    setLoading(true);
    setError("");

    try {
      const overview = await loadAdminDashboardOverview({ force, scopeKey });
      const nextActivity = (overview?.recentActivity || []).map(
        toAdminDrawerActivity,
      );
      setActivity(nextActivity);
      return nextActivity;
    } catch (requestError) {
      setError(
        requestError?.message
          || "No se pudo cargar la actividad administrativa.",
      );
      return [];
    } finally {
      setLoading(false);
    }
  }, [scopeKey]);

  useEffect(() => {
    if (!enabled) return undefined;

    let active = true;

    loadAdminDashboardOverview({ scopeKey })
      .then((overview) => {
        if (active) {
          setActivity(
            (overview?.recentActivity || []).map(toAdminDrawerActivity),
          );
          setError("");
        }
      })
      .catch((requestError) => {
        if (active) {
          setError(
            requestError?.message
              || "No se pudo cargar la actividad administrativa.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    setLoading(true);

    return () => {
      active = false;
    };
  }, [enabled, scopeKey]);

  return {
    activity,
    error,
    loading,
    refresh: () => loadActivity({ force: true }),
  };
}
