import { useEffect, useState } from "react";

import { api } from "../../../api/http.js";

/**
 * Lee el total de cotizaciones registradas para el indicador «Cotizaciones totales» de la
 * cabecera del módulo. `reload` lo actualiza tras crear una cotización; durante la recarga se
 * conserva el valor anterior y una respuesta antigua nunca sustituye a una lectura más reciente.
 * Un error deja el valor como no disponible en lugar de mostrar una cifra inventada.
 *
 * @returns {{total: number|null, loading: boolean, error: string, reload: () => void}} Total y recarga.
 */
export function useQuoteSummary() {
  const [total, setTotal] = useState(null);
  const [error, setError] = useState("");
  const [requestKey, setRequestKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    api.quotes.getSummary({ signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted) return;
        setTotal(Number(payload?.summary?.total ?? 0));
        setError("");
      })
      .catch((requestError) => {
        if (requestError?.name === "AbortError" || controller.signal.aborted) return;
        setError(requestError?.message || "No se pudo cargar el total de cotizaciones.");
      });
    return () => controller.abort();
  }, [requestKey]);

  return {
    error,
    loading: total === null && !error,
    reload: () => setRequestKey((key) => key + 1),
    total,
  };
}
