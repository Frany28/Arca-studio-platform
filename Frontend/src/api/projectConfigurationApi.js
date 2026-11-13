import { apiRequest, toQueryString, uploadRawFile } from "./client.js";

/**
 * Ruta base de la configuración administrativa de un proyecto.
 *
 * @param {number|string} projectId - Proyecto.
 * @returns {string} Ruta `/admin/projects/:id/configuration`.
 */
function configurationPath(projectId) {
  return `/admin/projects/${encodeURIComponent(projectId)}/configuration`;
}

/**
 * Acceso HTTP a la configuración de proyectos draft (solo administradores): lectura, guardado por
 * sección, finalización (draft → pending), carpetas y archivos del borrador, y registro del primer
 * contacto de una solicitud aprobada. Sin lógica de presentación.
 */
export const projectConfigurationApi = {
  createDraft({ clientId, name }) {
    return apiRequest("/admin/projects/drafts", { body: JSON.stringify({ clientId, name }), method: "POST" });
  },

  get({ projectId, signal }) {
    return apiRequest(configurationPath(projectId), { signal });
  },

  saveGeneral({ payload, projectId }) {
    return apiRequest(`${configurationPath(projectId)}/general`, { body: JSON.stringify(payload), method: "PUT" });
  },

  saveTracking({ payload, projectId }) {
    return apiRequest(`${configurationPath(projectId)}/tracking`, { body: JSON.stringify(payload), method: "PUT" });
  },

  saveWarranties({ payload, projectId }) {
    return apiRequest(`${configurationPath(projectId)}/warranties`, { body: JSON.stringify(payload), method: "PUT" });
  },

  finalize({ projectId }) {
    return apiRequest(`${configurationPath(projectId)}/finalize`, { method: "POST" });
  },

  listFiles({ projectId, signal }) {
    return apiRequest(`${configurationPath(projectId)}/files`, { signal });
  },

  uploadFile({ file, folderId, onUploadProgress, projectId, signal }) {
    return uploadRawFile({
      file,
      onUploadProgress,
      path: `${configurationPath(projectId)}/files${toQueryString({ folderId: folderId ?? undefined })}`,
      signal,
    });
  },

  moveFile({ fileId, folderId, projectId }) {
    return apiRequest(`${configurationPath(projectId)}/files/${encodeURIComponent(fileId)}`, {
      body: JSON.stringify({ folderId }),
      method: "PATCH",
    });
  },

  createFolder({ name, parentId, projectId }) {
    return apiRequest(`${configurationPath(projectId)}/folders`, { body: JSON.stringify({ name, parentId }), method: "POST" });
  },

  renameFolder({ folderId, name, projectId }) {
    return apiRequest(`${configurationPath(projectId)}/folders/${encodeURIComponent(folderId)}`, {
      body: JSON.stringify({ name }),
      method: "PATCH",
    });
  },

  deleteFolder({ folderId, projectId }) {
    return apiRequest(`${configurationPath(projectId)}/folders/${encodeURIComponent(folderId)}`, { method: "DELETE" });
  },

  recordFirstContact({ projectRequestId }) {
    return apiRequest(`/admin/project-requests/${encodeURIComponent(projectRequestId)}/first-contact`, { method: "POST" });
  },
};
