import { api } from "../../../../api/http.js";
import { QUOTES_PAGE_SIZE } from "../../../../config/quotesTable.js";
import { useCursorSearchList } from "../../hooks/useCursorSearchList.js";
import { DEFAULT_QUOTE_SORT, toCreatedRange, toggleQuoteSort } from "../utils/quoteListPresentation.js";

/**
 * Lee una página de cotizaciones traduciendo el intervalo de días elegido a instantes de la API.
 * Los días viajan en los filtros de la lista para que cambiarlos reinicie el cursor como
 * cualquier otro filtro.
 *
 * @param {Object} query - Consulta de useCursorSearchList.
 * @returns {Promise<{quotes: Array<Object>, nextCursor: string|null}>} Página.
 */
function fetchQuotesPage({ dateFrom, dateTo, ...query }) {
  return api.quotes.listQuotes({ ...query, ...toCreatedRange({ dateFrom, dateTo }) });
}

/**
 * Listado de cotizaciones (Figma 5771:488497) sobre la lista compartida del módulo: búsqueda en
 * la API (código, cliente o proyecto), intervalo de fechas, orden por N° o Total y paginación por
 * cursor. Cambiar la búsqueda, el intervalo o el orden vuelve a la primera página; «Quitar
 * filtros» restaura la consulta inicial, incluido el orden por defecto.
 *
 * @returns {Object} Lista, orden e intervalo aplicados, si hay búsqueda o intervalo, y sus acciones.
 */
export function useQuotesList() {
  const list = useCursorSearchList({
    collectionKey: "quotes",
    errorMessage: "No se pudo cargar el listado de cotizaciones.",
    fetchPage: fetchQuotesPage,
    pageSize: QUOTES_PAGE_SIZE,
  });
  const { filters, search } = list;
  const sort = { direction: filters.direction ?? DEFAULT_QUOTE_SORT.direction, sort: filters.sort ?? DEFAULT_QUOTE_SORT.sort };

  return {
    ...list,
    dateRange: { from: filters.dateFrom ?? null, to: filters.dateTo ?? null },
    hasFilters: Boolean(search.query.trim() || filters.dateFrom),
    setDateRange: (range) => {
      list.setFilter("dateFrom", range?.from ?? null);
      list.setFilter("dateTo", range?.to ?? null);
    },
    sort,
    toggleSort: (field) => {
      const next = toggleQuoteSort(sort, field);
      list.setFilter("sort", next.sort);
      list.setFilter("direction", next.direction);
    },
  };
}
