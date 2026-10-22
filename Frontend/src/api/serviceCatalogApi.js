import { apiRequest, collectCursorPages, toQueryString } from "./client.js";

// Catálogo administrativo de servicios (docs/API_CONTRACT.md, "Catálogo de servicios").
// El tabulador lo lee con búsqueda y filtros y cambia el estado de cada servicio; los servicios
// nunca se eliminan. `referenceRate` llega como texto decimal y no debe convertirse a Number.
export const serviceCatalogApi = {
  /**
   * Lee una página del catálogo, incluidos los inactivos salvo filtro de estado. Los filtros
   * vacíos no se envían para no pedir al backend validaciones sin efecto.
   *
   * @param {Object} [options] - Cursor, tamaño, filtros y cancelación.
   * @param {string|null} [options.cursor] - Cursor opaco de la página anterior.
   * @param {number} [options.limit=100] - Tamaño de página (máximo del contrato).
   * @param {string} [options.search] - Nombre o código, búsqueda literal (≤100 caracteres).
   * @param {"active"|"inactive"} [options.status] - Estado.
   * @param {number} [options.measurementUnitId] - Unidad base (incluye todas sus denominaciones).
   * @param {number} [options.unitDenominationId] - Denominación concreta.
   * @param {AbortSignal} [options.signal] - Cancela la petición.
   * @returns {Promise<{services: Array<Object>, nextCursor: string|null}>} Página.
   */
  listServices({ cursor, limit = 100, measurementUnitId, search, signal, status, unitDenominationId } = {}) {
    const query = toQueryString({ cursor, limit, measurementUnitId, search, status, unitDenominationId });
    return apiRequest(`/admin/services${query}`, { signal });
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

  /**
   * Activa o desactiva un servicio con la versión leída por el cliente (control optimista). El
   * cambio crea una versión nueva; reactivar exige que su unidad y su denominación estén activas.
   *
   * @param {Object} params - Servicio y estado solicitado.
   * @param {number} params.serviceId - Servicio afectado.
   * @param {number} params.expectedVersion - `currentVersion` leída en la tabla.
   * @param {boolean} params.isActive - Estado solicitado.
   * @returns {Promise<{changed: boolean, changedFields: Array<string>, message: string, service: Object}>} Resultado.
   */
  changeServiceStatus({ expectedVersion, isActive, serviceId }) {
    return apiRequest(`/admin/services/${encodeURIComponent(serviceId)}/status`, {
      body: JSON.stringify({ expectedVersion, isActive }),
      method: "PATCH",
    });
  },
};
