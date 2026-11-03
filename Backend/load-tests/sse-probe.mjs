// Escenario G (tiempo real): abre SSE_CONNECTIONS conexiones de eventos en los proyectos de las cuentas
// sembradas y cuenta, por proyecto, los eventos `project.comment.created` recibidos. Se ejecuta en
// paralelo con comments-workload.js; collect-results.mjs compara esos eventos con los comentarios
// creados. Solo contra el entorno aislado: destino local y cuentas @loadtest.invalid.
//   BASE_URL=http://127.0.0.1:3000 LOAD_USERS_FILE=env/.out/accounts.json SSE_CONNECTIONS=50 \
//   SSE_DURATION_MS=600000 SSE_RESULT_FILE=results/sse.json node load-tests/sse-probe.mjs
import fs from "node:fs/promises";

import { collectAccountViolations, collectTargetViolations, failOnViolations } from "./env/isolation.mjs";
import { sessionCookieFrom, sessionHeaders } from "./session.js";

const baseUrl = String(process.env.BASE_URL || "").replace(/\/$/, "");
const usersFile = process.env.LOAD_USERS_FILE || new URL("./env/.out/accounts.json", import.meta.url);
const connections = Number(process.env.SSE_CONNECTIONS || 10);
const durationMs = Number(process.env.SSE_DURATION_MS || 600000);
const origin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";

const accounts = JSON.parse(await fs.readFile(usersFile, "utf8")).filter((account) => account.role !== "admin");
failOnViolations([...collectTargetViolations(baseUrl), ...collectAccountViolations(accounts)], "el sondeo SSE");
const metrics = { attempted: connections, commentEventsByProject: {}, connected: 0, earlyCloses: 0, events: 0, failures: 0, failuresByStatus: {} };

/**
 * Inicia sesión y devuelve la cookie de sesión.
 *
 * @param {object} account - Cuenta ficticia.
 * @returns {Promise<string>} Par `nombre=valor` de la cookie.
 */
async function login(account) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  if (!response.ok) throw new Error(`Login ${account.email}: HTTP ${response.status}`);
  // La sesión llega solo en la cookie HttpOnly (P0-4); el cuerpo no contiene token.
  const cookie = sessionCookieFrom(response.headers.getSetCookie());
  if (!cookie) throw new Error(`Login ${account.email}: sin cookie de sesión`);
  return cookie;
}

/**
 * Mantiene una conexión SSE y cuenta sus eventos hasta que se agota el tiempo.
 *
 * @param {number} index - Índice de la conexión.
 * @param {AbortSignal} signal - Señal de fin de la prueba.
 * @returns {Promise<void>}
 */
async function connect(index, signal) {
  const account = accounts[index % accounts.length];
  const projectId = account.projectId;
  try {
    const cookie = await login(account);
    const response = await fetch(`${baseUrl}/api/projects/${projectId}/events`, {
      headers: sessionHeaders(cookie, origin, { Accept: "text/event-stream" }), signal,
    });
    if (!response.ok || !response.body) {
      metrics.failuresByStatus[response.status] = (metrics.failuresByStatus[response.status] || 0) + 1;
      throw new Error(`SSE HTTP ${response.status}`);
    }
    metrics.connected += 1;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) { metrics.earlyCloses += 1; break; }
      buffer += decoder.decode(value, { stream: true });
      const messages = buffer.split("\n\n");
      buffer = messages.pop();
      for (const message of messages) {
        if (!message.includes("data:")) continue;
        metrics.events += 1;
        if (message.includes("event: project.comment.created")) {
          metrics.commentEventsByProject[projectId] = (metrics.commentEventsByProject[projectId] || 0) + 1;
        }
      }
    }
  } catch (error) {
    if (error.name !== "AbortError") { metrics.failures += 1; console.error(error.message); }
  }
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), durationMs);
await Promise.all(Array.from({ length: connections }, (_, index) => connect(index, controller.signal)));
clearTimeout(timeout);
// Varias conexiones pueden seguir el mismo proyecto: los eventos se cuentan una vez por conexión.
const summary = { connectionsPerProject: {}, durationMs, type: "sse_summary", ...metrics };
for (let index = 0; index < connections; index += 1) {
  const projectId = accounts[index % accounts.length].projectId;
  summary.connectionsPerProject[projectId] = (summary.connectionsPerProject[projectId] || 0) + 1;
}
console.log(JSON.stringify(summary, null, 2));
if (process.env.SSE_RESULT_FILE) await fs.writeFile(process.env.SSE_RESULT_FILE, JSON.stringify(summary, null, 2));
if (metrics.connected !== connections || metrics.failures || metrics.earlyCloses) process.exitCode = 1;
