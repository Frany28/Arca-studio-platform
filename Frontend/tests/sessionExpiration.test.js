import assert from "node:assert/strict";
import test from "node:test";

import { apiRequest, onSessionExpired } from "../src/api/client.js";
import {
  isSessionExpiredResponse,
  reportSessionExpiration,
} from "../src/api/sessionExpiration.js";
import {
  AUTH_SESSION_STATUS,
  createSessionExpirationHandler,
} from "../src/auth/authSession.js";

/**
 * Sustituye fetch por una respuesta JSON fija durante una prueba.
 *
 * @param {import("node:test").TestContext} context - Contexto que restaura fetch.
 * @param {number} status - Estado HTTP simulado.
 * @param {object} body - Cuerpo JSON simulado.
 * @returns {void}
 */
function mockFetch(context, status, body) {
  context.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  }));
}

test("solo 401 UNAUTHENTICATED se considera sesión expirada; 403 es falta de permisos", () => {
  assert.equal(isSessionExpiredResponse(401, "UNAUTHENTICATED"), true);
  assert.equal(isSessionExpiredResponse(403, "FORBIDDEN"), false);
  assert.equal(isSessionExpiredResponse(401, "CURRENT_PASSWORD_INCORRECT"), false);
  assert.equal(isSessionExpiredResponse(401, "INVALID_CREDENTIALS"), false);
  assert.equal(isSessionExpiredResponse(500, "UNAUTHENTICATED"), false);
});

test("las rutas que gestionan su propio 401 no disparan la expiración global", (context) => {
  const listener = context.mock.fn();
  const unsubscribe = onSessionExpired(listener);
  context.after(unsubscribe);

  for (const path of ["/auth/me", "/auth/login", "/auth/logout", "/auth/me?retry=1"]) {
    assert.equal(reportSessionExpiration({ code: "UNAUTHENTICATED", path, status: 401 }), false, path);
  }
  assert.equal(listener.mock.callCount(), 0);

  assert.equal(reportSessionExpiration({ code: "UNAUTHENTICATED", path: "/projects?limit=10", status: 401 }), true);
  assert.deepEqual(listener.mock.calls[0].arguments, [{ path: "/projects" }]);
});

test("apiRequest notifica la expiración en 401 UNAUTHENTICATED y sigue rechazando la petición", async (context) => {
  const listener = context.mock.fn();
  context.after(onSessionExpired(listener));
  mockFetch(context, 401, { code: "UNAUTHENTICATED", message: "Sesión requerida." });

  await assert.rejects(apiRequest("/projects"), (error) => error.status === 401 && error.code === "UNAUTHENTICATED");
  assert.equal(listener.mock.callCount(), 1);
});

test("apiRequest no notifica expiración ante 403 ni ante 401 de contraseña actual", async (context) => {
  const listener = context.mock.fn();
  context.after(onSessionExpired(listener));

  mockFetch(context, 403, { code: "FORBIDDEN", message: "No tienes permisos." });
  await assert.rejects(apiRequest("/admin/users"), (error) => error.status === 403);
  context.mock.restoreAll();
  mockFetch(context, 401, { code: "CURRENT_PASSWORD_INCORRECT", message: "Incorrecta." });
  await assert.rejects(apiRequest("/auth/change-password", { method: "POST" }), (error) => error.status === 401);

  assert.equal(listener.mock.callCount(), 0);
});

test("un oyente que falla no impide notificar a los demás", (context) => {
  context.mock.method(console, "error", () => {});
  const second = context.mock.fn();
  context.after(onSessionExpired(() => { throw new Error("boom"); }));
  context.after(onSessionExpired(second));
  reportSessionExpiration({ code: "UNAUTHENTICATED", path: "/projects", status: 401 });
  assert.equal(second.mock.callCount(), 1);
});

/**
 * Crea un manejador de expiración con un restaurador simulado y estado observable.
 *
 * @param {object} restoreResult - Resultado (o error) que devolverá el restaurador.
 * @returns {object} Manejador, estado y contadores.
 */
function setupHandler(restoreResult) {
  const state = { authenticated: true, confirmedUser: null, expiredCalls: 0, restoreCalls: 0 };
  let inFlight = null;
  const restorer = {
    restore() {
      state.restoreCalls += 1;
      inFlight ||= restoreResult instanceof Error
        ? Promise.reject(restoreResult)
        : Promise.resolve(restoreResult);
      return inFlight;
    },
  };
  const handle = createSessionExpirationHandler({
    isAuthenticated: () => state.authenticated,
    onConfirmedUser: (user) => { state.confirmedUser = user; },
    onExpired: () => { state.authenticated = false; state.expiredCalls += 1; },
    restorer,
  });
  return { handle, state };
}

test("401 confirmado por /auth/me limpia la sesión una sola vez aunque lleguen varios a la vez", async () => {
  const { handle, state } = setupHandler({ status: AUTH_SESSION_STATUS.UNAUTHENTICATED, user: null });
  const results = await Promise.all([handle(), handle(), handle()]);
  assert.equal(state.expiredCalls, 1);
  assert.deepEqual(results.sort(), ["expired", "ignored", "ignored"].sort());
});

test("un 401 tardío de una sesión anterior no expulsa a quien ya inició sesión de nuevo", async () => {
  const user = { id: 7 };
  const { handle, state } = setupHandler({ status: AUTH_SESSION_STATUS.AUTHENTICATED, user });
  assert.equal(await handle(), "active");
  assert.equal(state.expiredCalls, 0);
  assert.equal(state.confirmedUser, user);
});

test("una caída temporal del backend no se trata como revocación", async () => {
  const { handle, state } = setupHandler({ status: AUTH_SESSION_STATUS.TEMPORARILY_UNAVAILABLE, user: null });
  assert.equal(await handle(), "unavailable");
  assert.equal(state.expiredCalls, 0);
});

test("sin sesión local o con la comprobación cancelada no se hace nada", async () => {
  const anonymous = setupHandler({ status: AUTH_SESSION_STATUS.UNAUTHENTICATED, user: null });
  anonymous.state.authenticated = false;
  assert.equal(await anonymous.handle(), "ignored");
  assert.equal(anonymous.state.restoreCalls, 0, "no consulta /auth/me: evita bucles en vistas públicas");

  const cancelled = setupHandler(new DOMException("Aborted", "AbortError"));
  assert.equal(await cancelled.handle(), "cancelled");
  assert.equal(cancelled.state.expiredCalls, 0);
});
