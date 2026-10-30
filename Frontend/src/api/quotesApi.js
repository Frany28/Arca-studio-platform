import { apiRequest, apiRequestBlob, getApiUrl, toQueryString } from "./client.js";

// Cotizaciones administrativas (docs/API_CONTRACT.md, «Cotizaciones»). Los importes llegan como
// texto decimal y no deben convertirse a Number; el servidor calcula y guarda los definitivos.

/**
 * Añade la URL autenticada de la foto de un usuario cuando la API indica que existe. Se
 * reutiliza la ruta administrativa de fotos de perfil.
 *
 * @param {{id: number, hasProfilePhoto?: boolean}|null} user - Usuario devuelto por la API.
 * @returns {string} URL de la foto o cadena vacía.
 */
function getAdminUserPhotoUrl(user) {
  return user?.hasProfilePhoto ? getApiUrl(`/admin/users/${encodeURIComponent(user.id)}/profile-photo`) : "";
}

/**
 * Completa una cotización con la foto del autor de su versión vigente, que muestra el visor.
 *
 * @param {Object|null} quote - Cotización de la API.
 * @returns {Object|null} Cotización con `version.createdBy.profilePhotoUrl`.
 */
function withVersionAuthorPhoto(quote) {
  if (!quote?.version?.createdBy) return quote;
  const createdBy = { ...quote.version.createdBy, profilePhotoUrl: getAdminUserPhotoUrl(quote.version.createdBy) };
  return { ...quote, version: { ...quote.version, createdBy } };
}

