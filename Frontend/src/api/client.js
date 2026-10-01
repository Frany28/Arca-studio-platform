import { NETWORK_USER_ERROR_MESSAGE } from "../utils/userFacingError.js";

const viteEnv = import.meta.env || {};

export const API_BASE_URL = (
  (viteEnv.DEV ? viteEnv.VITE_API_URL : "") ||
  "/api"
).replace(/\/$/, "");

export function getApiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

export async function apiRequest(path, options = {}) {
  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch (requestError) {
    if (requestError?.name === "AbortError") throw requestError;

    const networkError = new Error(NETWORK_USER_ERROR_MESSAGE);
    networkError.code = "NETWORK_ERROR";
    networkError.cause = requestError;
    throw networkError;
  }

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : null;

  if (!response.ok) {
    const error = new Error(
      data?.message || "La API no está disponible para esta acción.",
    );
    error.status = response.status;
    error.code = data?.code || "API_ROUTE_UNAVAILABLE";
    error.fields = data?.fields || null;
    throw error;
  }

  return data;
}

export async function collectCursorPages(fetchPage, collectionKey, limit = 100) {
  const items = [];
  const ids = new Set();
  let cursor = null;
  do {
    const page = await fetchPage({ cursor, limit });
    for (const item of page?.[collectionKey] || []) {
      const key = String(item?.id ?? `${items.length}`);
      if (!ids.has(key)) { ids.add(key); items.push(item); }
    }
    cursor = page?.nextCursor || null;
  } while (cursor);
  return { [collectionKey]: items, nextCursor: null };
}
