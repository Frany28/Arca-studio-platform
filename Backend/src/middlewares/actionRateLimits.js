import { createSharedRateLimit } from "./sharedRateLimit.js";

// Límites de acciones de usuarios autenticados (hallazgo B-2, segunda fase): comentarios, solicitudes,
// cargas de archivos y operaciones administrativas, compartidos entre instancias en PostgreSQL.
//
// La clave es el usuario autenticado (nunca la IP): detrás de Netlify todos comparten IP y no hay
// bloqueos colectivos. Si el contador no está disponible responden 503 antes de ejecutar la operación
// (fail-closed). Se conservan los límites anteriores salvo las cargas: los lotes del frontend suben
// todos los archivos a la vez, por lo que se admite una ráfaga de 60 por cada 10 minutos.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Lee un entero positivo de configuración con un valor por defecto.
 * Los valores ausentes, no numéricos o no positivos usan el predeterminado para no desactivar el límite.
 *
 * @param {string} name - Variable de entorno.
 * @param {number} fallback - Valor por defecto.
 * @returns {number} Valor configurado.
 */
function positiveIntegerSetting(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export const ACTION_RATE_LIMITS = Object.freeze({
  adminProjectBulkAction: Object.freeze({ max: 60, windowMs: HOUR_MS }),
  adminProjectRequestDecision: Object.freeze({ max: 60, windowMs: HOUR_MS }),
  // Generar el PDF ocupa CPU del servidor: se limita igual que una escritura administrativa.
  adminQuotePdf: Object.freeze({ max: 240, windowMs: HOUR_MS }),
  adminQuoteWrite: Object.freeze({ max: 120, windowMs: HOUR_MS }),
  adminMeasurementUnitWrite: Object.freeze({ max: 120, windowMs: HOUR_MS }),
  adminServiceCatalogWrite: Object.freeze({ max: 120, windowMs: HOUR_MS }),
  adminUserCreate: Object.freeze({ max: 20, windowMs: HOUR_MS }),
  adminUserNote: Object.freeze({ max: 120, windowMs: HOUR_MS }),
  adminUserSessionRevoke: Object.freeze({ max: 60, windowMs: HOUR_MS }),
  adminUserStatus: Object.freeze({ max: 60, windowMs: HOUR_MS }),
  comments: Object.freeze({
    max: positiveIntegerSetting("COMMENT_RATE_LIMIT_MAX", 30),
    windowMs: positiveIntegerSetting("COMMENT_RATE_LIMIT_WINDOW_MS", MINUTE_MS),
  }),
  ownSessionRevoke: Object.freeze({ max: 10, windowMs: HOUR_MS }),
  projectRequests: Object.freeze({
    max: positiveIntegerSetting("PROJECT_REQUEST_RATE_LIMIT_MAX", 10),
    windowMs: positiveIntegerSetting("PROJECT_REQUEST_RATE_LIMIT_WINDOW_MS", MINUTE_MS),
  }),
  uploads: Object.freeze({
    max: positiveIntegerSetting("UPLOAD_RATE_LIMIT_MAX", 60),
    windowMs: positiveIntegerSetting("UPLOAD_RATE_LIMIT_WINDOW_MS", 10 * MINUTE_MS),
  }),
});

/**
 * Crea el limitador compartido de una acción de usuario autenticado.
 * Las rutas lo colocan después de requireAuth; sin usuario no hay dimensión y la autenticación ya habrá
 * rechazado la petición.
 *
 * @param {string} scope - Ámbito del contador.
 * @param {{ max: number, windowMs: number }} limit - Límite por usuario.
 * @returns {import("express").RequestHandler} Middleware de Express.
 */
export function createUserActionRateLimit(scope, limit) {
  return createSharedRateLimit(scope, function userDimensions(req) {
    return req.user?.id ? [{ name: "user", parts: [`user:${req.user.id}`], ...limit }] : [];
  });
}

export const commentRateLimit = createUserActionRateLimit("comments", ACTION_RATE_LIMITS.comments);
export const requestRateLimit = createUserActionRateLimit("project-requests", ACTION_RATE_LIMITS.projectRequests);
export const uploadRateLimit = createUserActionRateLimit("uploads", ACTION_RATE_LIMITS.uploads);
export const ownSessionRevokeRateLimit = createUserActionRateLimit("own-session-revoke", ACTION_RATE_LIMITS.ownSessionRevoke);

export const adminRateLimits = Object.freeze({
  projectBulkAction: createUserActionRateLimit("admin-project-bulk-action", ACTION_RATE_LIMITS.adminProjectBulkAction),
  projectRequestDecision: createUserActionRateLimit("admin-project-request-decision", ACTION_RATE_LIMITS.adminProjectRequestDecision),
  quotePdf: createUserActionRateLimit("admin-quote-pdf", ACTION_RATE_LIMITS.adminQuotePdf),
  quoteWrite: createUserActionRateLimit("admin-quote-write", ACTION_RATE_LIMITS.adminQuoteWrite),
  measurementUnitWrite: createUserActionRateLimit("admin-measurement-unit-write", ACTION_RATE_LIMITS.adminMeasurementUnitWrite),
  serviceCatalogWrite: createUserActionRateLimit("admin-service-catalog-write", ACTION_RATE_LIMITS.adminServiceCatalogWrite),
  userCreate: createUserActionRateLimit("admin-user-create", ACTION_RATE_LIMITS.adminUserCreate),
  userNote: createUserActionRateLimit("admin-user-note", ACTION_RATE_LIMITS.adminUserNote),
  userSessionRevoke: createUserActionRateLimit("admin-user-session-revoke", ACTION_RATE_LIMITS.adminUserSessionRevoke),
  userStatus: createUserActionRateLimit("admin-user-status", ACTION_RATE_LIMITS.adminUserStatus),
});
