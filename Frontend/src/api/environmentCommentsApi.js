import { apiRequest, collectCursorPages } from "./client.js";

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
