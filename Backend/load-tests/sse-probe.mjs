import fs from "node:fs/promises";

import { sessionCookieFrom, sessionHeaders } from "./session.js";

const baseUrl = String(process.env.BASE_URL || "").replace(/\/$/, "");
const usersFile = process.env.LOAD_USERS_FILE || new URL("./fixtures/users.example.json", import.meta.url);
const connections = Number(process.env.SSE_CONNECTIONS || 10);
const durationMs = Number(process.env.SSE_DURATION_MS || 600000);
const origin = process.env.FRONTEND_ORIGIN || baseUrl;

if (!baseUrl) throw new Error("BASE_URL is required");
const accounts = JSON.parse(await fs.readFile(usersFile, "utf8"));
const metrics = { attempted: connections, connected: 0, events: 0, failures: 0, earlyCloses: 0 };

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

async function connect(index, signal) {
  const account = accounts[index % accounts.length];
  try {
    const cookie = await login(account);
    const response = await fetch(`${baseUrl}/api/projects/${account.projectId}/events`, {
      headers: sessionHeaders(cookie, origin, { Accept: "text/event-stream" }), signal,
    });
    if (!response.ok || !response.body) throw new Error(`SSE HTTP ${response.status}`);
    metrics.connected += 1;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) { metrics.earlyCloses += 1; break; }
      metrics.events += (decoder.decode(value, { stream: true }).match(/\n\n/g) || []).length;
    }
  } catch (error) {
    if (error.name !== "AbortError") { metrics.failures += 1; console.error(error.message); }
  }
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), durationMs);
await Promise.all(Array.from({ length: connections }, (_, index) => connect(index, controller.signal)));
clearTimeout(timeout);
console.log(JSON.stringify({ type: "sse_summary", durationMs, ...metrics }, null, 2));
if (metrics.connected !== connections || metrics.failures || metrics.earlyCloses) process.exitCode = 1;
