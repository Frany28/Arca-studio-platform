import { apiRequest, collectCursorPages, toQueryString } from "./client.js";

// Unidades de medida del módulo administrativo (docs/API_CONTRACT.md, "Unidades de medida").
// Las unidades base son de solo lectura; las denominaciones se crean, editan y desactivan.
// `publicCode` (UNID-001) lo genera PostgreSQL y nunca se envía en los cuerpos.
export const measurementUnitsApi = {
  /**
   * Lee el catálogo de unidades base (abreviatura, nombre y decimales) en orden de presentación.
   *
   * @param {Object} [options] - Opciones de la lectura.
   * @param {boolean} [options.includeInactive=false] - Incluye unidades base desactivadas.
   * @param {AbortSignal} [options.signal] - Cancela la petición.
   * @returns {Promise<{measurementUnits: Array<Object>}>} Unidades base.
   */
  listBaseUnits({ includeInactive = false, signal } = {}) {
    const query = toQueryString({ includeInactive: includeInactive ? "true" : undefined });
    return apiRequest(`/admin/measurement-units${query}`, { signal });
  },

  /**
   * Lee una página de denominaciones; la búsqueda cubre código público, texto y abreviatura.
   *
   * @param {Object} [options] - Filtros y cursor.
   * @param {string|null} [options.cursor] - Cursor opaco devuelto por la página anterior.
   * @param {number} [options.limit] - Tamaño de página (1–100).
   * @param {string} [options.search] - Texto literal de búsqueda.
   * @param {"active"|"inactive"} [options.status] - Filtra por estado.
   * @param {number} [options.measurementUnitId] - Solo denominaciones de esa unidad base.
   * @param {AbortSignal} [options.signal] - Cancela la petición.
   * @returns {Promise<{unitDenominations: Array<Object>, nextCursor: string|null}>} Página.
   */
  listDenominations({ cursor, limit, measurementUnitId, search, signal, status } = {}) {
    const query = toQueryString({ cursor, limit, measurementUnitId, search, status });
    return apiRequest(`/admin/measurement-unit-denominations${query}`, { signal });
  },

  /**
   * Recorre todas las páginas de denominaciones (sin duplicados), de una unidad base o de todas,
   * por ejemplo para ofrecerlas en el formulario de servicios. El contrato no ofrece totales.
   *
   * @param {Object} options - Filtros y cancelación.
   * @param {number} [options.measurementUnitId] - Solo esa unidad base; sin él, todas.
   * @param {"active"|"inactive"} [options.status] - Filtra por estado.
   * @param {AbortSignal} [options.signal] - Cancela todas las páginas pendientes.
   * @returns {Promise<{unitDenominations: Array<Object>, nextCursor: null}>} Colección completa.
   */
  listAllDenominations({ measurementUnitId, signal, status }) {
    return collectCursorPages(
      ({ cursor, limit }) => measurementUnitsApi.listDenominations({ cursor, limit, measurementUnitId, signal, status }),
      "unitDenominations",
    );
  },

  /**
   * Crea una denominación sobre una unidad base activa.
   *
   * @param {Object} payload - Cuerpo de la petición.
   * @param {number} payload.measurementUnitId - Unidad base elegida.
   * @param {string} payload.denomination - Texto personalizado ("de construcción").
   * @returns {Promise<{message: string, unitDenomination: Object}>} Denominación creada con su código.
   */
  createDenomination({ denomination, measurementUnitId }) {
    return apiRequest("/admin/measurement-unit-denominations", {
      body: JSON.stringify({ denomination, measurementUnitId }),
      method: "POST",
    });
  },

  /**
   * Cambia el texto de una denominación y, si se indica, su unidad base. El backend solo acepta
   * otra base mientras ningún servicio ni versión la referencie (409 MEASUREMENT_UNIT_BASE_IN_USE).
   *
   * @param {Object} params - Identificador, nuevo texto y base opcional.
   * @param {number} params.denominationId - Denominación editada.
   * @param {string} params.denomination - Nuevo texto.
   * @param {number} [params.measurementUnitId] - Nueva unidad base; se omite si no cambia.
   * @returns {Promise<{changed: boolean, message: string, unitDenomination: Object}>} Resultado.
   */
  updateDenomination({ denomination, denominationId, measurementUnitId }) {
    return apiRequest(`/admin/measurement-unit-denominations/${encodeURIComponent(denominationId)}`, {
      body: JSON.stringify(measurementUnitId === undefined ? { denomination } : { denomination, measurementUnitId }),
      method: "PATCH",
    });
  },

  /**
   * Activa o desactiva una denominación; nunca la elimina.
   *
   * @param {Object} params - Identificador y estado solicitado.
   * @param {number} params.denominationId - Denominación afectada.
   * @param {boolean} params.isActive - Estado solicitado.
   * @returns {Promise<{changed: boolean, message: string, unitDenomination: Object}>} Resultado.
   */
  changeDenominationStatus({ denominationId, isActive }) {
    return apiRequest(`/admin/measurement-unit-denominations/${encodeURIComponent(denominationId)}/status`, {
      body: JSON.stringify({ isActive }),
      method: "PATCH",
    });
  },
};
