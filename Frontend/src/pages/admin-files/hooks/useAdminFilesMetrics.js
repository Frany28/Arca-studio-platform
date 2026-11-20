import { useEffect, useState } from "react";

import { api } from "../../../api/http.js";
import { isFileManagerUnavailable } from "../utils/adminFilesPresentation.js";

const ERROR_MESSAGE = "No se pudieron cargar las métricas de archivos.";

/**
 * Lee las métricas de un archivo como `{ totalFiles, usedBytes, lastUploadAt }` desde el resumen
 * del dashboard (`metrics.files`), que sigue disponible con la activación apagada.
 *
 * @param {AbortSignal} signal - Cancela la petición.
 * @returns {Promise<{totalFiles: number, usedBytes: number, lastUploadAt: string|null}>} Métricas.
 */
async function readDashboardFileMetrics(signal) {
  const response = await api.admin.getDashboardMetrics({ signal });
  const files = response?.metrics?.files || {};
  return { lastUploadAt: files.latestUploadAt ?? null, totalFiles: files.total ?? 0, usedBytes: files.totalBytes ?? 0 };
}

/**
 * Métricas de la cabecera: cantidad, espacio usado y última carga del administrador de archivos.
 * También resuelve la disponibilidad del administrador: si sus rutas responden 404
 * API_ROUTE_NOT_FOUND (activación apagada), las métricas se leen del resumen del dashboard y la
 * pantalla presenta el resto como no disponible, sin datos de demostración.
 *
 * @returns {{metrics: Object|null, loading: boolean, error: string,
 * availability: "checking"|"available"|"unavailable"|"unknown", reload: () => void}} Estado.
 */
export function useAdminFilesMetrics() {
  const [state, setState] = useState({ availability: "checking", error: "", loading: true, metrics: null });
  const [requestKey, setRequestKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    queueMicrotask(() => {
      if (!signal.aborted) setState((current) => ({ ...current, error: "", loading: true }));
    });

    /**
     * Lee las métricas del administrador o, si no está activado, las del dashboard.
     *
     * @returns {Promise<void>}
     */
    async function load() {
      try {
        const response = await api.fileManager.getMetrics({ signal });
        if (!signal.aborted) setState({ availability: "available", error: "", loading: false, metrics: response?.metrics || null });
      } catch (error) {
        if (signal.aborted) return;
        if (!isFileManagerUnavailable(error)) {
          setState({ availability: "unknown", error: error?.message || ERROR_MESSAGE, loading: false, metrics: null });
          return;
        }
        try {
          const metrics = await readDashboardFileMetrics(signal);
          if (!signal.aborted) setState({ availability: "unavailable", error: "", loading: false, metrics });
        } catch (fallbackError) {
          if (!signal.aborted) setState({ availability: "unavailable", error: fallbackError?.message || ERROR_MESSAGE, loading: false, metrics: null });
        }
      }
    }

    load();
    return () => controller.abort();
  }, [requestKey]);

  return { ...state, reload: () => setRequestKey((key) => key + 1) };
}
