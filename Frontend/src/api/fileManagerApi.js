import { apiRequest, apiRequestFile, getApiUrl, toQueryString, uploadRawFile } from "./client.js";

// Administrador de archivos (docs/API_CONTRACT.md, «Administrador de archivos (Fase 1.2, B7)»).
// Solo para administradores y con PROJECT_FILE_REVIEW_ENABLED: con la activación apagada todas las
// rutas responden 404 API_ROUTE_NOT_FOUND, que la pantalla presenta como función no disponible.
export const fileManagerApi = {
  /**
   * Lee las métricas de todo el administrador, de un proyecto o de una carpeta con sus subcarpetas.
   *
   * @param {Object} [options] - Ámbito y cancelación.
   * @param {number} [options.projectId] - Proyecto.
   * @param {number} [options.folderId] - Carpeta (exige proyecto).
   * @param {AbortSignal} [options.signal] - Cancela la petición.
   * @returns {Promise<{metrics: {totalFiles: number, usedBytes: number, objectCount: number, lastUploadAt: string|null}}>} Métricas.
   */
  getMetrics({ folderId, projectId, signal } = {}) {
    return apiRequest(`/admin/files/metrics${toQueryString({ folderId, projectId })}`, { signal });
  },

  /**
   * Lee una página del árbol: proyectos con su cliente y sus carpetas en preorden con nombres visibles.
   *
   * @param {Object} [options] - Página y búsqueda.
   * @param {string|null} [options.cursor] - Cursor de la página anterior.
   * @param {number} [options.limit] - Proyectos por página (1–100).
   * @param {string} [options.search] - Texto en el nombre del proyecto o del cliente.
   * @param {AbortSignal} [options.signal] - Cancela la petición.
   * @returns {Promise<{projects: Array<Object>, nextCursor: string|null}>} Página.
   */
  getTree({ cursor, limit, search, signal } = {}) {
    return apiRequest(`/admin/files/tree${toQueryString({ cursor, limit, search })}`, { signal });
  },

  /**
   * Busca carpetas por su nombre visible, con su ruta legible.
   *
   * @param {Object} options - Búsqueda y página.
   * @param {string} options.search - Texto buscado.
   * @param {string|null} [options.cursor] - Cursor de la página anterior.
   * @param {number} [options.limit] - Resultados por página.
   * @param {AbortSignal} [options.signal] - Cancela la petición.
   * @returns {Promise<{folders: Array<Object>, nextCursor: string|null}>} Página.
   */
  searchFolders({ cursor, limit, search, signal }) {
    return apiRequest(`/admin/files/folders${toQueryString({ cursor, limit, search })}`, { signal });
  },

  /**
   * Lee una página de una pestaña (aprobados, pendientes o rechazados) con filtros y orden.
   *
   * @param {Object} options - Pestaña, ámbito, filtros, orden y página.
   * @param {"approved"|"pending"|"rejected"} options.tab - Pestaña.
   * @param {string[]} [options.extensions] - Extensiones (`pdf`, `png`...).
   * @param {AbortSignal} [options.signal] - Cancela la petición.
   * @returns {Promise<{items: Array<Object>, nextCursor: string|null}>} Página.
   */
  listItems({ cursor, extensions, folderId, includeSubfolders, limit, order, projectId, search, signal, sort, tab }) {
    const query = toQueryString({
      cursor,
      extensions: extensions?.length ? extensions.join(",") : undefined,
      folderId,
      includeSubfolders: folderId && includeSubfolders ? "true" : undefined,
      limit,
      order,
      projectId,
      search,
      sort,
      tab,
    });
    return apiRequest(`/admin/files/items${query}`, { signal });
  },

  /**
   * Crea una carpeta personalizada dentro de otra carpeta del proyecto.
   *
   * @param {{ projectId: number, parentId: number, name: string }} payload - Carpeta.
   * @returns {Promise<{folder: Object, folders: Array<Object>}>} Carpeta creada y árbol del proyecto.
   */
  createFolder({ name, parentId, projectId }) {
    return apiRequest(`/admin/files/projects/${encodeURIComponent(projectId)}/folders`, {
      body: JSON.stringify({ name, parentId }),
      method: "POST",
    });
  },

  /**
   * Renombra una carpeta personalizada.
   *
   * @param {{ projectId: number, folderId: number, name: string }} payload - Carpeta y nombre.
   * @returns {Promise<{folders: Array<Object>}>} Árbol del proyecto.
   */
  renameFolder({ folderId, name, projectId }) {
    return apiRequest(`/admin/files/projects/${encodeURIComponent(projectId)}/folders/${encodeURIComponent(folderId)}`, {
      body: JSON.stringify({ name }),
      method: "PATCH",
    });
  },

  /**
   * Retira una carpeta personalizada vacía (borrado lógico); nunca afecta a archivos.
   *
   * @param {{ projectId: number, folderId: number }} payload - Carpeta.
   * @returns {Promise<{folders: Array<Object>}>} Árbol del proyecto.
   */
  deleteFolder({ folderId, projectId }) {
    return apiRequest(`/admin/files/projects/${encodeURIComponent(projectId)}/folders/${encodeURIComponent(folderId)}`, { method: "DELETE" });
  },

  /**
   * Descarga una versión concreta de un archivo de proyecto con el nombre que indica el servidor.
   *
   * @param {{ projectId: number, fileId: number, versionId: number, signal?: AbortSignal }} options - Versión.
   * @returns {Promise<{blob: Blob, fileName: string|null}>} Contenido y nombre.
   */
  downloadVersion({ fileId, projectId, signal, versionId }) {
    return apiRequestFile(versionPath({ fileId, projectId }, `/content${toQueryString({ versionId })}`), { signal });
  },

  /**
   * URL del contenido de una versión para los visores que cargan por `src` (imagen, vídeo y
   * panorámica). La sesión viaja en la cookie, como en el resto de visores del proyecto.
   *
   * @param {{ projectId: number, fileId: number, versionId: number }} version - Versión.
   * @returns {string} URL absoluta de la API.
   */
  getVersionContentUrl({ fileId, projectId, versionId }) {
    return getApiUrl(versionPath({ fileId, projectId }, `/content${toQueryString({ versionId })}`));
  },

  /**
   * Lee una página del historial de versiones (de la más reciente a la más antigua).
   *
   * @param {Object} options - Archivo, página y cancelación.
   * @param {number} options.projectId - Proyecto.
   * @param {number} options.fileId - Archivo.
   * @param {string|null} [options.cursor] - Cursor de la página anterior.
   * @param {number} [options.limit] - Versiones por página (1–100).
   * @param {AbortSignal} [options.signal] - Cancela la petición.
   * @returns {Promise<{currentVersionId: number|null, versions: Array<Object>, nextCursor: string|null}>} Página.
   */
  listVersions({ cursor, fileId, limit, projectId, signal }) {
    return apiRequest(versionPath({ fileId, projectId }, `/versions${toQueryString({ cursor, limit })}`), { signal });
  },

  /**
   * Aprueba una versión pendiente: pasa a ser la vigente y no se comparte con el cliente.
   *
   * @param {{ projectId: number, fileId: number, versionId: number }} version - Versión.
   * @returns {Promise<{version: Object, currentVersionId: number|null, sharedWithClient: boolean}>} Resultado confirmado.
   */
  approveVersion({ fileId, projectId, versionId }) {
    return apiRequest(versionPath({ fileId, projectId }, `/versions/${encodeURIComponent(versionId)}/approve`), { method: "POST" });
  },

  /**
   * Rechaza una versión pendiente con su motivo; la vigente no cambia y la rechazada se conserva.
   *
   * @param {{ projectId: number, fileId: number, versionId: number, reason: string }} payload - Versión y motivo.
   * @returns {Promise<{version: Object, currentVersionId: number|null, sharedWithClient: boolean}>} Resultado confirmado.
   */
  rejectVersion({ fileId, projectId, reason, versionId }) {
    return apiRequest(versionPath({ fileId, projectId }, `/versions/${encodeURIComponent(versionId)}/reject`), {
      body: JSON.stringify({ reason }),
      method: "POST",
    });
  },

  /**
   * Restaura una versión aprobada como versión nueva pendiente de revisión, con su motivo.
   *
   * @param {{ projectId: number, fileId: number, versionId: number, changeNote: string }} payload - Origen y motivo.
   * @returns {Promise<{version: Object}>} Versión nueva pendiente.
   */
  restoreVersion({ changeNote, fileId, projectId, versionId }) {
    return apiRequest(versionPath({ fileId, projectId }, `/versions/${encodeURIComponent(versionId)}/restore`), {
      body: JSON.stringify({ changeNote }),
      method: "POST",
    });
  },

  /**
   * Sube un archivo nuevo a una carpeta del proyecto (U3). La v1 nace pendiente de revisión.
   *
   * @param {Object} options - Destino, archivo y seguimiento.
   * @param {number} options.projectId - Proyecto.
   * @param {number} options.folderId - Carpeta destino (obligatoria).
   * @param {File} options.file - Archivo.
   * @param {(progress: {loaded: number, total: number, progress: number}) => void} [options.onUploadProgress] - Progreso.
   * @param {AbortSignal} [options.signal] - Cancela la transferencia.
   * @returns {Promise<{file: Object}>} Archivo registrado (`id`, `versionId`, `reviewStatus`).
   */
  uploadFile({ file, folderId, onUploadProgress, projectId, signal }) {
    return uploadRawFile({ file, onUploadProgress, path: `/admin/files/projects/${encodeURIComponent(projectId)}/files${toQueryString({ folderId })}`, signal });
  },

  /**
   * Sube una versión nueva de un archivo (B4) con su motivo obligatorio; queda pendiente de revisión.
   *
   * @param {Object} options - Archivo, motivo y seguimiento.
   * @param {number} options.projectId - Proyecto.
   * @param {number} options.fileId - Archivo.
   * @param {File} options.file - Contenido de la versión nueva.
   * @param {string} options.changeNote - Motivo del cambio (≤255).
   * @param {Function} [options.onUploadProgress] - Progreso.
   * @param {AbortSignal} [options.signal] - Cancela la transferencia.
   * @returns {Promise<{version: Object}>} Versión creada.
   */
  replaceVersion({ changeNote, file, fileId, onUploadProgress, projectId, signal }) {
    return uploadRawFile({
      file,
      headers: { "X-Change-Note": encodeURIComponent(changeNote) },
      onUploadProgress,
      path: versionPath({ fileId, projectId }, "/versions"),
      signal,
    });
  },

  /**
   * Lee las garantías vigentes del proyecto con sus documentos vinculados (B8).
   *
   * @param {{ projectId: number, signal?: AbortSignal }} options - Proyecto y cancelación.
   * @returns {Promise<{warranties: Array<Object>}>} Garantías.
   */
  listWarranties({ projectId, signal }) {
    return apiRequest(`/projects/${encodeURIComponent(projectId)}/warranties`, { signal });
  },

  /**
   * Vincula un documento a una garantía; repetirlo no cambia nada (`changed:false`).
   *
   * @param {{ projectId: number, warrantyId: number, fileId: number }} link - Vínculo.
   * @returns {Promise<{warrantyId: number, fileId: number, changed: boolean, linkedWarrantyIds: number[]}>} Resultado.
   */
  linkWarrantyDocument({ fileId, projectId, warrantyId }) {
    return apiRequest(warrantyDocumentPath({ fileId, projectId, warrantyId }), { method: "PUT" });
  },

  /**
   * Desvincula un documento de una garantía; el vínculo queda como historial y el archivo no cambia.
   *
   * @param {{ projectId: number, warrantyId: number, fileId: number }} link - Vínculo.
   * @returns {Promise<{warrantyId: number, fileId: number, changed: boolean, linkedWarrantyIds: number[]}>} Resultado.
   */
  unlinkWarrantyDocument({ fileId, projectId, warrantyId }) {
    return apiRequest(warrantyDocumentPath({ fileId, projectId, warrantyId }), { method: "DELETE" });
  },
};

/**
 * Ruta de un archivo de proyecto con un sufijo (`/content`, `/versions`...).
 *
 * @param {{ projectId: number, fileId: number }} file - Archivo.
 * @param {string} suffix - Sufijo con su consulta.
 * @returns {string} Ruta relativa a la API.
 */
function versionPath({ fileId, projectId }, suffix) {
  return `/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}${suffix}`;
}

/**
 * Ruta del vínculo entre un documento y una garantía (rutas del administrador, B8).
 *
 * @param {{ projectId: number, warrantyId: number, fileId: number }} link - Vínculo.
 * @returns {string} Ruta relativa a la API.
 */
function warrantyDocumentPath({ fileId, projectId, warrantyId }) {
  return `/admin/files/projects/${encodeURIComponent(projectId)}/warranties/${encodeURIComponent(warrantyId)}/documents/${encodeURIComponent(fileId)}`;
}
