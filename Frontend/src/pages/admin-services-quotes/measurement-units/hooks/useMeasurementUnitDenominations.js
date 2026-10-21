import { useEffect, useRef, useState } from "react";

import { api } from "../../../../api/http.js";

// Diez filas por página, como la tabla de usuarios; el contrato admite 1–100.
export const MEASUREMENT_UNITS_PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Lee las denominaciones (unidades de medida) con búsqueda en la API y paginación por cursor.
 * La búsqueda se aplica tras una pausa de escritura y vuelve a la primera página; cada lectura
 * aborta la anterior, así que una respuesta lenta nunca sustituye a una búsqueda más reciente.
 * No hay totales en el contrato: la navegación solo conoce si existe una página siguiente.
 *
 * @returns {Object} Filas, estado de carga y error, búsqueda, paginación, recarga, reemplazo de
 * una fila editada y `pageKey`, que cambia con cada página recibida para reiniciar la selección.
 */
export function useMeasurementUnitDenominations() {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [cursorHistory, setCursorHistory] = useState([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [requestKey, setRequestKey] = useState(0);
  // Cuenta las lecturas completadas: identifica cada página recibida (también al volver a una
  // ya visitada), de modo que la selección de una página anterior nunca reaparece.
  const [loadSequence, setLoadSequence] = useState(0);

  // La búsqueda escrita se aplica sin espacios exteriores tras la pausa; al aplicarla se
  // descartan los cursores, porque pertenecen a la búsqueda anterior. La ref evita reiniciar
  // (y volver a leer) cuando el texto efectivo no cambió, incluido el primer montaje.
  const appliedSearchRef = useRef("");
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const nextSearch = query.trim();
      if (nextSearch === appliedSearchRef.current) return;
      appliedSearchRef.current = nextSearch;
      setAppliedSearch(nextSearch);
      setCursorHistory([null]);
      setPageIndex(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    // Se marca la carga en una microtarea para no actualizar estado durante el efecto; una
    // lectura abortada no modifica filas, error ni carga.
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setLoading(true);
      setError("");
    });
    api.measurementUnits.listDenominations({
      cursor: cursorHistory[pageIndex],
      limit: MEASUREMENT_UNITS_PAGE_SIZE,
      search: appliedSearch || undefined,
      signal: controller.signal,
    }).then((payload) => {
      if (controller.signal.aborted) return;
      setItems(payload?.unitDenominations || []);
      setNextCursor(payload?.nextCursor || null);
      setLoadSequence((value) => value + 1);
    }).catch((requestError) => {
      if (requestError?.name === "AbortError" || controller.signal.aborted) return;
      setError(requestError?.message || "No se pudieron cargar las unidades de medida.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [appliedSearch, cursorHistory, pageIndex, requestKey]);

  /**
   * Avanza a la página siguiente solo si la respuesta anterior entregó `nextCursor`.
   *
   * @returns {void}
   */
  function goNext() {
    if (!nextCursor || loading) return;
    setCursorHistory((current) => [...current.slice(0, pageIndex + 1), nextCursor]);
    setPageIndex((index) => index + 1);
  }

  /**
   * Vuelve a la página anterior con el cursor guardado; no baja de la primera.
   *
   * @returns {void}
   */
  function goPrevious() {
    if (loading) return;
    setPageIndex((index) => Math.max(index - 1, 0));
  }

  /**
   * Vuelve a la primera página y repite la lectura, por ejemplo tras crear una unidad, cuya
   * posición depende del orden del backend (unidad base y texto).
   *
   * @returns {void}
   */
  function reloadFromStart() {
    setCursorHistory([null]);
    setPageIndex(0);
    setRequestKey((key) => key + 1);
  }

  /**
   * Sustituye una fila por la versión devuelta por la API tras editarla o cambiar su estado.
   *
   * @param {Object} updated - Denominación actualizada.
   * @returns {void}
   */
  function replaceItem(updated) {
    setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  }

  return {
    error,
    items,
    loading,
    pageKey: loadSequence,
    search: {
      applied: appliedSearch,
      query,
      setQuery,
      clear: () => setQuery(""),
    },
    pagination: {
      hasNext: Boolean(nextCursor),
      hasPrevious: pageIndex > 0,
      next: goNext,
      previous: goPrevious,
    },
    reload: () => setRequestKey((key) => key + 1),
    reloadFromStart,
    replaceItem,
  };
}
