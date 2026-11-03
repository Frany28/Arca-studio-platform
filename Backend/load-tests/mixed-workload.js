// Carga mixta por rol (escenarios A–E y H). Ver config.js para variables, perfiles y cuentas.
// - Cliente: proyectos, comentarios incrementales, notificaciones, solicitudes y descargas parciales.
// - Arquitecto: lo mismo más la cola de revisión de solicitudes.
// - Administrador: panel, usuarios, servicios, cotizaciones y, ocasionalmente, un PDF de cotización.
// Las subidas grandes se miden en file-workload.js y las conexiones SSE en sse-probe.mjs.
import http from "k6/http";
import { check, sleep } from "k6";

import { commentsCreated, login, profileOptions, required, summaryTrendStats, track, users } from "./config.js";
import { sessionHeaders } from "./session.js";

const baseUrl = required("BASE_URL");
const origin = __ENV.FRONTEND_ORIGIN || "http://localhost:5173";
const accounts = users();

export const options = { ...profileOptions(), summaryTrendStats };

// Estado por usuario virtual: último syncCursor de cada proyecto, como la fuente de observaciones.
const syncCursors = {};

/**
 * Comprueba la respuesta (éxito o límite legítimo) y la registra en las métricas propias.
 *
 * @param {object} response - Respuesta de k6.
 * @param {string} name - Nombre del paso.
 * @returns {object} La misma respuesta.
 */
function ok(response, name) {
  const outcome = track(response);
  check(response, { [`${name}: estado esperado`]: () => outcome === "ok" || outcome === "rate_limited" });
  return response;
}

/**
 * GET JSON con etiquetas de endpoint y tipo.
 *
 * @param {object} session - Cuenta con cookie.
 * @param {string} path - Ruta de la API.
 * @param {string} endpoint - Etiqueta de la métrica.
 * @returns {object} Respuesta.
 */
function getJson(session, path, endpoint) {
  return ok(http.get(`${baseUrl}${path}`, { headers: sessionHeaders(session.cookie, origin), tags: { endpoint, kind: "json" } }), endpoint);
}

/**
 * Lee comentarios como el frontend: completo la primera vez y después solo los nuevos.
 *
 * @param {object} session - Cuenta con cookie.
 * @param {number} projectId - Proyecto.
 * @param {string} endpoint - Etiqueta de la métrica.
 * @returns {void}
 */
function syncComments(session, projectId, endpoint) {
  const key = String(projectId);
  let cursor = syncCursors[key] || null;
  let latestSync = null;
  do {
    const response = getJson(session, `/api/projects/${projectId}/comments?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, endpoint);
    if (response.status !== 200) return;
    const body = response.json();
    latestSync = body.syncCursor || latestSync;
    cursor = body.nextCursor;
  } while (cursor);
  if (latestSync) syncCursors[key] = latestSync;
}

/**
 * Crea un comentario en el proyecto de la cuenta y lo cuenta para la comprobación de integridad.
 *
 * @param {object} session - Cuenta con cookie.
 * @returns {void}
 */
function createComment(session) {
  const response = ok(http.post(`${baseUrl}/api/projects/${session.projectId}/comments`, JSON.stringify({ commentType: "general", content: `Carga ${__VU}-${__ITER}-${Date.now()}` }), {
    headers: sessionHeaders(session.cookie, origin, { "Content-Type": "application/json" }),
    tags: { endpoint: "comment-create", kind: "write", project: String(session.projectId) },
  }), "crear comentario");
  if (response.status === 201) commentsCreated.add(1);
}

/**
 * Descarga parcial (Range) del archivo de la cuenta.
 *
 * @param {object} session - Cuenta con cookie.
 * @returns {void}
 */
function downloadRange(session) {
  if (!session.fileId) return;
  ok(http.get(`${baseUrl}/api/projects/${session.projectId}/files/${session.fileId}/content`, {
    headers: sessionHeaders(session.cookie, origin, { Range: "bytes=0-262143" }),
    tags: { endpoint: "file-download", kind: "file" },
  }), "descarga parcial");
}

/**
 * Iteración de un cliente o arquitecto.
 *
 * @param {object} session - Cuenta con cookie.
 * @returns {void}
 */
function projectMember(session) {
  const roll = Math.random() * 100;
  if (roll < 10) getJson(session, "/api/auth/me", "session");
  else if (roll < 40) {
    getJson(session, "/api/projects", "projects-list");
    getJson(session, `/api/projects/${session.projectId}`, "project-detail");
  } else if (roll < 62) syncComments(session, session.projectId, "comments-sync");
  else if (roll < 72) for (const projectId of session.notificationProjectIds || []) syncComments(session, projectId, "notifications-sync");
  else if (roll < 80) createComment(session);
  else if (roll < 88) getJson(session, session.role === "architect" ? "/api/project-requests/review-queue" : "/api/project-requests", "project-requests");
  else downloadRange(session);
}

/**
 * Iteración de un administrador.
 *
 * @param {object} session - Cuenta con cookie.
 * @returns {void}
 */
function administrator(session) {
  const roll = Math.random() * 100;
  if (roll < 15) getJson(session, "/api/admin/dashboard-metrics", "admin-metrics");
  else if (roll < 30) getJson(session, "/api/admin/dashboard-overview", "admin-overview");
  else if (roll < 45) getJson(session, "/api/admin/users?limit=25", "admin-users");
  else if (roll < 60) getJson(session, "/api/projects", "projects-list");
  else if (roll < 72) getJson(session, "/api/admin/services?limit=25", "admin-services");
  else if (roll < 86) getJson(session, "/api/admin/quotes?limit=25", "admin-quotes");
  else if (roll < 96) getJson(session, "/api/admin/quotes/summary", "admin-quotes-summary");
  else {
    // PDF de cotización: CPU del servidor (limitado a 240 por hora y administrador).
    const list = getJson(session, "/api/admin/quotes?limit=5", "admin-quotes");
    const quoteId = list.status === 200 ? list.json("quotes.0.id") : null;
    if (quoteId) ok(http.get(`${baseUrl}/api/admin/quotes/${quoteId}/pdf`, { headers: sessionHeaders(session.cookie, origin), tags: { endpoint: "admin-quote-pdf", kind: "file" } }), "pdf de cotización");
  }
}

export function setup() {
  return { sessions: login(baseUrl, accounts) };
}

export default function (data) {
  const session = data.sessions[(__VU - 1) % data.sessions.length];
  if (session.role === "admin") administrator(session);
  else projectMember(session);
  sleep(Math.random() * 2 + 0.5);
}
