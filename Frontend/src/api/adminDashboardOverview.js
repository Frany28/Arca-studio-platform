/* Gestiona la carga y caché temporal del resumen principal del dashboard administrativo. */
import { api } from "./http.js";

const CACHE_TTL_MS = 15000;

const cacheByScope = new Map();
const inFlightByScope = new Map();

// Reutiliza datos recientes, deduplica solicitudes activas y permite forzar una recarga.
export function loadAdminDashboardOverview({ force = false, scopeKey } = {}) {
  const now = Date.now();
  const resolvedScopeKey = String(scopeKey || "admin-session");
  const cached = cacheByScope.get(resolvedScopeKey);

  if (!force && cached?.overview && cached.expiresAt > now) {
    return Promise.resolve(cached.overview);
  }

  if (inFlightByScope.has(resolvedScopeKey)) {
    return inFlightByScope.get(resolvedScopeKey);
  }

  const request = api.admin
    .getDashboardOverview()
    .then((data) => {
      const overview = data.overview || null;
      cacheByScope.set(resolvedScopeKey, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        overview,
      });
      return overview;
    })
    .finally(() => {
      inFlightByScope.delete(resolvedScopeKey);
    });

  inFlightByScope.set(resolvedScopeKey, request);
  return request;
}
