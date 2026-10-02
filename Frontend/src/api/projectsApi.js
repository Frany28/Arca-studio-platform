import {
  apiRequest,
  collectCursorPages,
  getApiUrl,
  uploadRawFile,
} from "./client.js";

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
