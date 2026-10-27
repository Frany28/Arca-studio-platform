import { useEffect, useState } from "react";

import { api } from "../../../api/http.js";

const EMPTY = Object.freeze({ error: null, quote: null, quoteId: null });

/**
 * Lee una cotización con su versión vigente y sus conceptos (`GET /admin/quotes/:id`), sin
 * caché: editar con una versión antigua provocaría un 409. Cambiar de cotización aborta la
 * lectura anterior y un resultado de otra cotización nunca se devuelve. `reload` repite la
 * lectura, por ejemplo tras un conflicto de versión.
 *
 * @param {number|string|null} quoteId - Cotización a leer; null no lee nada.
 * @returns {{quote: Object|null, loading: boolean, error: {message: string, status?: number, code?: string}|null,
 * notFound: boolean, reload: () => void}} Estado de la lectura.
 */
export function useQuoteDetail(quoteId) {
  const [state, setState] = useState(EMPTY);
  const [requestKey, setRequestKey] = useState(0);
  const normalizedId = quoteId === null || quoteId === undefined || quoteId === "" ? null : String(quoteId);

  useEffect(() => {
    if (normalizedId === null) return undefined;
    const controller = new AbortController();
    api.quotes.getQuote({ quoteId: normalizedId, signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted) setState({ error: null, quote: payload?.quote ?? null, quoteId: normalizedId });
      })
      .catch((error) => {
        if (error?.name === "AbortError" || controller.signal.aborted) return;
        setState({
          error: { code: error?.code, message: error?.message || "No se pudo cargar la cotización.", status: error?.status },
          quote: null,
          quoteId: normalizedId,
        });
      });
    return () => controller.abort();
  }, [normalizedId, requestKey]);

  const current = state.quoteId === normalizedId ? state : EMPTY;
  return {
    error: current.error,
    loading: normalizedId !== null && current.quoteId !== normalizedId,
    notFound: current.error?.status === 404,
    quote: current.quote,
    reload: () => {
      setState(EMPTY);
      setRequestKey((key) => key + 1);
    },
  };
}
