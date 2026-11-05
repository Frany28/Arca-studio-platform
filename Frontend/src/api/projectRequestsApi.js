import {
  apiRequest,
  getApiUrl,
  uploadRawFile,
} from "./client.js";

// Endpoints para crear, revisar, actualizar y adjuntar archivos a solicitudes de proyecto.
export const projectRequestsApi = {
  list({ cursor, limit = 25 } = {}) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return apiRequest(`/project-requests?${params.toString()}`);
  },

  /**
   * Obtiene una solicitud propia del cliente con sus adjuntos persistidos (`files`).
   *
   * @param {number|string} projectRequestId - Solicitud a consultar.
   * @param {Object} [options] - Opciones de la petición.
   * @param {AbortSignal} [options.signal] - Cancela la lectura al cambiar de vista o desmontar.
   * @returns {Promise<{projectRequest: Object}>} Solicitud con estado actual y adjuntos.
   */
  get(projectRequestId, { signal } = {}) {
    return apiRequest(`/project-requests/${encodeURIComponent(projectRequestId)}`, { signal });
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

  /**
   * Guarda la reunión como dato complementario de la revisión técnica.
   * undefined omite el campo para conservar contratos antiguos; null lo elimina explícitamente.
   *
   * @param {Object} values - ID, workflow, justificación y reunión opcional.
   * @returns {Promise<Object|null>} Revisión confirmada por el backend.
   */
  review({ meetingRecommendation, note, projectRequestId, recommendation }) {
    return apiRequest(`/project-requests/${projectRequestId}/review`, {
      body: JSON.stringify({ meetingRecommendation, note, recommendation }),
      method: "PUT",
    });
  },

  update({ payload, projectRequestId }) {
    return apiRequest(`/project-requests/${projectRequestId}`, {
      body: JSON.stringify(payload),
      method: "PATCH",
    });
  },

  /**
   * Pide al backend un código de validación para enviar el borrador; llega al correo del cliente.
   *
   * @param {number|string} projectRequestId - Borrador que se va a enviar.
   * @returns {Promise<{verification: {expiresAt: string, resendAvailableAt: string}}>} Vencimiento y próximo reenvío.
   */
  requestVerificationCode(projectRequestId) {
    return apiRequest(`/project-requests/${projectRequestId}/verification-code`, {
      body: JSON.stringify({}),
      method: "POST",
    });
  },

  /**
   * Envía la solicitud con el código recibido; el backend lo verifica y lo consume.
   *
   * @param {number|string} projectRequestId - Borrador que se envía.
   * @param {string} verificationCode - Código de seis dígitos.
   * @returns {Promise<{projectRequest: Object}>} Solicitud enviada.
   */
  submit(projectRequestId, verificationCode) {
    return apiRequest(`/project-requests/${projectRequestId}/submit`, {
      body: JSON.stringify({ verificationCode }),
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
