import assert from "node:assert/strict";
import { createRateLimitQueryMock } from "./helpers/rateLimitQueryMock.js";
import { createSessionStoreMock, mockPoolTransactions } from "./helpers/sessionStoreMock.js";
import test from "node:test";
import bcrypt from "bcrypt";

// El transporte simulado nunca consulta la base configurada ni requiere dotenv.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.AUTH_TOKEN_SECRET = "test-secret-with-sufficient-entropy";
process.env.ROUTE_AUTH_DISABLED_FOR_TESTS = "false";
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = "100";

const { pool } = await import("../src/config/db.js");
const { default: app } = await import("../src/app.js");
const { authConfig } = await import("../src/config/auth.js");
const { createPasswordResetPayload } = await import("../src/services/passwordResetEmailService.js");
const { createAuthToken, isSessionTokenPayload } = await import("../src/utils/tokens.js");

const PASSWORD = "Segura2026*";
const passwordHash = await bcrypt.hash(PASSWORD, 4);

/**
 * Construye la fila que devuelve la consulta compartida de usuarios para una cuenta activa.
 *
 * @returns {object} Fila con el formato de `USER_SELECT`.
 */
function userRow() {
  return {
    client_id: "3",
    email: "cliente@arca.test",
    first_name: "Cliente",
    id: "7",
    last_login_at: null,
    last_name: "Prueba",
    password_hash: passwordHash,
    permissions: [],
    phone: null,
    profile_photo_url: null,
    role_code: "client",
    role_id: "3",
    role_name: "Cliente",
    status: "active",
    updated_at: new Date(Date.now() - 60_000).toISOString(),
  };
}

/**
 * Sustituye `pool.query` por respuestas mínimas para usuarios, sesiones (B-3) y tokens de recuperación.
 *
 * @param {import("node:test").TestContext} context - Contexto que restaura el mock.
 * @returns {{ calls: Array<string>, sessionStore: object }} Consultas recibidas y sesiones simuladas.
 */
