/* Infraestructura HTTP compartida por los módulos de acceso a la API. */
import { NETWORK_USER_ERROR_MESSAGE } from "../utils/userFacingError.js";

const viteEnv = import.meta.env || {};
const API_BASE_URL = (
  (viteEnv.DEV ? viteEnv.VITE_API_URL : "") ||
  "/api"
).replace(/\/$/, "");

/**
 * Compone una URL de API; la base configurable se usa solo en desarrollo.
 *
 * @param {string} path - Ruta relativa que incluye la barra inicial.
 * @returns {string} URL con la base de API actual.
 */
export function getApiUrl(path) {
  return `${API_BASE_URL}${path}`;
}

/**
 * Env?a una petici?n con cookies y traduce fallos HTTP y de red a errores consumibles.
 * Devuelve null para 204, respuestas no JSON o JSON que no pueda decodificarse.
 *
 * @param {string} path - Ruta relativa a la base de API.
 * @param {Object} [options={}] - Opciones fetch; admite headers y signal.
 * @returns {Promise<Object|null>} Contenido JSON recibido o null.
 * @throws {Error} Fallo HTTP con status/code/fields, fallo de red o cancelaci?n.
 */
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

/**
 * Recorre cursores secuencialmente y conserva la primera aparici?n de cada id.
 * Los elementos sin id reciben una clave seg?n la longitud acumulada.
 *
 * @param {Function} fetchPage - Carga una p?gina con cursor y limit.
 * @param {string} collectionKey - Campo que contiene los elementos de cada p?gina.
 * @param {number} [limit=100] - Tama?o solicitado por p?gina.
 * @returns {Promise<Object>} Colecci?n acumulada y nextCursor null.
 */
export async function collectCursorPages(fetchPage, collectionKey, limit = 100) {
  const items = [];
  const ids = new Set();
  let cursor = null;

  do {
    const page = await fetchPage({ cursor, limit });

    for (const item of page?.[collectionKey] || []) {
      const key = String(item?.id ?? `${items.length}`);

      if (!ids.has(key)) {
        ids.add(key);
        items.push(item);
      }
    }

    cursor = page?.nextCursor || null;
  } while (cursor);

  return { [collectionKey]: items, nextCursor: null };
}

/**
 * Sube el archivo sin envolverlo en JSON y env?a cookies de sesi?n.
 * Limita el progreso a 99 hasta recibir una respuesta HTTP exitosa.
 *
 * @param {Object} params - Archivo y opciones de subida.
 * @param {Object} params.file - Archivo con name, type y size.
 * @param {Function} [params.onUploadProgress] - Recibe loaded, total y progress.
 * @param {string} params.path - Ruta del endpoint de subida.
 * @param {Object} [params.signal] - AbortSignal para cancelar la petici?n activa.
 * @returns {Promise<Object|null>} Respuesta JSON decodificada o null.
 * @throws {Error} La promesa rechaza ante error HTTP, red o cancelaci?n.
 */
export function uploadRawFile({ file, onUploadProgress, path, signal }) {
  const fileName = encodeURIComponent(file?.name || "archivo");

  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abortUpload = () => {
      request.abort();
    };

    request.open("POST", `${API_BASE_URL}${path}`);
    request.withCredentials = true;
    request.setRequestHeader(
      "Content-Type",
      file?.type || "application/octet-stream",
    );
    request.setRequestHeader("X-File-Name", fileName);

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || !event.total) {
        return;
      }

      const progress = Math.min(
        Math.round((event.loaded / event.total) * 100),
        99,
      );

      onUploadProgress?.({
        loaded: event.loaded,
        progress,
        total: event.total,
      });
    };

    request.onload = () => {
      signal?.removeEventListener("abort", abortUpload);
      let data = null;

      try {
        data = request.responseText ? JSON.parse(request.responseText) : null;
      } catch {
        data = null;
      }

      if (request.status < 200 || request.status >= 300) {
        const error = new Error(
          data?.message || "No se pudo subir el archivo.",
        );
        error.status = request.status;
        error.code = data?.code || "FILE_UPLOAD_FAILED";
        reject(error);
        return;
      }

      onUploadProgress?.({
        loaded: file?.size || 0,
        progress: 100,
        total: file?.size || 0,
      });
      resolve(data);
    };

    request.onerror = () => {
      signal?.removeEventListener("abort", abortUpload);
      reject(new Error("No se pudo subir el archivo."));
    };

    request.onabort = () => {
      signal?.removeEventListener("abort", abortUpload);
      const error = new Error("La subida del archivo fue cancelada.");
      error.code = "UPLOAD_ABORTED";
      reject(error);
    };

    signal?.addEventListener("abort", abortUpload, { once: true });
    request.send(file);
  });
}
