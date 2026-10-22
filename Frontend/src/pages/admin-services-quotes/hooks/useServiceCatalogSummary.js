import { useEffect, useMemo, useState } from "react";

import { api } from "../../../api/http.js";

/**
 * Lee la colección completa del catálogo de servicios (acotado, tabulador 3.2) recorriendo el
 * cursor, porque el contrato no ofrece totales. De ella se derivan los indicadores del módulo
 * (totales, activos e inactivos) y las unidades que usan los servicios para el filtro del
 * tabulador. `reload` vuelve a leerla tras un cambio de estado; durante la recarga se conservan
 * los datos anteriores y una respuesta antigua nunca sustituye a una lectura más reciente. Un
 * error deja los valores como no disponibles en lugar de mostrar cifras inventadas.
 *
 * @returns {{services: Array<Object>, metrics: {total: number, active: number, inactive: number}|null,
 * loading: boolean, error: string, reload: () => void}} Colección, indicadores y recarga.
 */
export function useServiceCatalogSummary() {
  const [services, setServices] = useState(null);
  const [error, setError] = useState("");
  const [requestKey, setRequestKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api.serviceCatalog.listAllServices({ signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted) return;
        setServices(payload?.services || []);
        setError("");
      })
      .catch((requestError) => {
        if (requestError?.name === "AbortError" || controller.signal.aborted) return;
        setError(requestError?.message || "No se pudieron cargar los indicadores de servicios.");
      });
    return () => controller.abort();
  }, [requestKey]);

  const metrics = useMemo(() => {
    if (!services) return null;
    const active = services.filter((service) => service.isActive).length;
    return { active, inactive: services.length - active, total: services.length };
  }, [services]);

  return {
    error,
    // Solo la primera lectura muestra el estado de carga; una recarga conserva los valores.
    loading: services === null && !error,
    metrics,
    reload: () => setRequestKey((key) => key + 1),
    services: services || [],
  };
}
