// Escenario G: comentarios y notificaciones entre proyectos distintos.
// Cada usuario virtual sincroniza (incrementalmente) los proyectos de sus notificaciones y crea
// comentarios en su proyecto. Ejecutar en paralelo sse-probe.mjs con los mismos proyectos para medir
// la entrega en tiempo real; collect-results.mjs compara los comentarios creados (por proyecto) con
// los eventos recibidos, e integrity-check.mjs con los guardados en PostgreSQL.
import http from "k6/http";
import { check, sleep } from "k6";

import { commentsCreated, login, profileOptions, required, summaryTrendStats, track, users } from "./config.js";
import { sessionHeaders } from "./session.js";

const baseUrl = required("BASE_URL");
const origin = __ENV.FRONTEND_ORIGIN || "http://localhost:5173";
const accounts = users().filter((account) => account.role !== "admin");

export const options = { ...profileOptions(__ENV.PROFILE || "G"), summaryTrendStats };

const syncCursors = {};

/**
 * Registra y comprueba una respuesta (éxito o límite legítimo).
 *
 * @param {object} response - Respuesta de k6.
 * @param {string} name - Paso.
 * @returns {object} Respuesta.
 */
function ok(response, name) {
  const outcome = track(response);
  check(response, { [name]: () => outcome === "ok" || outcome === "rate_limited" });
  return response;
}

/**
 * Lee solo los comentarios nuevos de un proyecto (syncCursor), como la fuente de observaciones.
 *
 * @param {object} session - Cuenta con cookie.
 * @param {number} projectId - Proyecto.
 * @returns {void}
 */
function syncComments(session, projectId) {
  const key = String(projectId);
  let cursor = syncCursors[key] || null;
  let latestSync = null;
  do {
    const response = ok(http.get(`${baseUrl}/api/projects/${projectId}/comments?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, {
      headers: sessionHeaders(session.cookie, origin),
      tags: { endpoint: "notifications-sync", kind: "json" },
    }), "sincronizar comentarios");
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
  for (const projectId of session.notificationProjectIds || [session.projectId]) syncComments(session, projectId);
  if (Math.random() < 0.3) {
    const response = ok(http.post(`${baseUrl}/api/projects/${session.projectId}/comments`, JSON.stringify({ commentType: "general", content: `Tiempo real ${__VU}-${__ITER}-${Date.now()}` }), {
      headers: sessionHeaders(session.cookie, origin, { "Content-Type": "application/json" }),
      tags: { endpoint: "comment-create", kind: "write", project: String(session.projectId) },
    }), "crear comentario");
    if (response.status === 201) commentsCreated.add(1);
  }
  // Ritmo de la interfaz: el respaldo del frontend sincroniza cada 15–30 s; aquí más a menudo para cargar.
  sleep(Math.random() * 3 + 2);
}
