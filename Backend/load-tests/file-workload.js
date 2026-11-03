// Escenario F: subidas y descargas simultáneas con consultas y comentarios en paralelo.
// Ver config.js para variables, perfiles y cuentas. FILE_SIZE_BYTES fija el tamaño de cada subida
// (5 MB por defecto). Las subidas son PDF mínimos válidos para la validación de firma; DOCX/XLSX se
// excluyen porque files.file_type (varchar 50) no admite su tipo MIME (hallazgo de la Fase 3).
import http from "k6/http";
import { check, sleep } from "k6";

import { commentsCreated, login, profileOptions, required, summaryTrendStats, track, users } from "./config.js";
import { sessionHeaders } from "./session.js";

const baseUrl = required("BASE_URL");
const origin = __ENV.FRONTEND_ORIGIN || "http://localhost:5173";
// Los administradores no suben documentos de proyecto en el uso normal: se usan clientes y arquitectos.
const accounts = users().filter((account) => account.role !== "admin");
const size = Number(__ENV.FILE_SIZE_BYTES || 5242880);
const payload = new Uint8Array(size);
payload.set([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-

export const options = { ...profileOptions(__ENV.PROFILE || "F"), summaryTrendStats };

/**
 * Registra y comprueba una respuesta (éxito o límite legítimo).
 *
 * @param {object} response - Respuesta de k6.
 * @param {string} name - Paso.
 * @param {Array<number>} expected - Estados de éxito.
 * @returns {object} Respuesta.
 */
function ok(response, name, expected) {
  const outcome = track(response);
  check(response, { [name]: () => expected.includes(response.status) || outcome === "rate_limited" });
  return response;
}

export function setup() {
  return { sessions: login(baseUrl, accounts) };
}

export default function (data) {
  const session = data.sessions[(__VU - 1) % data.sessions.length];
  const headers = sessionHeaders(session.cookie, origin);
  const roll = Math.random();
  if (roll < 0.35) {
    ok(http.post(`${baseUrl}/api/projects/${session.projectId}/files`, payload.buffer, {
      headers: { ...headers, "Content-Type": "application/pdf", "X-File-Name": `carga-${__VU}-${__ITER}-${Date.now()}.pdf` },
      tags: { endpoint: "file-upload", kind: "file" },
      timeout: "120s",
    }), "subida aceptada", [201]);
  } else if (roll < 0.7 && session.fileId) {
    ok(http.get(`${baseUrl}/api/projects/${session.projectId}/files/${session.fileId}/content`, {
      headers: { ...headers, Range: "bytes=0-524287" },
      tags: { endpoint: "file-download", kind: "file" },
      timeout: "120s",
    }), "descarga correcta", [200, 206]);
  } else if (roll < 0.85) {
    ok(http.get(`${baseUrl}/api/projects/${session.projectId}`, { headers, tags: { endpoint: "project-detail", kind: "json" } }), "detalle de proyecto", [200]);
  } else {
    const response = ok(http.post(`${baseUrl}/api/projects/${session.projectId}/comments`, JSON.stringify({ commentType: "general", content: `Durante transferencias ${__VU}-${__ITER}` }), {
      headers: { ...headers, "Content-Type": "application/json" },
      tags: { endpoint: "comment-create", kind: "write", project: String(session.projectId) },
    }), "comentario durante transferencias", [201]);
    if (response.status === 201) commentsCreated.add(1);
  }
  sleep(1);
}
