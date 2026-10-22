import { useEffect, useState } from "react";

import { api } from "../../../../api/http.js";

/**
 * Lee el servicio que se va a editar para partir de sus datos y su versión vigente
 * (`currentVersion`), no de la fila de la tabla, que puede estar desactualizada. Sin servicio
 * (alta) no lee nada. Abortar al cerrar evita aplicar una respuesta tardía.
 *
 * @param {number|null} serviceId - Servicio editado, o null en el alta.
 * @returns {{service: Object|null, loading: boolean, error: Object|null, retry: () => void}} Lectura.
 */
export function useServiceDetail(serviceId) {
  const [result, setResult] = useState({ serviceId: null, service: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const current = result.serviceId === serviceId ? result : { service: null, error: null };

  useEffect(() => {
    if (!serviceId) return undefined;
    const controller = new AbortController();
    api.serviceCatalog.getService({ serviceId, signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted) setResult({ serviceId, service: payload?.service ?? null, error: null });
      })
      .catch((requestError) => {
        if (requestError?.name === "AbortError" || controller.signal.aborted) return;
        setResult({ serviceId, service: null, error: requestError });
      });
    return () => controller.abort();
  }, [attempt, serviceId]);

  return {
    error: current.error,
    loading: Boolean(serviceId) && !current.service && !current.error,
    /**
     * Repite la lectura tras un error.
     *
     * @returns {void}
     */
    retry: () => {
      setResult({ serviceId: null, service: null, error: null });
      setAttempt((value) => value + 1);
    },
    service: current.service,
  };
}
