import { useEffect, useRef, useState } from "react";

const SEARCH_DEBOUNCE_MS = 300;
const NO_FILTERS = Object.freeze({});

/**
 * Lista administrativa con búsqueda en la API, filtros y paginación por cursor (Anterior y
 * Siguiente, sin totales porque el contrato no los ofrece). La búsqueda escrita se aplica tras
 * una pausa; cambiar la búsqueda o un filtro descarta los cursores, que pertenecen a la consulta
 * anterior, y vuelve a la primera página. Cada lectura aborta la anterior, de modo que una
 * respuesta lenta nunca sustituye a una consulta más reciente.
 *
 * @param {Object} params - Lectura y presentación de errores.
 * @param {(query: Object) => Promise<Object>} params.fetchPage - Lee una página; recibe `cursor`,
 * `limit`, `search`, `signal` y los filtros activos. Se lee desde una ref: puede cambiar de
 * identidad entre renders sin repetir la lectura.
 * @param {string} params.collectionKey - Campo de la respuesta con las filas.
 * @param {number} params.pageSize - Filas por página.
 * @param {string} params.errorMessage - Mensaje si la lectura falla sin texto útil.
 * @param {Object} [params.initialFilters] - Filtros iniciales; un valor vacío no se aplica.
 * @returns {Object} Filas, carga y error, búsqueda, filtros, paginación, recargas, reemplazo de
 * una fila y `pageKey`, que cambia con cada página recibida (no con un reemplazo de fila).
 */
export function useCursorSearchList({ collectionKey, errorMessage, fetchPage, initialFilters = NO_FILTERS, pageSize }) {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [filters, setFiltersState] = useState(initialFilters);
  const [cursorHistory, setCursorHistory] = useState([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [requestKey, setRequestKey] = useState(0);
  const [pageKey, setPageKey] = useState(0);
  const fetchPageRef = useRef(fetchPage);
  useEffect(() => {
    fetchPageRef.current = fetchPage;
  });

  /**
   * Vuelve a la primera página descartando los cursores de la consulta anterior.
   *
   * @returns {void}
   */
  function resetCursor() {
    setCursorHistory([null]);
    setPageIndex(0);
  }

  // La búsqueda escrita se aplica sin espacios exteriores tras la pausa. La ref evita reiniciar
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
    fetchPageRef.current({
      ...filters,
      cursor: cursorHistory[pageIndex],
      limit: pageSize,
      search: appliedSearch || undefined,
      signal: controller.signal,
    }).then((payload) => {
      if (controller.signal.aborted) return;
      setItems(payload?.[collectionKey] || []);
      setNextCursor(payload?.nextCursor || null);
      setPageKey((key) => key + 1);
    }).catch((requestError) => {
      if (requestError?.name === "AbortError" || controller.signal.aborted) return;
      setError(requestError?.message || errorMessage);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [appliedSearch, collectionKey, cursorHistory, errorMessage, filters, pageIndex, pageSize, requestKey]);

  /**
   * Cambia un filtro y vuelve a la primera página. Un valor vacío (null, undefined o "") lo retira.
   *
   * @param {string} name - Parámetro de la API.
   * @param {string|number|null|undefined} value - Valor del filtro.
   * @returns {void}
   */
  function setFilter(name, value) {
    setFiltersState((current) => {
      const next = { ...current };
      if (value === null || value === undefined || value === "") delete next[name];
      else next[name] = value;
      return next;
    });
    resetCursor();
  }

  /**
   * Restaura la consulta inicial: sin búsqueda, sin filtros y en la primera página. El texto
   * aplicado se limpia de inmediato (sin esperar la pausa) para leer una sola vez.
   *
   * @returns {void}
   */
  function clearAll() {
    setQuery("");
    appliedSearchRef.current = "";
    setAppliedSearch("");
    setFiltersState(NO_FILTERS);
    resetCursor();
  }

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
   * Vuelve a la primera página y repite la lectura, por ejemplo tras crear un registro cuya
   * posición depende del orden del backend.
   *
   * @returns {void}
   */
  function reloadFromStart() {
    resetCursor();
    setRequestKey((key) => key + 1);
  }

  /**
   * Sustituye una fila por la versión devuelta por la API tras editarla o cambiar su estado.
   *
   * @param {Object} updated - Registro actualizado (mismo `id`).
   * @returns {void}
   */
  function replaceItem(updated) {
    setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  }

  return {
    error,
    filters,
    items,
    loading,
    pageKey,
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
    clearAll,
    reload: () => setRequestKey((key) => key + 1),
    reloadFromStart,
    replaceItem,
    setFilter,
  };
}