export const quotesApi = {
  /**
   * Lee una página del listado con búsqueda, intervalo de fechas y orden. `createdFrom` es
   * inclusivo y `createdBefore` exclusivo (instantes ISO calculados con el día local).
   *
   * @param {Object} [options] - Cursor, filtros, orden y cancelación.
   * @param {string|null} [options.cursor] - Cursor opaco de la página anterior.
   * @param {number} [options.limit] - Tamaño de página.
   * @param {string} [options.search] - Código, cliente o proyecto.
   * @param {string} [options.createdFrom] - Instante inicial.
   * @param {string} [options.createdBefore] - Instante final excluido.
   * @param {"code"|"total"} [options.sort] - Campo de orden.
   * @param {"asc"|"desc"} [options.direction] - Dirección.
   * @param {AbortSignal} [options.signal] - Cancela la petición.
   * @returns {Promise<{quotes: Array<Object>, nextCursor: string|null}>} Página.
   */
  listQuotes({ createdBefore, createdFrom, cursor, direction, limit, search, signal, sort } = {}) {
    const query = toQueryString({ createdBefore, createdFrom, cursor, direction, limit, search, sort });
    return apiRequest(`/admin/quotes${query}`, { signal });
  },

  /**
   * Lee los indicadores del módulo que dependen de las cotizaciones (total registrado).
   *
   * @param {Object} [options] - Cancelación.
   * @param {AbortSignal} [options.signal] - Cancela la petición.
   * @returns {Promise<{summary: {total: number}}>} Resumen.
   */
  getSummary({ signal } = {}) {
    return apiRequest("/admin/quotes/summary", { signal });
  },

  /**
   * Lee la tasa configurada del IVA referencial (informativo, no fiscal) para la vista previa del
   * formulario. Sin tasa configurada responde `enabled=false` y `rate=null`.
   *
   * @param {Object} [options] - Cancelación.
   * @param {AbortSignal} [options.signal] - Cancela la petición.
   * @returns {Promise<{referenceVat: {enabled: boolean, rate: string|null}}>} Tasa configurada.
   */
  getReferenceVat({ signal } = {}) {
    return apiRequest("/admin/quotes/reference-vat", { signal });
  },

  /**
   * Lee una cotización con su versión vigente (`currentVersion`) y sus conceptos.
   *
   * @param {Object} params - Cotización y cancelación.
   * @param {number} params.quoteId - Cotización.
   * @param {AbortSignal} [params.signal] - Cancela la petición.
   * @returns {Promise<{quote: Object}>} Cotización.
   */
  async getQuote({ quoteId, signal }) {
    const payload = await apiRequest(`/admin/quotes/${encodeURIComponent(quoteId)}`, { signal });
    return { ...payload, quote: withVersionAuthorPhoto(payload?.quote) };
  },

  /**
   * Crea una cotización. El sistema genera el código (`COT-001`) y calcula los importes.
   *
   * @param {{clientId: number, projectId: number, notes: string|null, items: Array<Object>}} payload - Contenido.
   * @returns {Promise<{message: string, quote: Object}>} Cotización creada.
   */
  createQuote(payload) {
    return apiRequest("/admin/quotes", { body: JSON.stringify(payload), method: "POST" });
  },

  /**
   * Guarda una versión nueva con la versión leída (`expectedVersion`). Sin cambios efectivos el
   * backend responde `changed=false` y no crea versión.
   *
   * @param {Object} params - Cotización y contenido completo.
   * @param {number} params.quoteId - Cotización.
   * @param {Object} params.payload - Contenido con `expectedVersion`.
   * @returns {Promise<{changed: boolean, message: string, quote: Object}>} Resultado.
   */
  updateQuote({ payload, quoteId }) {
    return apiRequest(`/admin/quotes/${encodeURIComponent(quoteId)}`, { body: JSON.stringify(payload), method: "PATCH" });
  },

  /**
   * Busca clientes activos para asociarlos a la cotización, con la foto de su usuario de contacto.
   *
   * @param {Object} [options] - Búsqueda, paginación y cancelación.
   * @param {string} [options.search] - Nombre, empresa o correo.
   * @param {string|null} [options.cursor] - Cursor opaco.
   * @param {number} [options.limit] - Tamaño de página.
   * @param {AbortSignal} [options.signal] - Cancela la petición.
   * @returns {Promise<{clients: Array<Object>, nextCursor: string|null}>} Página de clientes.
   */
  async listClients({ cursor, limit, search, signal } = {}) {
    const payload = await apiRequest(`/admin/quotes/clients${toQueryString({ cursor, limit, search })}`, { signal });
    const clients = (payload?.clients || []).map((client) => ({ ...client, profilePhotoUrl: getAdminUserPhotoUrl(client.contactUser) }));
    return { ...payload, clients };
  },

  /**
   * Busca proyectos no eliminados de un cliente para asociarlos a la cotización.
   *
   * @param {Object} params - Cliente, búsqueda, paginación y cancelación.
   * @param {number} params.clientId - Cliente propietario.
   * @param {string} [params.search] - Nombre del proyecto.
   * @param {string|null} [params.cursor] - Cursor opaco.
   * @param {number} [params.limit] - Tamaño de página.
   * @param {AbortSignal} [params.signal] - Cancela la petición.
   * @returns {Promise<{projects: Array<Object>, nextCursor: string|null}>} Página de proyectos.
   */
  listClientProjects({ clientId, cursor, limit, search, signal }) {
    return apiRequest(`/admin/quotes/clients/${encodeURIComponent(clientId)}/projects${toQueryString({ cursor, limit, search })}`, { signal });
  },

  /**
   * Descarga el PDF de la versión vigente. La zona horaria del navegador fija la fecha impresa,
   * la misma que muestra el listado; el navegador reutiliza su copia con ETag si no cambió.
   *
   * @param {Object} params - Cotización y cancelación.
   * @param {number} params.quoteId - Cotización.
   * @param {string} [params.timeZone] - Zona horaria IANA.
   * @param {AbortSignal} [params.signal] - Cancela la descarga.
   * @returns {Promise<Blob>} Documento PDF.
   */
  getQuotePdf({ quoteId, signal, timeZone }) {
    return apiRequestBlob(`/admin/quotes/${encodeURIComponent(quoteId)}/pdf${toQueryString({ timeZone })}`, { signal });
  },
};
