// Carga mixta (P0-4): proyectos, comentarios incrementales y notificaciones como el frontend, más
// descargas parciales. Ver config.js para variables, perfiles y cuentas. Las subidas grandes se
// miden en file-workload.js y las conexiones SSE en sse-probe.mjs (k6 espera a que cierren los cuerpos).
import http from "k6/http";
import { check, sleep } from "k6";

import { login, required, scenarios, summaryTrendStats, thresholds, track, users } from "./config.js";
import { sessionHeaders } from "./session.js";

const baseUrl = required("BASE_URL");
const origin = __ENV.FRONTEND_ORIGIN || baseUrl;
const accounts = users();

export const options = { scenarios: scenarios(), summaryTrendStats, thresholds };

// Estado por usuario virtual: último syncCursor de cada proyecto, como la fuente de observaciones.
const syncCursors = {};

/**
 * Comprueba la respuesta: éxito o límite legítimo (429), y la registra en las métricas propias.
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
 * Lee comentarios como el frontend: completo la primera vez y después solo los nuevos.
 *
 * @param {object} session - Cuenta con cookie.
 * @param {number|string} projectId - Proyecto.
 * @param {string} endpoint - Etiqueta de la métrica.
 * @returns {void}
 */
function syncComments(session, projectId, endpoint) {
  const headers = sessionHeaders(session.cookie, origin);
  const key = String(projectId);
  let cursor = syncCursors[key] || null;
  let latestSync = null;
  do {
    const query = `limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const response = ok(http.get(`${baseUrl}/api/projects/${projectId}/comments?${query}`, { headers, tags: { endpoint, kind: "json" } }), endpoint);
    if (response.status !== 200) return;
    const body = response.json();
    latestSync = body.syncCursor || latestSync;
    cursor = body.nextCursor;
  } while (cursor);
  if (latestSync) syncCursors[key] = latestSync;
}

export function setup() {
  return { sessions: login(baseUrl, accounts) };
}

export default function (data) {
  const session = data.sessions[(__VU - 1) % data.sessions.length];
  const headers = sessionHeaders(session.cookie, origin);
  const roll = Math.random() * 100;

  if (roll < 15) {
    ok(http.get(`${baseUrl}/api/auth/me`, { headers, tags: { endpoint: "session", kind: "json" } }), "sesión");
  } else if (roll < 45) {
    ok(http.get(`${baseUrl}/api/projects`, { headers, tags: { endpoint: "projects-list", kind: "json" } }), "lista de proyectos");
    ok(http.get(`${baseUrl}/api/projects/${session.projectId}`, { headers, tags: { endpoint: "project-detail", kind: "json" } }), "detalle de proyecto");
  } else if (roll < 70) {
    syncComments(session, session.projectId, "comments-sync");
  } else if (roll < 80) {
    // Notificaciones: los proyectos de la cuenta, con lecturas incrementales.
    for (const projectId of session.notificationProjectIds || [session.projectId]) syncComments(session, projectId, "notifications-sync");
  } else if (roll < 88) {
    ok(http.post(`${baseUrl}/api/projects/${session.projectId}/comments`, JSON.stringify({ commentType: "general", content: `Carga ${__VU}-${__ITER}-${Date.now()}` }), {
      headers: { ...headers, "Content-Type": "application/json" },
      tags: { endpoint: "comment-create", kind: "write" },
    }), "crear comentario");
  } else if (session.fileId) {
    ok(http.get(`${baseUrl}/api/projects/${session.projectId}/files/${session.fileId}/content`, {
      headers: { ...headers, Range: "bytes=0-1048575" },
      tags: { endpoint: "file-download", kind: "file" },
    }), "descarga parcial");
  }
  sleep(Math.random() * 2 + 0.5);
}
