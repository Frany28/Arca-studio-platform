import { lazy } from "react";

// Marca de la última recarga automática por un módulo no disponible. Vive en sessionStorage:
// solo afecta a la pestaña actual y se pierde al cerrarla.
export const CHUNK_RELOAD_STORAGE_KEY = "arca:chunk-reload-at";
// Si el módulo vuelve a fallar dentro de este intervalo tras recargar, no se recarga de nuevo:
// el problema no es una versión antigua y se muestra la pantalla de error (sin bucles).
export const CHUNK_RELOAD_WINDOW_MS = 30_000;

// Mensajes de Chromium/Edge, Firefox y Safari cuando falla un import() dinámico.
const CHUNK_ERROR_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
];

/**
 * Indica si un error corresponde a un módulo diferido que no se pudo descargar, típico tras una
 * nueva publicación: la pestaña conserva el index.html anterior y pide chunks ya eliminados.
 *
 * @param {unknown} error - Error capturado.
 * @returns {boolean} true para fallos de carga de módulos.
 */
export function isChunkLoadError(error) {
  const message = typeof error === "string" ? error : error?.message;
  return typeof message === "string" && CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Decide si se permite una recarga automática y, en ese caso, registra su momento. Solo se
 * permite una recarga por intervalo; sin almacenamiento disponible no se recarga, para no
 * arriesgar un bucle.
 *
 * @param {{getItem: Function, setItem: Function}|null} storage - Almacenamiento de la sesión.
 * @param {number} now - Momento actual en milisegundos.
 * @returns {boolean} true si se debe recargar.
 */
export function claimChunkReload(storage, now) {
  if (!storage) return false;
  try {
    const lastReload = Number(storage.getItem(CHUNK_RELOAD_STORAGE_KEY));
    if (Number.isFinite(lastReload) && lastReload > 0 && now - lastReload < CHUNK_RELOAD_WINDOW_MS) return false;
    storage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/**
 * Devuelve sessionStorage si el navegador lo permite (puede lanzar en modo privado o con
 * almacenamiento bloqueado).
 *
 * @returns {Storage|null} Almacenamiento de la sesión o null.
 */
function getSessionStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Carga un módulo diferido y, si falla porque la versión publicada cambió, recarga la página una
 * vez para obtener el index.html vigente. La recarga respeta `beforeunload`: si hay un formulario
 * con cambios sin guardar (useUnsavedChangesGuard), el navegador pide confirmación antes de salir.
 * Cualquier otro error, o un segundo fallo tras recargar, se propaga a la pantalla de error de
 * la ruta, que ofrece reintentar.
 *
 * @param {() => Promise<any>} importer - Función `() => import(...)`.
 * @param {Object} [options] - Dependencias inyectables para pruebas.
 * @param {() => void} [options.reload] - Recarga la página.
 * @param {{getItem: Function, setItem: Function}|null} [options.storage] - Almacenamiento de la sesión.
 * @param {() => number} [options.now] - Reloj.
 * @returns {Promise<any>} Módulo cargado; durante la recarga queda pendiente para no mostrar errores.
 */
export function loadWithChunkRecovery(importer, {
  now = Date.now,
  reload = () => window.location.reload(),
  storage = getSessionStorage(),
} = {}) {
  return importer().catch((error) => {
    if (!isChunkLoadError(error) || !claimChunkReload(storage, now())) throw error;
    reload();
    // Pendiente a propósito: la página se recarga y Suspense mantiene el fallback mientras tanto.
    return new Promise(() => {});
  });
}

/**
 * Igual que `React.lazy`, con recuperación ante módulos no disponibles tras una publicación.
 *
 * @param {() => Promise<{default: import("react").ComponentType}>} importer - `() => import(...)`.
 * @returns {import("react").LazyExoticComponent<any>} Componente diferido.
 */
export function lazyWithRetry(importer) {
  return lazy(() => loadWithChunkRecovery(importer));
}
