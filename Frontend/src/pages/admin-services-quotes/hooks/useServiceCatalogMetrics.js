import { useEffect, useState } from "react";

import { api } from "../../../api/http.js";

/**
 * Deriva los indicadores del tabulador (totales, activos e inactivos) de la colección real de
 * servicios, porque el contrato no ofrece totales. El catálogo es acotado (tabulador 3.2) y se
 * recorre con el cursor una sola vez al montar el módulo; un error deja los valores como no
 * disponibles en lugar de mostrar cifras inventadas.
 *
 * @returns {{metrics: {total: number, active: number, inactive: number}|null, loading: boolean, error: string}}
 * Indicadores o null si no están disponibles.
 */
export function useServiceCatalogMetrics() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    api.serviceCatalog.listAllServices({ signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted) return;
        const services = payload?.services || [];
        const active = services.filter((service) => service.isActive).length;
        setMetrics({ active, inactive: services.length - active, total: services.length });
      })
      .catch((requestError) => {
        if (requestError?.name === "AbortError" || controller.signal.aborted) return;
        setError(requestError?.message || "No se pudieron cargar los indicadores de servicios.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  return { error, loading, metrics };
}
