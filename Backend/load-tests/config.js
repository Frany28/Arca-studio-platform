// Configuración común de las pruebas de carga con k6 (P0-4).
//
// Ejecutar SOLO contra un entorno local o aislado con datos desechables, nunca contra producción ni
// Supabase real. Variables:
//   BASE_URL          URL del backend (o del proxy del frontend).
//   FRONTEND_ORIGIN   Origen permitido por CORS/CSRF (por defecto, BASE_URL).
//   LOAD_USERS_FILE   JSON con cuentas de prueba: [{ email, password, projectId, fileId }].
//                     Usar al menos una cuenta por usuario virtual: los límites son por cuenta
//                     (login 20/h, comentarios 30/min, subidas 60/10 min). En un entorno de pruebas
//                     pueden subirse con COMMENT_RATE_LIMIT_MAX, UPLOAD_RATE_LIMIT_MAX, etc.
//   PROFILE           smoke | c10 | c25 | c50 | c100 | ramp | soak | spike (por defecto, smoke).
//   DURATION          Duración de los perfiles cNN (por defecto, 10m).
//
// El login se hace una vez por cuenta en setup(), se comprueba con /api/auth/me y la sesión viaja
// en la cookie (ver session.js). 429 cuenta como límite legítimo (`rate_limited`), 503 como
// saturación controlada (`saturated`) y 401/403 como fallo de autenticación del arnés, que aborta
// los resultados (`auth_failures` debe ser 0).
import http from "k6/http";
import { Counter, Rate } from "k6/metrics";

import { classifyStatus, sessionCookieFrom, sessionHeaders } from "./session.js";

export const rateLimited = new Counter("rate_limited");
export const saturated = new Counter("saturated");
export const authFailures = new Counter("auth_failures");
export const systemErrors = new Rate("system_errors");

/**
 * Lee una variable obligatoria del entorno de k6.
 *
 * @param {string} name - Variable.
 * @returns {string} Valor sin barra final.
 */
export function required(name) {
  const value = __ENV[name];
  if (!value) throw new Error(`${name} is required`);
  return value.replace(/\/$/, "");
}

/**
 * Lee las cuentas de prueba del archivo indicado.
 *
 * @returns {Array<object>} Cuentas.
 */
export function users() {
  const parsed = JSON.parse(open(__ENV.LOAD_USERS_FILE || "./fixtures/users.example.json"));
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("LOAD_USERS_FILE must contain a non-empty JSON array");
  return parsed;
}

export const thresholds = {
  auth_failures: ["count==0"],
  checks: ["rate>0.99"],
  "http_req_duration{kind:json}": ["p(95)<800", "p(99)<1500"],
  "http_req_duration{kind:write}": ["p(95)<1500"],
  http_req_failed: ["rate<0.01"],
  system_errors: ["rate<0.01"],
};

// p50/p95/p99 en el resumen final de k6.
export const summaryTrendStats = ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"];

// 429 es un límite legítimo: no cuenta en http_req_failed (se mide aparte en rate_limited).
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429));

/**
 * Escenarios de carga según el perfil pedido.
 *
 * @param {string} [profile] - Perfil.
 * @returns {object} Escenarios de k6.
 */
export function scenarios(profile = __ENV.PROFILE || "smoke") {
  const duration = __ENV.DURATION || "10m";
  const constant = (vus) => ({ main: { duration, executor: "constant-vus", vus } });
  const profiles = {
    c10: constant(10),
    c25: constant(25),
    c50: constant(50),
    c100: constant(100),
    ramp: {
      main: {
        executor: "ramping-vus",
        stages: [
          { duration: "1m", target: 10 }, { duration: "10m", target: 10 },
          { duration: "1m", target: 25 }, { duration: "10m", target: 25 },
          { duration: "1m", target: 50 }, { duration: "10m", target: 50 },
          { duration: "1m", target: 100 }, { duration: "10m", target: 100 },
          { duration: "2m", target: 0 },
        ],
      },
    },
    smoke: { main: { duration: "1m", executor: "constant-vus", vus: 2 } },
    soak: { main: { duration: __ENV.DURATION || "60m", executor: "constant-vus", vus: Number(__ENV.SOAK_VUS || 50) } },
    spike: { main: { executor: "ramping-vus", stages: [{ duration: "30s", target: 100 }, { duration: "3m", target: 100 }, { duration: "30s", target: 0 }] } },
  };
  if (!profiles[profile]) throw new Error(`Unknown PROFILE ${profile}`);
  return profiles[profile];
}

/**
 * Inicia sesión una vez por cuenta y comprueba que la cookie autentica de verdad.
 * Aborta antes de medir si alguna cuenta no obtiene sesión: evita resultados falsos por 401.
 *
 * @param {string} baseUrl - URL del backend.
 * @param {Array<object>} accounts - Cuentas de prueba.
 * @returns {Array<object>} Cuentas con su cookie de sesión.
 */
export function login(baseUrl, accounts) {
  const origin = __ENV.FRONTEND_ORIGIN || baseUrl;
  return accounts.map((account) => {
    const response = http.post(`${baseUrl}/api/auth/login`, JSON.stringify({ email: account.email, password: account.password }), {
      headers: { "Content-Type": "application/json", Origin: origin },
      tags: { endpoint: "login", kind: "write" },
    });
    if (response.status !== 200) throw new Error(`Login failed for ${account.email}: HTTP ${response.status}`);
    const cookie = sessionCookieFrom(response.headers["Set-Cookie"]);
    if (!cookie) throw new Error(`Login for ${account.email} did not set the session cookie`);
    const me = http.get(`${baseUrl}/api/auth/me`, { headers: sessionHeaders(cookie, origin) });
    if (me.status !== 200) throw new Error(`Session check failed for ${account.email}: HTTP ${me.status}`);
    return { ...account, cookie };
  });
}

/**
 * Registra la clase de una respuesta en las métricas propias del arnés.
 *
 * @param {object} response - Respuesta de k6.
 * @returns {string} Clase de la respuesta.
 */
export function track(response) {
  const outcome = classifyStatus(response.status);
  if (outcome === "rate_limited") rateLimited.add(1);
  if (outcome === "saturated") saturated.add(1);
  if (outcome === "auth_failure") authFailures.add(1);
  systemErrors.add(outcome === "server_error" || outcome === "network_error");
  return outcome;
}
