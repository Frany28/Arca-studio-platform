/* Centraliza la comunicación HTTP del frontend con la API y adapta respuestas para la interfaz. */
import { authApi } from "./authApi.js";
import {
  apiRequest,
  collectCursorPages,
  getApiUrl,
  uploadRawFile,
} from "./client.js";

export { authApi } from "./authApi.js";
export { getApiUrl } from "./client.js";

// Añade URLs de avatar a los responsables devueltos por endpoints administrativos.
function withAdminAssigneeAvatars(payload) {
  const assignees = Array.isArray(payload?.assignees)
    ? payload.assignees.map((assignee) => ({
        ...assignee,
        profilePhotoUrl: assignee.hasProfilePhoto
          ? getApiUrl(
              `/admin/assignees/${encodeURIComponent(assignee.id)}/profile-photo`,
            )
          : "",
      }))
    : [];

  return { ...payload, assignees };
}

// Normaliza la URL de avatar de un usuario listado en administración.
function withAdminUserAvatar(listedUser) {
  if (!listedUser) return listedUser;

  return {
    ...listedUser,
    profilePhotoUrl: listedUser.hasProfilePhoto
      ? getApiUrl(
          `/admin/users/${encodeURIComponent(listedUser.id)}/profile-photo`,
        )
      : "",
  };
}

// Aplica la normalización de avatar a colecciones de usuarios administrativos.
function withAdminUserAvatars(payload) {
  const users = Array.isArray(payload?.users)
    ? payload.users.map(withAdminUserAvatar)
    : [];

  return { ...payload, users };
}

// Endpoints del panel administrativo: métricas, usuarios, roles, notas y asignaciones.
export const adminApi = {
  getDashboardMetrics({ signal } = {}) {
    return apiRequest("/admin/dashboard-metrics", { signal });
  },

  getDashboardOverview({ signal } = {}) {
    return apiRequest("/admin/dashboard-overview", { signal });
  },

  async listAssignees({ signal } = {}) {
    const payload = await apiRequest("/admin/assignees", { signal });
    return withAdminAssigneeAvatars(payload);
  },

  listRoles({ signal } = {}) {
    return apiRequest("/admin/roles", { signal });
  },

  async listUsers({ cursor, limit = 10, role, search, signal, status } = {}) {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    if (limit) params.set("limit", String(limit));
    if (role) params.set("role", Array.isArray(role) ? role.join(",") : role);
    if (search) params.set("search", search);
    if (status) params.set("status", Array.isArray(status) ? status.join(",") : status);
    const query = params.toString();

    const payload = await apiRequest(`/admin/users${query ? `?${query}` : ""}`, { signal });
    return withAdminUserAvatars(payload);
  },

  getUserDetails({ signal, userId }) {
    return apiRequest(`/admin/users/${encodeURIComponent(userId)}`, { signal });
  },

  listUserNotes({ cursor, limit = 25, signal, userId }) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return apiRequest(`/admin/users/${encodeURIComponent(userId)}/notes?${params.toString()}`, { signal });
  },

  createUserNote({ content, userId }) {
    return apiRequest(`/admin/users/${encodeURIComponent(userId)}/notes`, {
      body: JSON.stringify({ content }),
      method: "POST",
    });
  },

  updateUserNote({ content, noteId, userId }) {
    return apiRequest(`/admin/users/${encodeURIComponent(userId)}/notes/${encodeURIComponent(noteId)}`, {
      body: JSON.stringify({ content }),
      method: "PATCH",
    });
  },

  archiveUserNote({ noteId, userId }) {
    return apiRequest(`/admin/users/${encodeURIComponent(userId)}/notes/${encodeURIComponent(noteId)}/archive`, {
      method: "PATCH",
    });
  },

  createUser(payload) {
    return apiRequest("/admin/users", {
      body: JSON.stringify(payload),
      method: "POST",
    });
  },

  async updateUser({ payload, userId }) {
    const response = await apiRequest(`/admin/users/${encodeURIComponent(userId)}`, {
      body: JSON.stringify(payload),
      method: "PATCH",
    });
    return { ...response, user: withAdminUserAvatar(response?.user) };
  },

  async updateUserStatus({ status, userId }) {
    const payload = await apiRequest(`/admin/users/${encodeURIComponent(userId)}/status`, {
      body: JSON.stringify({ status }),
      method: "PATCH",
    });
    return { ...payload, user: withAdminUserAvatar(payload?.user) };
  },

  async updateProjectAssignees({ assigneeIds, projectId }) {
    const payload = await apiRequest(`/admin/projects/${encodeURIComponent(projectId)}/assignees`, {
      body: JSON.stringify({ assigneeIds }),
      method: "PUT",
    });
    return withAdminAssigneeAvatars(payload);
  },

  updateProjects({ action, isPublic, projectIds }) {
    return apiRequest("/admin/projects/bulk-action", {
      body: JSON.stringify({ action, isPublic, projectIds }),
      method: "PATCH",
    });
  },

  async updateProjectRequestAssignees({ assigneeIds, projectRequestId }) {
    const payload = await apiRequest(
      `/admin/project-requests/${encodeURIComponent(projectRequestId)}/assignees`,
      {
        body: JSON.stringify({ assigneeIds }),
        method: "PUT",
      },
    );
    return withAdminAssigneeAvatars(payload);
  },

  decideProjectRequest({ action, internalNotes, projectRequestId, reason }) {
    return apiRequest(
      `/admin/project-requests/${encodeURIComponent(projectRequestId)}/decision`,
      {
        body: JSON.stringify({ action, internalNotes, reason }),
        method: "PATCH",
      },
    );
  },
};

