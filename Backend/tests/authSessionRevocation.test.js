import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcrypt";

import { createRateLimitQueryMock } from "./helpers/rateLimitQueryMock.js";
import { createSessionStoreMock, mockPoolTransactions } from "./helpers/sessionStoreMock.js";

// Revocación de sesiones (hallazgo B-3) a través de la aplicación real con PostgreSQL simulado.
// La semántica SQL, la concurrencia y la detección entre procesos se prueban contra PostgreSQL
// real en `userSessions.integration.test.js`.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.AUTH_TOKEN_SECRET = "test-secret-with-sufficient-entropy-for-b3";
process.env.ROUTE_AUTH_DISABLED_FOR_TESTS = "false";
process.env.AUTH_LOGIN_RATE_LIMIT_MAX = "100";

const { pool } = await import("../src/config/db.js");
const { default: app } = await import("../src/app.js");
const { authConfig } = await import("../src/config/auth.js");
const { createPasswordResetPayload } = await import("../src/services/passwordResetEmailService.js");
const { createAuthToken } = await import("../src/utils/tokens.js");
const { resolveAdminEditRevocationReason } = await import("../src/repositories/adminUserRepository.js");

const PASSWORD = "Segura2026*";
const passwordHash = await bcrypt.hash(PASSWORD, 4);

/**
 * Construye la fila de \`USER_SELECT\` de una cuenta de prueba activa.
 *
 * @param {object} overrides - Campos que distinguen a cada cuenta.
 * @returns {object} Fila simulada.
 */
