import { getApiUrl, apiRequest } from "./client.js";
import { uploadRawFile } from "./fileUploadClient.js";

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

  uploadFile({
    file,
    onUploadProgress,
    projectRequestId,
    signal,
  }) {
    return uploadRawFile({
      file,
      onUploadProgress,
      path: `/project-requests/${projectRequestId}/files`,
      signal,
    });
  },
};
