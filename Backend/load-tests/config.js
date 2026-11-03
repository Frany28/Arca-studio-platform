// Configuración común de las pruebas de carga con k6 (P0-4, Fase 3).
//
// Ejecutar SOLO contra el entorno aislado (load-tests/env): el destino debe ser local y las cuentas
// ficticias (@loadtest.invalid); si no, setup() se detiene antes de enviar ninguna petición de carga.
// Variables:
//   BASE_URL          URL del backend (http://backend:3000 en docker compose, http://127.0.0.1:3000 local).
//   FRONTEND_ORIGIN   Origen permitido por CORS/CSRF (http://localhost:5173 por defecto).
//   LOAD_USERS_FILE   Cuentas generadas por env/seed.mjs: [{ email, password, role, projectId, fileId,
//                     notificationProjectIds }]. Una cuenta por usuario virtual como mínimo.
//   PROFILE           Escenario (ver scenarios()): A | B | C | D | E | F | G | H, o smoke.
//   DURATION          Duración de los escenarios de usuarios constantes (10m por defecto; E: 60m).
//
// Métricas: http_reqs (peticiones por segundo) y vus (usuarios virtuales) son distintas y ambas se
// registran. 429 cuenta como límite (`rate_limited`), 503 como saturación (`saturated`), 401/403 como
// fallo de autenticación del arnés (`auth_failures`, debe ser 0) y los 5xx restantes y fallos de red
// como `system_errors`. Cada petición lleva las etiquetas `endpoint` y `kind` (json, write, file).
import http from "k6/http";
import { Counter, Rate } from "k6/metrics";

import { classifyStatus, sessionCookieFrom, sessionHeaders } from "./session.js";

export const rateLimited = new Counter("rate_limited");
export const saturated = new Counter("saturated");
export const authFailures = new Counter("auth_failures");
export const systemErrors = new Rate("system_errors");
export const commentsCreated = new Counter("comments_created");

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]", "backend"];

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
 * Lee las cuentas de prueba y comprueba que son ficticias.
 *
 * @returns {Array<object>} Cuentas.
 */
export function users() {
  const parsed = JSON.parse(open(__ENV.LOAD_USERS_FILE || "./fixtures/users.example.json"));
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("LOAD_USERS_FILE must contain a non-empty JSON array");
  const real = parsed.filter((account) => !String(account.email || "").toLowerCase().endsWith("@loadtest.invalid"));
  if (real.length) throw new Error(`${real.length} cuentas no son ficticias (@loadtest.invalid): prueba cancelada`);
  return parsed;
}

/**
 * Detiene la prueba si el destino no es el backend local del entorno aislado.
 *
 * @param {string} baseUrl - URL del backend.
 * @returns {void}
 */
export function assertLocalTarget(baseUrl) {
  const host = (baseUrl.match(/^https?:\/\/([^/:]+|\[[^\]]+\])/) || [])[1];
  if (!LOCAL_HOSTS.includes(host)) throw new Error(`BASE_URL no es local (${host}): prueba cancelada`);
}

const BASE_THRESHOLDS = {
  auth_failures: ["count==0"],
  "http_req_duration{kind:json}": ["p(95)<800", "p(99)<1500"],
  "http_req_duration{kind:write}": ["p(95)<1500"],
  system_errors: ["rate<0.01"],
};

// p50 (med), p95 y p99 en el resumen final de k6.
export const summaryTrendStats = ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max", "count"];

// 429 es un límite legítimo: no cuenta en http_req_failed (se mide aparte en rate_limited).
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 429));

/**
 * Escenarios y umbrales del perfil pedido.
 *   A, B, C, D: 10, 25, 50 y 100 usuarios constantes (DURATION, 10m).
 *   E: 50 usuarios durante 60 minutos (crecimiento de memoria y estabilidad).
 *   F, G: perfiles de file-workload.js y comments-workload.js (25 usuarios por defecto).
 *   H: saturación (pico de 150 usuarios) seguida de una fase de recuperación con 5 usuarios, cada una
 *      con sus umbrales; el backend debe arrancar con el pool reducido (ver env/README.md).
 *
 * @param {string} [profile] - Perfil.
 * @returns {{ scenarios: object, thresholds: object }} Opciones de k6.
 */
export function profileOptions(profile = __ENV.PROFILE || "smoke") {
  const duration = __ENV.DURATION || "10m";
  const constant = (vus, time = duration) => ({ scenarios: { main: { duration: time, executor: "constant-vus", vus } }, thresholds: BASE_THRESHOLDS });
  const profiles = {
    A: constant(10),
    B: constant(25),
    C: constant(50),
    D: constant(100),
    E: constant(Number(__ENV.SOAK_VUS || 50), __ENV.DURATION || "60m"),
    F: constant(Number(__ENV.VUS || 25)),
    G: constant(Number(__ENV.VUS || 25)),
    H: {
      scenarios: {
        recovery: { duration: "3m", executor: "constant-vus", startTime: "4m", vus: 5 },
        spike: { executor: "ramping-vus", stages: [{ duration: "30s", target: 150 }, { duration: "3m", target: 150 }, { duration: "15s", target: 0 }] },
      },
      thresholds: {
        auth_failures: ["count==0"],
        // En el pico se esperan 503 controlados, no 500 ni caídas.
        "system_errors{scenario:spike}": ["rate<0.01"],
        // Tras el pico, el servicio vuelve a la normalidad.
        "http_req_duration{scenario:recovery}": ["p(95)<800"],
        "http_req_failed{scenario:recovery}": ["rate<0.01"],
        "system_errors{scenario:recovery}": ["rate<0.001"],
      },
    },
    smoke: constant(2, "1m"),
  };
  if (!profiles[profile]) throw new Error(`Unknown PROFILE ${profile}`);
  return profiles[profile];
}

/**
 * Inicia sesión una vez por cuenta y comprueba que la cookie autentica de verdad.
 * Aborta antes de medir si el destino no es local o alguna cuenta no obtiene sesión.
 *
 * @param {string} baseUrl - URL del backend.
 * @param {Array<object>} accounts - Cuentas de prueba.
 * @returns {Array<object>} Cuentas con su cookie de sesión.
 */
export function login(baseUrl, accounts) {
  assertLocalTarget(baseUrl);
  const origin = __ENV.FRONTEND_ORIGIN || "http://localhost:5173";
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