function userRow(overrides) {
  return {
    client_id: null,
    last_login_at: null,
    last_name: "Prueba",
    password_hash: passwordHash,
    permissions: [],
    phone: null,
    profile_photo_url: null,
    status: "active",
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Sustituye PostgreSQL por un cliente (7) y un administrador (1) con sesiones en memoria.
 *
 * @param {import("node:test").TestContext} context - Contexto que restaura los mocks.
 * @param {object} [options] - Opciones del escenario.
 * @param {boolean} [options.failRevocations] - Simula un fallo de PostgreSQL al revocar.
 * @returns {{ sessionStore: object, users: Map<string, object> }} Estado simulado.
 */
function mockDatabase(context, { failRevocations = false } = {}) {
  const users = new Map([
    ["1", userRow({ email: "admin@arca.test", first_name: "Admin", id: "1", role_code: "admin", role_id: "1", role_name: "Administrador" })],
    ["7", userRow({ email: "cliente@arca.test", first_name: "Cliente", id: "7", role_code: "client", role_id: "3", role_name: "Cliente" })],
  ]);
  const rateLimitQueries = createRateLimitQueryMock();
  const sessionStore = createSessionStoreMock();
  mockPoolTransactions(context, pool);
  context.mock.method(pool, "query", async (sql, params = []) => {
    const rateLimited = rateLimitQueries.handle(sql, params);
    if (rateLimited) return rateLimited;
    if (failRevocations && sql.includes("update public.user_sessions")) {
      throw Object.assign(new Error("simulated database failure"), { code: "57P01" });
    }
    const sessionResult = sessionStore.handle(sql, params);
    if (sessionResult) return sessionResult;
    if (sql.includes("select id, password_hash")) {
      const user = users.get(String(params[0]));
      return { rowCount: user ? 1 : 0, rows: user ? [{ id: user.id, password_hash: user.password_hash }] : [] };
    }
    if (sql.includes("exists(select 1 from public.users")) {
      return { rowCount: 1, rows: [{ exists: users.has(String(params[0])) }] };
    }
    if (sql.includes("from public.users u")) {
      const matching = [...users.values()].filter((user) => (
        sql.includes("lower(u.email)") ? user.email === String(params[0]).toLowerCase() : user.id === String(params[0])
      ));
      const rows = sessionStore.filterSessionUserRows(sql, params, matching);
      return { rowCount: rows.length, rows };
    }
    if (sql.includes("update public.users") && sql.includes("password_hash = $2")) {
      const user = users.get(String(params[0]));
      if (user) user.password_hash = params[1];
      return { rowCount: user ? 1 : 0, rows: [] };
    }
    if (sql.includes("from public.password_recovery_tokens")) {
      return { rowCount: 1, rows: [{ expires_at: new Date(Date.now() + 60_000), id: 1 }] };
    }
    return { rowCount: 0, rows: [] };
  });
  return { sessionStore, users };
}

/**
 * Inicia la aplicación real en un puerto efímero.
 *
 * @param {import("node:test").TestContext} context - Contexto que cierra el servidor.
 * @returns {Promise<Function>} Función \`request(path, init)\`.
 */
async function startServer(context) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return (path, init = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, init);
}

/**
 * Inicia sesión y devuelve la cookie emitida, como haría un dispositivo independiente.
 *
 * @param {Function} request - Cliente HTTP del servidor de prueba.
 * @param {string} email - Cuenta que inicia sesión.
 * @returns {Promise<string>} Cabecera Cookie lista para reutilizar.
 */
async function loginDevice(request, email) {
  const response = await request("/api/auth/login", {
    body: JSON.stringify({ email, password: PASSWORD }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}

/**
 * Consulta /api/auth/me con una cookie y devuelve el estado HTTP.
 *
 * @param {Function} request - Cliente HTTP del servidor de prueba.
 * @param {string} cookie - Cookie de sesión.
 * @returns {Promise<number>} Estado HTTP.
 */
async function meStatus(request, cookie) {
  return (await request("/api/auth/me", { headers: { Cookie: cookie } })).status;
}

/**
 * Envía un POST con cookie y cuerpo JSON opcional.
 *
 * @param {Function} request - Cliente HTTP del servidor de prueba.
 * @param {string} path - Ruta de la API.
 * @param {string|null} cookie - Cookie de sesión, o null.
 * @param {object} [body] - Cuerpo JSON.
 * @returns {Promise<Response>} Respuesta HTTP.
 */
function post(request, path, cookie, body = {}) {
  return request(path, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    method: "POST",
  });
}

test("cada login crea una sesión independiente: varios dispositivos conviven", async (context) => {
  const { sessionStore } = mockDatabase(context);
  const request = await startServer(context);
  const deviceA = await loginDevice(request, "cliente@arca.test");
  const deviceB = await loginDevice(request, "cliente@arca.test");

  assert.notEqual(deviceA, deviceB);
  assert.equal(sessionStore.sessions.size, 2);
  assert.equal(await meStatus(request, deviceA), 200, "el segundo login no cierra el primero");
  assert.equal(await meStatus(request, deviceB), 200);
});

test("el JWT de sesión solo transporta sub y sid", async (context) => {
  mockDatabase(context);
  const request = await startServer(context);
  const cookie = await loginDevice(request, "cliente@arca.test");
  const payload = JSON.parse(Buffer.from(cookie.split("=")[1].split(".")[1], "base64url").toString("utf8"));
  assert.deepEqual(Object.keys(payload).sort(), ["exp", "iat", "sid", "sub"]);
});

test("logout revoca solo la sesión actual y el token deja de servir", async (context) => {
  const { sessionStore } = mockDatabase(context);
  const request = await startServer(context);
  const deviceA = await loginDevice(request, "cliente@arca.test");
  const deviceB = await loginDevice(request, "cliente@arca.test");

  const logout = await post(request, "/api/auth/logout", deviceA);
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0|Expires=Thu, 01 Jan 1970/i);

  assert.equal(await meStatus(request, deviceA), 401, "reutilizar la cookie tras logout falla");
  assert.equal(await meStatus(request, deviceB), 200, "la otra sesión sigue activa");
  assert.deepEqual([...sessionStore.sessions.values()].map((row) => row.revoked_reason).sort(), ["logout", null].sort());
});

test("logout sin sesión responde 204; si PostgreSQL falla expira la cookie y no informa éxito", async (context) => {
  mockDatabase(context, { failRevocations: true });
  const request = await startServer(context);
  assert.equal((await post(request, "/api/auth/logout", null)).status, 204);

  const cookie = await loginDevice(request, "cliente@arca.test");
  const failed = await post(request, "/api/auth/logout", cookie);
  assert.ok(failed.status >= 500, `estado ${failed.status}`);
  assert.match(failed.headers.get("set-cookie") || "", /Max-Age=0|Expires=Thu, 01 Jan 1970/i);
});

test("revoke-others conserva la sesión actual y revoca las demás del mismo usuario", async (context) => {
  mockDatabase(context);
  const request = await startServer(context);
  const deviceA = await loginDevice(request, "cliente@arca.test");
  const deviceB = await loginDevice(request, "cliente@arca.test");
  const deviceC = await loginDevice(request, "cliente@arca.test");
  const admin = await loginDevice(request, "admin@arca.test");

  assert.equal((await post(request, "/api/auth/sessions/revoke-others", null)).status, 401);
  const response = await post(request, "/api/auth/sessions/revoke-others", deviceA);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { revokedCount: 2 });

  assert.equal(await meStatus(request, deviceA), 200);
  assert.equal(await meStatus(request, deviceB), 401);
  assert.equal(await meStatus(request, deviceC), 401);
  assert.equal(await meStatus(request, admin), 200, "no afecta a otros usuarios");
});

test("cambiar la contraseña revoca todas las sesiones previas y emite una nueva cookie", async (context) => {
  const { sessionStore } = mockDatabase(context);
  const request = await startServer(context);
  const deviceA = await loginDevice(request, "cliente@arca.test");
  const deviceB = await loginDevice(request, "cliente@arca.test");

  const response = await post(request, "/api/auth/change-password", deviceA, {
    currentPassword: PASSWORD,
    newPassword: "Nueva2026*x",
  });
  assert.equal(response.status, 200);
  const rotated = response.headers.get("set-cookie").split(";")[0];

  assert.notEqual(rotated, deviceA);
  assert.equal(await meStatus(request, deviceA), 401, "la cookie anterior del mismo dispositivo se revoca");
  assert.equal(await meStatus(request, deviceB), 401, "los demás dispositivos se revocan");
  assert.equal(await meStatus(request, rotated), 200, "la sesión nueva funciona");
  assert.equal([...sessionStore.sessions.values()].filter((row) => row.revoked_reason === "password_changed").length, 2);
});

test("una contraseña actual incorrecta no revoca ninguna sesión", async (context) => {
  mockDatabase(context);
  const request = await startServer(context);
  const deviceA = await loginDevice(request, "cliente@arca.test");
  const deviceB = await loginDevice(request, "cliente@arca.test");

  const response = await post(request, "/api/auth/change-password", deviceA, {
    currentPassword: "Incorrecta2026*",
    newPassword: "Nueva2026*x",
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "CURRENT_PASSWORD_INCORRECT");
  assert.equal(await meStatus(request, deviceA), 200);
  assert.equal(await meStatus(request, deviceB), 200);
});

test("la recuperación de contraseña revoca todas las sesiones y su JWT no sirve como sesión", async (context) => {
  mockDatabase(context);
  const request = await startServer(context);
  const deviceA = await loginDevice(request, "cliente@arca.test");
  const resetToken = new URL(createPasswordResetPayload({ email: "cliente@arca.test", id: 7 }).resetUrl).searchParams.get("token");

  assert.equal((await request("/api/auth/me", { headers: { Authorization: `Bearer ${resetToken}` } })).status, 401);
  const reset = await post(request, "/api/auth/reset-password", null, { password: "Nueva2026*x", token: resetToken });
  assert.equal(reset.status, 200);
  assert.equal(reset.headers.get("set-cookie"), null, "la recuperación no inicia sesión");
  assert.equal(await meStatus(request, deviceA), 401);
});

test("una cuenta desactivada pierde el acceso en la siguiente petición", async (context) => {
  const { users } = mockDatabase(context);
  const request = await startServer(context);
  const cookie = await loginDevice(request, "cliente@arca.test");
  users.delete("7"); // Equivale a que USER_SELECT deje de devolverla (status/deleted_at/rol inactivo).
  assert.equal(await meStatus(request, cookie), 401);
});

test("un cambio de rol se aplica a la autorización en la siguiente petición", async (context) => {
  const { users } = mockDatabase(context);
  const request = await startServer(context);
  const cookie = await loginDevice(request, "cliente@arca.test");
  const adminPath = "/api/admin/users/1";

  assert.equal((await request(adminPath, { headers: { Cookie: cookie } })).status, 403);
  Object.assign(users.get("7"), { role_code: "admin", role_id: "1" });
  assert.notEqual((await request(adminPath, { headers: { Cookie: cookie } })).status, 403, "sin caché, el rol nuevo se aplica");
  Object.assign(users.get("7"), { role_code: "client", role_id: "3" });
  assert.equal((await request(adminPath, { headers: { Cookie: cookie } })).status, 403, "y la degradación también");
});

test("un administrador revoca las sesiones de otro usuario; no las propias ni sin permiso", async (context) => {
  const { sessionStore } = mockDatabase(context);
  const request = await startServer(context);
  const admin = await loginDevice(request, "admin@arca.test");
  const client = await loginDevice(request, "cliente@arca.test");

  assert.equal((await post(request, "/api/admin/users/7/sessions/revoke", null)).status, 401);
  assert.equal((await post(request, "/api/admin/users/1/sessions/revoke", client)).status, 403);
  assert.equal((await post(request, "/api/admin/users/abc/sessions/revoke", admin)).status, 400);
  assert.equal((await post(request, "/api/admin/users/99/sessions/revoke", admin)).status, 404);

  const self = await post(request, "/api/admin/users/1/sessions/revoke", admin);
  assert.equal(self.status, 409);
  assert.equal((await self.json()).code, "SELF_SESSION_REVOKE_NOT_ALLOWED");

  const response = await post(request, "/api/admin/users/7/sessions/revoke", admin);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { revokedCount: 1 });
  assert.equal(await meStatus(request, client), 401);
  assert.equal(await meStatus(request, admin), 200);
  assert.ok([...sessionStore.sessions.values()].some((row) => row.revoked_reason === "admin_revoked"));
});

test("los tokens firmados con sid pero de otro usuario no autentican", async (context) => {
  const { sessionStore } = mockDatabase(context);
  const request = await startServer(context);
  const adminSession = sessionStore.create(1);
  const forged = createAuthToken({ sid: adminSession.id, sub: "7" }, { expiresInSeconds: 600, secret: authConfig.tokenSecret });
  assert.equal(await meStatus(request, `${authConfig.cookieName}=${forged}`), 401);
});

test("las ediciones administrativas solo revocan ante cambios de seguridad", () => {
  const current = { email: "Cliente@Arca.test", role_id: "3", status: "active" };
  const same = { current, email: "cliente@arca.test", passwordHash: null, roleId: 3, status: "active" };

  assert.equal(resolveAdminEditRevocationReason(same), null, "nombre/teléfono/empresa no cierran sesiones");
  assert.equal(resolveAdminEditRevocationReason({ ...same, passwordHash: "hash" }), "password_changed");
  assert.equal(resolveAdminEditRevocationReason({ ...same, roleId: 1 }), "security_profile_changed");
  assert.equal(resolveAdminEditRevocationReason({ ...same, email: "otro@arca.test" }), "security_profile_changed");
  assert.equal(resolveAdminEditRevocationReason({ ...same, status: "blocked" }), "user_disabled");
  assert.equal(
    resolveAdminEditRevocationReason({ ...same, current: { ...current, status: "inactive" } }),
    "security_profile_changed",
    "reactivar también invalida sesiones antiguas",
  );
});
