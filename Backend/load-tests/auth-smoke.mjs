// Comprobación previa del arnés (P0-4, Fase 3): ejecuta con Node el mismo flujo que k6 con una cuenta
// de cada rol para confirmar cookies, Origin (CSRF), autenticación y separación de roles antes de medir.
//   BASE_URL=http://127.0.0.1:3000 LOAD_USERS_FILE=load-tests/env/.out/accounts.json node load-tests/auth-smoke.mjs
// Solo contra el entorno aislado (destino local, cuentas @loadtest.invalid). Crea un comentario por
// cuenta de cliente o arquitecto.
import fs from "node:fs/promises";

import { collectAccountViolations, collectTargetViolations, failOnViolations } from "./env/isolation.mjs";
import { classifyStatus, sessionCookieFrom, sessionHeaders } from "./session.js";

const baseUrl = String(process.env.BASE_URL || "").replace(/\/$/, "");
const origin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const usersFile = process.env.LOAD_USERS_FILE || new URL("./env/.out/accounts.json", import.meta.url);
const allAccounts = JSON.parse(await fs.readFile(usersFile, "utf8"));
failOnViolations([...collectTargetViolations(baseUrl), ...collectAccountViolations(allAccounts)], "la comprobación del arnés");
const roles = [...new Set(allAccounts.map((account) => account.role || "client"))];
const accounts = roles.map((role) => allAccounts.find((account) => (account.role || "client") === role));

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
  const role = account.role || "client";
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
    await step(steps, "rutas de administración según el rol", fetch(`${baseUrl}/api/admin/quotes?limit=5`, { headers }), role === "admin" ? 200 : 403);
    if (role !== "admin") {
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
      // SMOKE_SKIP_DOWNLOADS=1 solo cuando el entorno no tiene MinIO (comprobación local sin almacenamiento).
      if (account.fileId && process.env.SMOKE_SKIP_DOWNLOADS !== "1") {
        await step(steps, "descarga parcial", fetch(`${baseUrl}/api/projects/${account.projectId}/files/${account.fileId}/content`, { headers: { ...headers, Range: "bytes=0-1023" } }), [200, 206]);
      } else if (account.fileId) {
        steps.push({ name: "descarga parcial (omitida: sin almacenamiento)", ok: true, outcome: "skipped" });
      }
    }
    await step(steps, "escritura sin Origin rechazada (CSRF)", fetch(`${baseUrl}/api/projects/${account.projectId}/comments`, {
      body: JSON.stringify({ commentType: "general", content: "sin origen" }),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      method: "POST",
    }), 403);
  }
  await step(steps, "sin cookie: 401", fetch(`${baseUrl}/api/auth/me`), 401);
  results.push({ account: account.email, ok: steps.every((entry) => entry.ok), role, steps });
}

console.log(JSON.stringify({ results, type: "load_auth_smoke" }, null, 2));
if (!results.every((result) => result.ok)) process.exitCode = 1;
