import { useEffect, useRef, useState } from "react";

import { api } from "../../../api/http.js";
import { VERSION_HISTORY_PAGE_SIZE } from "../utils/adminFileReview.js";
import { toQuoteHistoryVersion } from "../utils/adminQuoteDocuments.js";

const EMPTY = Object.freeze({ error: "", key: "", loading: false, loadingMore: false, nextCursor: null, versions: [] });
const HISTORY_ERROR = "No se pudo cargar el historial de versiones.";

/**
 * Historial de PDF de una cotización (sus versiones comerciales) con la forma del drawer del
 * administrador: la primera página al abrir y «Mostrar más versiones» con la siguiente. Cambiar de
 * cotización o recargar aborta las lecturas en curso y una respuesta obsoleta nunca se muestra.
 *
 * @param {number|null} quoteId - Cotización abierta (null no lee).
 * @returns {{ versions: Array<Object>, loading: boolean, loadingMore: boolean, error: string, hasMore: boolean,
 * loadMore: () => Promise<void>, reload: () => void }} Historial y acciones.
 */
export function useAdminQuotePdfVersions(quoteId) {
  const [state, setState] = useState(EMPTY);
  const [requestKey, setRequestKey] = useState(0);
  const moreRequest = useRef(null);
  const key = quoteId ? `${quoteId}:${requestKey}` : "";

  useEffect(() => {
    if (!key) return undefined;
    const controller = new AbortController();
    const { signal } = controller;
    moreRequest.current?.abort();
    queueMicrotask(() => {
      if (!signal.aborted) setState((current) => ({ ...EMPTY, key, loading: true, versions: current.key.startsWith(`${quoteId}:`) ? current.versions : [] }));
    });
    api.quotes.listQuotePdfVersions({ limit: VERSION_HISTORY_PAGE_SIZE, quoteId, signal })
      .then((payload) => {
        if (!signal.aborted) setState({ ...EMPTY, key, nextCursor: payload?.nextCursor || null, versions: (payload?.versions || []).map(toQuoteHistoryVersion) });
      })
      .catch((error) => {
        if (!signal.aborted && error?.name !== "AbortError") setState({ ...EMPTY, error: error?.message || HISTORY_ERROR, key });
      });
    return () => controller.abort();
  }, [key, quoteId]);

  /**
   * Añade la página siguiente; ignora clics repetidos y descarta la respuesta si cambió la cotización.
   *
   * @returns {Promise<void>}
   */
  async function loadMore() {
    if (!state.nextCursor || moreRequest.current || state.key !== key) return;
    const controller = new AbortController();
    moreRequest.current = controller;
    setState((current) => ({ ...current, loadingMore: true }));
    try {
      const payload = await api.quotes.listQuotePdfVersions({ cursor: state.nextCursor, limit: VERSION_HISTORY_PAGE_SIZE, quoteId, signal: controller.signal });
      if (controller.signal.aborted) return;
      setState((current) => (current.key !== key ? current : {
        ...current,
        loadingMore: false,
        nextCursor: payload?.nextCursor || null,
        versions: [...current.versions, ...(payload?.versions || []).map(toQuoteHistoryVersion)],
      }));
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError") return;
      setState((current) => ({ ...current, error: error?.message || HISTORY_ERROR, loadingMore: false }));
    } finally {
      if (moreRequest.current === controller) moreRequest.current = null;
    }
  }

  const sameQuote = Boolean(key) && state.key.startsWith(`${quoteId}:`);
  const current = state.key === key ? state : sameQuote ? { ...state, loading: true } : { ...EMPTY, loading: Boolean(key) };
  return {
    error: current.error,
    hasMore: Boolean(current.nextCursor),
    loadMore,
    loading: current.loading,
    loadingMore: current.loadingMore,
    reload: () => setRequestKey((value) => value + 1),
    versions: current.versions,
  };
}
