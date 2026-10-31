// Subidas y descargas simultáneas (P0-4). Ver config.js para variables, perfiles y cuentas.
// FILE_SIZE_BYTES fija el tamaño de cada subida (5 MB por defecto). Los archivos se suben con el
// contenido de un PDF mínimo para superar la validación de firma.
import http from "k6/http";
import { check, sleep } from "k6";

import { login, required, scenarios, summaryTrendStats, thresholds, track, users } from "./config.js";
import { sessionHeaders } from "./session.js";

const baseUrl = required("BASE_URL");
const origin = __ENV.FRONTEND_ORIGIN || baseUrl;
const accounts = users();
const size = Number(__ENV.FILE_SIZE_BYTES || 5242880);
const payload = new Uint8Array(size);
payload.set([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-

export const options = { scenarios: scenarios(), summaryTrendStats, thresholds };

export function setup() {
  return { sessions: login(baseUrl, accounts) };
}

export default function (data) {
  const session = data.sessions[(__VU - 1) % data.sessions.length];
  const headers = sessionHeaders(session.cookie, origin);
  if (Math.random() < 0.5) {
    const response = http.post(`${baseUrl}/api/projects/${session.projectId}/files`, payload.buffer, {
      headers: { ...headers, "Content-Type": "application/pdf", "X-File-Name": `carga-${__VU}-${__ITER}-${Date.now()}.pdf` },
      tags: { endpoint: "file-upload", kind: "file" },
      timeout: "120s",
    });
    const outcome = track(response);
    check(response, { "subida aceptada o limitada": () => response.status === 201 || outcome === "rate_limited" });
  } else if (session.fileId) {
    const response = http.get(`${baseUrl}/api/projects/${session.projectId}/files/${session.fileId}/content`, {
      headers: { ...headers, Range: "bytes=0-1048575" },
      tags: { endpoint: "file-download", kind: "file" },
      timeout: "120s",
    });
    const outcome = track(response);
    check(response, { "descarga correcta": () => [200, 206].includes(response.status) || outcome === "rate_limited" });
  }
  sleep(1);
}
