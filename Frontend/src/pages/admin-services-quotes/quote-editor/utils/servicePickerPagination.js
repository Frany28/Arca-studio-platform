/** Filas por página de «Seleccionar servicios», como el tabulador, Unidades y Cotizaciones. */
export const SERVICE_PICKER_PAGE_SIZE = 10;

/**
 * Página visible de «Seleccionar servicios». El selector tiene todos los servicios activos en
 * memoria (busca sobre todos y alimenta el menú de cambio de servicio), así que pagina en local.
 * Si la lista se reduce (búsqueda, servicios añadidos), la página pedida se ajusta a la última
 * existente en lugar de quedar vacía.
 *
 * @param {Object} options - Datos de la página.
 * @param {Array<Object>} options.items - Servicios visibles tras la búsqueda.
 * @param {number} options.pageIndex - Página pedida (0 = primera).
 * @param {number} [options.pageSize] - Filas por página.
 * @returns {{ items: Array<Object>, pageIndex: number, hasPrevious: boolean, hasNext: boolean }} Página ajustada.
 */
export function getServicePickerPage({ items, pageIndex, pageSize = SERVICE_PICKER_PAGE_SIZE }) {
  const lastPage = Math.max(0, Math.ceil(items.length / pageSize) - 1);
  const page = Math.min(Math.max(pageIndex, 0), lastPage);
  return {
    hasNext: page < lastPage,
    hasPrevious: page > 0,
    items: items.slice(page * pageSize, (page + 1) * pageSize),
    pageIndex: page,
  };
}
