/* Centraliza la comunicación HTTP del frontend con la API y adapta respuestas para la interfaz. */
import { adminApi } from "./adminApi.js";
import { authApi } from "./authApi.js";
import { projectsApi } from "./projectsApi.js";
import {
  apiRequest,
  collectCursorPages,
  getApiUrl,
  uploadRawFile,
} from "./client.js";

export { adminApi } from "./adminApi.js";
export { authApi } from "./authApi.js";
export { getApiUrl } from "./client.js";
export { projectsApi } from "./projectsApi.js";

// Endpoints de comentarios generales del entorno colaborativo.
export const environmentCommentsApi = {
  list({ cursor, limit } = {}) {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    if (limit) params.set("limit", String(limit));
    const query = params.toString();
    return apiRequest(`/environment-comments${query ? `?${query}` : ""}`);
  },

  listAll() {
    return collectCursorPages(
      (page) => environmentCommentsApi.list(page),
      "comments",
    );
  },

  create({ content, parentCommentId = null }) {
    return apiRequest("/environment-comments", {
      body: JSON.stringify({ content, parentCommentId }),
      method: "POST",
    });
  },
};

// Endpoints para crear, revisar, actualizar y adjuntar archivos a solicitudes de proyecto.
export const projectRequestsApi = {
  list({ cursor, limit = 25 } = {}) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return apiRequest(`/project-requests?${params.toString()}`);
  },

  create(payload) {
    return apiRequest("/project-requests", {
      body: JSON.stringify(payload),
      method: "POST",
    });
  },

  listReviewQueue({ cursor, limit = 25 } = {}) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return apiRequest(`/project-requests/review-queue?${params.toString()}`);
  },

  getFileContentUrl({ fileId, projectRequestId }) {
    return getApiUrl(
      `/project-requests/${encodeURIComponent(projectRequestId)}/files/${encodeURIComponent(fileId)}/content`,
    );
  },

  review({ note, projectRequestId, recommendation }) {
    return apiRequest(`/project-requests/${projectRequestId}/review`, {
      body: JSON.stringify({ note, recommendation }),
      method: "PUT",
    });
  },

  update({ payload, projectRequestId }) {
    return apiRequest(`/project-requests/${projectRequestId}`, {
      body: JSON.stringify(payload),
      method: "PATCH",
    });
  },

  submit(projectRequestId) {
    return apiRequest(`/project-requests/${projectRequestId}/submit`, {
      body: JSON.stringify({}),
      method: "POST",
    });
  },

  deleteFile({ fileId, projectRequestId }) {
    return apiRequest(`/project-requests/${projectRequestId}/files/${fileId}`, {
      method: "DELETE",
    });
  },

  uploadFile({ file, onUploadProgress, projectRequestId, signal }) {
    return uploadRawFile({
      file,
      onUploadProgress,
      path: `/project-requests/${projectRequestId}/files`,
      signal,
    });
  },
};

// Endpoints para solicitudes de soporte y sus archivos adjuntos.
export const supportApi = {
  createRequest({ description, issueType, subject }) {
    return apiRequest("/support/requests", {
      body: JSON.stringify({ description, issueType, subject }),
      method: "POST",
    });
  },

  uploadFile({ file, onUploadProgress, signal, supportRequestId }) {
    return uploadRawFile({
      file,
      onUploadProgress,
      path: `/support/requests/${supportRequestId}/files`,
      signal,
    });
  },
};

// Fachada única que agrupa todos los módulos de acceso a la API.
export const api = {
  admin: adminApi,
  auth: authApi,
  environmentComments: environmentCommentsApi,
  projectRequests: projectRequestsApi,
  projects: projectsApi,
  support: supportApi,
};
