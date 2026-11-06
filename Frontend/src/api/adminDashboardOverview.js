/* Gestiona la carga y caché temporal del resumen principal del dashboard administrativo. */
import { api } from "./http.js";

const CACHE_TTL_MS = 15000;

const cacheByScope = new Map();
const inFlightByScope = new Map();
// Generación vigente de la caché: una lectura iniciada antes de invalidar no la repuebla.
let cacheGeneration = 0;

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

  const generation = cacheGeneration;
  const request = api.admin
    .getDashboardOverview()
    .then((data) => {
      const overview = data.overview || null;
      if (generation === cacheGeneration) {
        cacheByScope.set(resolvedScopeKey, {
          expiresAt: Date.now() + CACHE_TTL_MS,
          overview,
        });
      }
      return overview;
    })
    .finally(() => {
      if (inFlightByScope.get(resolvedScopeKey) === request) {
        inFlightByScope.delete(resolvedScopeKey);
      }
    });

  inFlightByScope.set(resolvedScopeKey, request);
  return request;
}

/**
 * Invalida el overview tras una mutación confirmada de solicitudes o proyectos (asignación,
 * decisión o conversión). Vacía la caché de todos los ámbitos y deja de deduplicar las
 * lecturas en curso: se iniciaron antes del cambio y podrían devolver el estado anterior, de
 * modo que la siguiente lectura (dashboard, actividad reciente) consulta el estado vigente.
 *
 * @returns {void}
 */
export function invalidateAdminDashboardOverview() {
  cacheGeneration += 1;
  cacheByScope.clear();
  inFlightByScope.clear();
}
