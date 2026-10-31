// Comprobación previa del arnés (P0-4): ejecuta con Node el mismo flujo que las pruebas de k6 para
// confirmar que la autenticación por cookie y la protección CSRF funcionan antes de medir.
//   BASE_URL=http://localhost:3000 LOAD_USERS_FILE=./fixtures/users.json node load-tests/auth-smoke.mjs
// Solo contra un entorno local o aislado. Crea un comentario por cuenta.
import fs from "node:fs/promises";

import { classifyStatus, sessionCookieFrom, sessionHeaders } from "./session.js";

const baseUrl = String(process.env.BASE_URL || "").replace(/\/$/, "");
const origin = process.env.FRONTEND_ORIGIN || baseUrl;
const usersFile = process.env.LOAD_USERS_FILE || new URL("./fixtures/users.example.json", import.meta.url);
if (!baseUrl) throw new Error("BASE_URL is required");
const accounts = JSON.parse(await fs.readFile(usersFile, "utf8"));

/**
 * Ejecuta un paso y registra su estado y su clase.
 *
 * @param {Array<object>} steps - Registro de pasos.
 * @param {string} name - Paso.
 * @param {Promise<Response>} request - Petición en curso.
 * @param {number|Array<number>} expected - Estado o estados esperados.
 * @returns {Promise<Response>} Respuesta.
 */
async function step(steps, name, request, expected) {
  const response = await request;
  const accepted = [expected].flat().includes(response.status);
  steps.push({ name, ok: accepted, outcome: classifyStatus(response.status), status: response.status });
  return response;
}

const results = [];
for (const account of accounts) {
  const steps = [];
  const login = await step(steps, "login", fetch(`${baseUrl}/api/auth/login`, {
    body: JSON.stringify({ email: account.email, password: account.password }),
    headers: { "Content-Type": "application/json", Origin: origin },
    method: "POST",
  }), 200);
  const loginBody = await login.json().catch(() => ({}));
  const cookie = sessionCookieFrom(login.headers.getSetCookie());
  steps.push({ name: "cookie de sesión", ok: Boolean(cookie), outcome: cookie ? "ok" : "auth_failure" });
  steps.push({ name: "sin token en el cuerpo", ok: !("token" in loginBody), outcome: "ok" });
  if (cookie) {
    const headers = sessionHeaders(cookie, origin);
    await step(steps, "sesión /me", fetch(`${baseUrl}/api/auth/me`, { headers }), 200);
    await step(steps, "lista de proyectos", fetch(`${baseUrl}/api/projects`, { headers }), 200);
    const first = await step(steps, "comentarios (completo)", fetch(`${baseUrl}/api/projects/${account.projectId}/comments?limit=100`, { headers }), 200);
    const { syncCursor } = await first.json().catch(() => ({}));
    await step(steps, "comentario (con Origin)", fetch(`${baseUrl}/api/projects/${account.projectId}/comments`, {
      body: JSON.stringify({ commentType: "general", content: `Prueba de arnés ${Date.now()}` }),
      headers: { ...headers, "Content-Type": "application/json" },
      method: "POST",
    }), [201, 429]);
    if (syncCursor) {
      const incremental = await step(steps, "comentarios (incremental)", fetch(`${baseUrl}/api/projects/${account.projectId}/comments?limit=100&cursor=${encodeURIComponent(syncCursor)}`, { headers }), 200);
      const { comments = [] } = await incremental.json().catch(() => ({}));
      steps.push({ count: comments.length, name: "incremental incluye el comentario nuevo", ok: comments.some((comment) => String(comment.content).startsWith("Prueba de arnés")), outcome: "ok" });
    }
    await step(steps, "escritura sin Origin rechazada (CSRF)", fetch(`${baseUrl}/api/projects/${account.projectId}/comments`, {
      body: JSON.stringify({ commentType: "general", content: "sin origen" }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "POST",
    }), 403);
  }
  await step(steps, "sin cookie: 401", fetch(`${baseUrl}/api/auth/me`), 401);
  results.push({ account: account.email, ok: steps.every((entry) => entry.ok), steps });
}

console.log(JSON.stringify({ results, type: "load_auth_smoke" }, null, 2));
if (!results.every((result) => result.ok)) process.exitCode = 1;
