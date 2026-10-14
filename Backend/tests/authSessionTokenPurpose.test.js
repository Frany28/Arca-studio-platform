import assert from "node:assert/strict";
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
const { clearUserSessionCache } = await import("../src/services/userSessionCache.js");
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
 * Sustituye `pool.query` por respuestas mínimas para usuarios y tokens de recuperación.
 *
 * @param {import("node:test").TestContext} context - Contexto que restaura el mock.
 * @returns {Array<string>} Consultas recibidas, para comprobar qué rutas tocaron la base.
 */
function mockDatabase(context) {
  const calls = [];
  clearUserSessionCache();
  context.mock.method(pool, "query", async (sql) => {
    calls.push(sql);
    if (sql.includes("from public.users u")) return { rows: [userRow()], rowCount: 1 };
    if (sql.includes("from public.password_recovery_tokens")) {
      return { rows: [{ expires_at: new Date(Date.now() + 60_000), id: 1 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  return calls;
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

test("solo los payloads sin propósito y con usuario se consideran sesiones", () => {
  assert.equal(isSessionTokenPayload({ sub: "7", role: "client" }), true);
  for (const purpose of ["password_reset", "user_registration", "session", "", null, undefined]) {
    assert.equal(isSessionTokenPayload({ purpose, sub: "7" }), false, `purpose=${purpose}`);
  }
  assert.equal(isSessionTokenPayload({ role: "admin" }), false);
  assert.equal(isSessionTokenPayload(null), false);
});

test("un JWT de recuperación válido recibe 401 en /api/auth/me por Bearer y por cookie", async (context) => {
  const calls = mockDatabase(context);
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

test("los tokens de sesión existentes siguen autenticando", async (context) => {
  mockDatabase(context);
  const request = await startServer(context);
  const sessionToken = signToken({ email: "cliente@arca.test", role: "client", sub: "7" });

  const response = await request("/api/auth/me", {
    headers: { Cookie: `${authConfig.cookieName}=${sessionToken}` },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.id, 7);
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
    token: signToken({ email: "cliente@arca.test", role: "client", sub: "7" }),
  });
  assert.equal(sessionAsReset.status, 400, "una sesión tampoco sirve como token de recuperación");
});
