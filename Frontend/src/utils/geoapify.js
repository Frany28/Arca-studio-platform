const viteEnv = import.meta.env || {};
const API_BASE_URL = (
  (viteEnv.DEV ? viteEnv.VITE_API_URL : "") ||
  "/api"
).replace(/\/$/, "");

function looksLikeCoordinates(value) {
  return /^-?\d+(?:\.\d+)?\s*[, ]\s*-?\d*(?:\.\d*)?$/.test(
    String(value || "").trim(),
  );
}

/**
 * Busca direcciones mediante fetch con cookies y query param q.
 * En desarrollo admite VITE_API_URL; fuera usa /api. Omite textos de menos de dos
 * caracteres salvo el patrón de coordenadas. Propaga abortos, distingue fallos de red
 * y exige respuesta JSON con suggestions como array; no aplica debounce ni reintentos.
 *
 * @param {string} query - Texto recortado antes de buscar.
 * @param {Object} [options={}] - Control de cancelación.
 * @param {AbortSignal} [options.signal] - Señal transmitida a fetch.
 * @returns {Promise<Array>} Sugerencias recibidas o lista vacía si la consulta se omite.
 * @throws {Error} Rechaza por aborto, fallo de red, estado HTTP fallido o respuesta inválida.
 */
export async function searchAddressSuggestions(query, { signal } = {}) {
  const trimmedQuery = String(query || "").trim();

  if (trimmedQuery.length < 2 && !looksLikeCoordinates(trimmedQuery)) {
    return [];
  }

  const params = new URLSearchParams({ q: trimmedQuery });

  let response;
  try {
    response = await fetch(
      `${API_BASE_URL}/geoapify/address-suggestions?${params}`,
      {
        credentials: "include",
        signal,
      },
    );
  } catch (error) {
    if (error.name === "AbortError") throw error;

    const networkError = new Error(
      "No se pudo conectar con el buscador de ubicaciones.",
      { cause: error },
    );
    networkError.code = "LOCATION_SEARCH_UNAVAILABLE";
    throw networkError;
  }

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : null;

  if (!response.ok) {
    const error = new Error(
      data?.message || "No se pudieron obtener sugerencias de ubicación.",
    );
    error.code = data?.code || "LOCATION_SEARCH_FAILED";
    error.status = response.status;
    throw error;
  }

  if (!Array.isArray(data?.suggestions)) {
    const error = new Error(
      "El buscador de ubicaciones devolvió una respuesta no válida.",
    );
    error.code = "LOCATION_SEARCH_INVALID_RESPONSE";
    throw error;
  }

  return data.suggestions;
}
