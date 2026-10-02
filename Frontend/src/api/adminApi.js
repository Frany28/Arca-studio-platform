import { apiRequest, getApiUrl } from "./client.js";

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