// Endpoints de proyectos, archivos, comentarios, publicación y eventos en tiempo real.
export const projectsApi = {
  list({ cursor, limit, scope } = {}) {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    if (limit) params.set("limit", String(limit));
    if (scope) params.set("scope", scope);
    const query = params.toString();
    return apiRequest(`/projects${query ? `?${query}` : ""}`);
  },

  listAll() {
    return collectCursorPages((page) => projectsApi.list(page), "projects");
  },

  getById({ filesCursor, filesLimit, projectId }) {
    const params = new URLSearchParams();
    if (filesCursor) params.set("filesCursor", filesCursor);
    if (filesLimit) params.set("filesLimit", String(filesLimit));
    const query = params.toString();
    return apiRequest(`/projects/${encodeURIComponent(projectId)}${query ? `?${query}` : ""}`);
  },

  async getByIdAllFiles({ projectId }) {
    let cursor = null;
    let project = null;
    const files = [];
    const ids = new Set();
    do {
      const data = await projectsApi.getById({ filesCursor: cursor, filesLimit: 100, projectId });
      project ||= data.project;
      for (const file of data.project?.files || []) {
        const key = String(file.id);
        if (!ids.has(key)) { ids.add(key); files.push(file); }
      }
      cursor = data.project?.filesNextCursor || null;
    } while (cursor);
    return { project: { ...project, files, filesNextCursor: null } };
  },

  listComments({ cursor, limit, projectId }) {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    if (limit) params.set("limit", String(limit));
    const query = params.toString();
    return apiRequest(`/projects/${projectId}/comments${query ? `?${query}` : ""}`);
  },

  listAllComments({ projectId }) {
    return collectCursorPages((page) => projectsApi.listComments({ ...page, projectId }), "comments");
  },

  subscribeToEvents({ projectId, onCommentCreated, onError }) {
    const eventSource = new EventSource(
      getApiUrl(`/projects/${projectId}/events`),
      { withCredentials: true },
    );

    eventSource.addEventListener("project.comment.created", (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data?.comment) {
          onCommentCreated?.(data.comment);
        }
      } catch {
        // Ignore malformed realtime events and keep the stream open.
      }
    });

    eventSource.onerror = (event) => {
      onError?.(event);
    };

    return () => {
      eventSource.close();
    };
  },

  createComment({
    commentType,
    content,
    fileId,
    fileVersionId,
    image,
    parentCommentId = null,
    projectId,
    selection,
    targetId,
  }) {
    return apiRequest(`/projects/${projectId}/comments`, {
      body: JSON.stringify({
        commentType,
        content,
        fileId,
        fileVersionId,
        image,
        parentCommentId,
        selection,
        targetId,
      }),
      method: "POST",
    });
  },

  listDocumentComments({ cursor, fileId, fileVersionId, limit, projectId }) {
    const params = new URLSearchParams({ fileVersionId: String(fileVersionId) });
    if (cursor) params.set("cursor", cursor);
    if (limit) params.set("limit", String(limit));
    return apiRequest(
      `/projects/${projectId}/files/${fileId}/comments?${params.toString()}`,
    );
  },

  listAllDocumentComments({ fileId, fileVersionId, projectId }) {
    return collectCursorPages(
      (page) => projectsApi.listDocumentComments({
        ...page,
        fileId,
        fileVersionId,
        projectId,
      }),
      "comments",
    );
  },

  getFileContentUrl({ fileId, projectId, versionId }) {
    const params = new URLSearchParams();
    if (versionId) params.set("versionId", String(versionId));
    const query = params.toString();
    return getApiUrl(
      `/projects/${projectId}/files/${fileId}/content${query ? `?${query}` : ""}`,
    );
  },

  updatePublication({ projectId, isPublic }) {
    return apiRequest(`/projects/${projectId}/publication`, {
      body: JSON.stringify({ isPublic }),
      method: "PATCH",
    });
  },

  deleteFile({ fileId, projectId }) {
    return apiRequest(`/projects/${projectId}/files/${fileId}`, {
      method: "DELETE",
    });
  },

  uploadFile({ file, onUploadProgress, projectId, signal }) {
    return uploadRawFile({
      file,
      onUploadProgress,
      path: `/projects/${projectId}/files`,
      signal,
    });
  },
};

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
