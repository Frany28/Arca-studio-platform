import { apiRequest, collectCursorPages } from "./client.js";

// Catálogo administrativo de servicios (docs/API_CONTRACT.md, "Catálogo de servicios").
// En esta fase el frontend solo lo lee para los indicadores del módulo.
export const serviceCatalogApi = {
  /**
   * Lee una página del catálogo de servicios, incluidos los inactivos salvo filtro.
   *
   * @param {Object} [options] - Cursor, tamaño y cancelación.
   * @param {string|null} [options.cursor] - Cursor opaco de la página anterior.
   * @param {number} [options.limit=100] - Tamaño de página (máximo del contrato).
   * @param {AbortSignal} [options.signal] - Cancela la petición.
   * @returns {Promise<{services: Array<Object>, nextCursor: string|null}>} Página.
   */
  listServices({ cursor, limit = 100, signal } = {}) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return apiRequest(`/admin/services?${params}`, { signal });
  },

  /**
   * Recorre todas las páginas del catálogo. El contrato no ofrece totales, y el tabulador es
   * un catálogo acotado, así que los indicadores se derivan de la colección completa real.
   *
   * @param {Object} [options] - Cancelación.
   * @param {AbortSignal} [options.signal] - Cancela todas las páginas pendientes.
   * @returns {Promise<{services: Array<Object>, nextCursor: null}>} Colección completa sin duplicados.
   */
  listAllServices({ signal } = {}) {
    return collectCursorPages(({ cursor, limit }) => serviceCatalogApi.listServices({ cursor, limit, signal }), "services");
  },
};