function mockDatabase(context) {
  const calls = [];
  const rateLimitQueries = createRateLimitQueryMock();
  const sessionStore = createSessionStoreMock();
  mockPoolTransactions(context, pool);
  context.mock.method(pool, "query", async (sql, params) => {
    // Contador compartido de B-2 (no cuenta como consulta de negocio).
    const rateLimited = rateLimitQueries.handle(sql, params);
    if (rateLimited) return rateLimited;
    calls.push(sql);
    const sessionResult = sessionStore.handle(sql, params);
    if (sessionResult) return sessionResult;
    if (sql.includes("from public.users u")) {
      const rows = sessionStore.filterSessionUserRows(sql, params, [userRow()]);
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("update public.users")) return { rows: [], rowCount: 1 };
    if (sql.includes("from public.password_recovery_tokens")) {
      return { rows: [{ expires_at: new Date(Date.now() + 60_000), id: 1 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  return { calls, sessionStore };
}

/**
 * Inicia la aplicación real en un puerto efímero y devuelve un cliente HTTP mínimo.
 *
 * @param {import("node:test").TestContext} context - Contexto que cierra el servidor.
 * @returns {Promise<Function>} Función `request(path, init)` contra el servidor.
 */
async function startServer(context) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return (path, init = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, init);
}

/**
 * Firma un token con el mismo secreto y vigencia que usa el backend para las sesiones.
 *
 * @param {object} payload - Claims del token.
 * @returns {string} Token compacto firmado.
 */
function signToken(payload) {
  return createAuthToken(payload, { expiresInSeconds: 600, secret: authConfig.tokenSecret });
}

/**
 * Extrae el token de sesión de la URL de recuperación enviada por correo.
 *
 * @param {string} resetUrl - Enlace generado por `createPasswordResetPayload`.
 * @returns {string} Token incluido en el parámetro `token`.
 */
function tokenFromResetUrl(resetUrl) {
  return new URL(resetUrl).searchParams.get("token");
}

const SESSION_ID = "0b6f3c9e-6d5a-4c1e-9a43-6f1a2b3c4d5e";

test("solo los payloads sin propósito, con usuario y con sid UUID se consideran sesiones", () => {
  assert.equal(isSessionTokenPayload({ sid: SESSION_ID, sub: "7" }), true);
  for (const purpose of ["password_reset", "user_registration", "session", "", null, undefined]) {
    assert.equal(isSessionTokenPayload({ purpose, sid: SESSION_ID, sub: "7" }), false, `purpose=${purpose}`);
  }
  assert.equal(isSessionTokenPayload({ role: "client", sub: "7" }), false, "JWT anterior a B-3 sin sid");
  for (const sid of ["", "no-es-uuid", 7, null, `${SESSION_ID}x`]) {
    assert.equal(isSessionTokenPayload({ sid, sub: "7" }), false, `sid=${sid}`);
  }
  assert.equal(isSessionTokenPayload({ sid: SESSION_ID, sub: "7 or 1=1" }), false);
  assert.equal(isSessionTokenPayload({ role: "admin" }), false);
  assert.equal(isSessionTokenPayload(null), false);
});

test("un JWT de recuperación válido recibe 401 en /api/auth/me por Bearer y por cookie", async (context) => {
  const { calls } = mockDatabase(context);
  const request = await startServer(context);
  const resetToken = tokenFromResetUrl(createPasswordResetPayload({ email: "cliente@arca.test", id: 7 }).resetUrl);

  for (const headers of [
    { Authorization: `Bearer ${resetToken}` },
    { Cookie: `${authConfig.cookieName}=${resetToken}` },
  ]) {
    const response = await request("/api/auth/me", { headers });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "UNAUTHENTICATED");
  }
  assert.equal(calls.length, 0, "el token rechazado no debe consultar al usuario");
});

test("cualquier otro token de un solo uso con sujeto recibe 401", async (context) => {
  mockDatabase(context);
  const request = await startServer(context);
  for (const purpose of ["user_registration", "email_change", "session"]) {
    const response = await request("/api/auth/me", {
      headers: { Authorization: `Bearer ${signToken({ purpose, sub: "7" })}` },
    });
    assert.equal(response.status, 401, `purpose=${purpose}`);
  }
});

test("un JWT de sesión anterior a B-3 (sin sid) recibe 401 sin consultar la base", async (context) => {
  const { calls } = mockDatabase(context);
  const request = await startServer(context);
  const legacyToken = signToken({ email: "cliente@arca.test", role: "client", sub: "7" });

  for (const headers of [
    { Authorization: `Bearer ${legacyToken}` },
    { Cookie: `${authConfig.cookieName}=${legacyToken}` },
  ]) {
    const response = await request("/api/auth/me", { headers });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "UNAUTHENTICATED");
  }
  assert.equal(calls.length, 0);
});

test("un token con sid de una sesión activa autentica; con sid desconocido recibe 401", async (context) => {
  const { sessionStore } = mockDatabase(context);
  const request = await startServer(context);
  const session = sessionStore.create(7);

  const active = await request("/api/auth/me", {
    headers: { Cookie: `${authConfig.cookieName}=${signToken({ sid: session.id, sub: "7" })}` },
  });
  assert.equal(active.status, 200);
  assert.equal((await active.json()).user.id, 7);

  const unknown = await request("/api/auth/me", {
    headers: { Cookie: `${authConfig.cookieName}=${signToken({ sid: SESSION_ID, sub: "7" })}` },
  });
  assert.equal(unknown.status, 401);
});

test("un token con sid y purpose sigue rechazándose aunque la sesión exista", async (context) => {
  const { sessionStore } = mockDatabase(context);
  const request = await startServer(context);
  const session = sessionStore.create(7);
  const response = await request("/api/auth/me", {
    headers: { Authorization: `Bearer ${signToken({ purpose: "password_reset", sid: session.id, sub: "7" })}` },
  });
  assert.equal(response.status, 401);
});

test("el login emite una sesión que /api/auth/me acepta", async (context) => {
  mockDatabase(context);
  const request = await startServer(context);
  const login = await request("/api/auth/login", {
    body: JSON.stringify({ email: "cliente@arca.test", password: PASSWORD }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];

  const me = await request("/api/auth/me", { headers: { Cookie: cookie } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.email, "cliente@arca.test");
});

test("el token de recuperación sigue siendo válido para su propio flujo", async (context) => {
  mockDatabase(context);
  const request = await startServer(context);
  const resetToken = tokenFromResetUrl(createPasswordResetPayload({ email: "cliente@arca.test", id: 7 }).resetUrl);
  const post = (path, body) => request(path, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  const verified = await post("/api/auth/verify-reset-token", { token: resetToken });
  assert.equal(verified.status, 200);
  assert.deepEqual(await verified.json(), { valid: true });

  const reset = await post("/api/auth/reset-password", { password: "Nueva2026*", token: resetToken });
  assert.equal(reset.status, 200);

  const sessionAsReset = await post("/api/auth/verify-reset-token", {
    token: signToken({ sid: SESSION_ID, sub: "7" }),
  });
  assert.equal(sessionAsReset.status, 400, "una sesión tampoco sirve como token de recuperación");
});
