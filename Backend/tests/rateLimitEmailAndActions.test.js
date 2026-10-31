import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import express from "express";

// El transporte simulado nunca consulta la base configurada, ni Resend, ni requiere dotenv.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.AUTH_TOKEN_SECRET = "test-secret-with-sufficient-entropy-for-b2-phase2";
process.env.RESEND_API_KEY = "re_test_key";
process.env.MAIL_FROM = "ARCA <no-reply@arca.test>";
process.env.ROUTE_AUTH_DISABLED_FOR_TESTS = "false";
process.env.SUPABASE_STORAGE_BUCKET = "test-bucket";
process.env.SUPABASE_STORAGE_S3_ACCESS_KEY_ID = "test-access-key";
process.env.SUPABASE_STORAGE_S3_ENDPOINT = "https://storage.test.local/s3";
process.env.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY = "test-secret-key";

const { pool } = await import("../src/config/db.js");
const { authConfig } = await import("../src/config/auth.js");
const { objectStorage } = await import("../src/services/objectStorage.js");
const { createAuthToken } = await import("../src/utils/tokens.js");
const { normalizeEmailRecipient } = await import("../src/utils/rateLimitKey.js");
const { AUTH_RATE_LIMIT_POLICIES, EMAIL_RATE_LIMITS } = await import("../src/config/authRateLimits.js");
const { ACTION_RATE_LIMITS, uploadRateLimit } = await import("../src/middlewares/actionRateLimits.js");
const { emailRateLimits } = await import("../src/middlewares/authRateLimit.js");
const { consumeRateLimit } = await import("../src/services/rateLimitService.js");
const { uploadProjectAttachment } = await import("../src/controllers/fileController.js");
const { default: authRouter } = await import("../src/routes/auth.js");
const { default: projectsRouter } = await import("../src/routes/projects.js");
const { default: adminRouter } = await import("../src/routes/admin.js");
const { default: app } = await import("../src/app.js");
const { createRateLimitQueryMock } = await import("./helpers/rateLimitQueryMock.js");

const realFetch = globalThis.fetch;
const limiting = (dimensions) => dimensions.filter((dimension) => !dimension.observeOnly);

/**
 * Intercepta solo las llamadas a Resend y deja pasar las del servidor de prueba.
 *
 * @param {import("node:test").TestContext} context - Contexto que restaura fetch.
 * @returns {{ sent: () => number }} Número de correos enviados.
 */
function mockResend(context) {
  let sent = 0;
  context.mock.method(globalThis, "fetch", async (url, init) => {
    if (String(url).startsWith("https://api.resend.com/")) {
      sent += 1;
      return new Response(JSON.stringify({ id: `email-${sent}` }), { headers: { "Content-Type": "application/json" }, status: 200 });
    }
    return realFetch(url, init);
  });
  return { sent: () => sent };
}

/**
 * Inicia un servidor de prueba en un puerto efímero y devuelve un cliente HTTP.
 *
 * @param {import("node:test").TestContext} context - Contexto que cierra el servidor.
 * @param {import("express").Express} application - Aplicación a servir.
 * @returns {Promise<Function>} Cliente `request(method, path, body, headers)`.
 */
async function serve(context, application) {
  const server = application.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return (method, path, body, headers = {}) => realFetch(`http://127.0.0.1:${server.address().port}${path}`, {
    body: typeof body === "string" || Buffer.isBuffer(body) ? body : body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
    method,
  });
}

/**
 * Aplicación mínima con un usuario autenticado y el enrutador indicado.
 *
 * @param {string} mountPath - Prefijo del enrutador.
 * @param {import("express").Router} router - Enrutador real.
 * @param {object} user - Usuario de la sesión.
 * @returns {import("express").Express} Aplicación.
 */
function authenticatedApp(mountPath, router, user) {
  const application = express();
  application.use(express.json());
  application.use((req, _res, next) => { req.session = { isAuthenticated: true }; req.user = user; next(); });
  application.use(mountPath, router);
  return application;
}

// --- T1: correos de seguridad por destinatario ----------------------------------------------------

test("solo se unifican los alias de Gmail verificados; otros dominios conservan su forma", () => {
  for (const alias of ["Ana.Perez@gmail.com", "anaperez+registro@gmail.com", " a.n.a.p.e.r.e.z+x@GMAIL.com "]) {
    assert.equal(normalizeEmailRecipient(alias), "anaperez@gmail.com", alias);
  }
  assert.equal(normalizeEmailRecipient("ana.perez@googlemail.com"), "ana.perez@googlemail.com", "googlemail.com sin regla oficial verificada");
  assert.equal(normalizeEmailRecipient("ana.perez+x@empresa.com"), "ana.perez+x@empresa.com", "Workspace u otros dominios no se alteran");
  assert.equal(normalizeEmailRecipient("ana+x@outlook.com"), "ana+x@outlook.com");
  for (const invalid of [null, 7, "sin-arroba", "+solo@gmail.com", "..@gmail.com"]) assert.equal(normalizeEmailRecipient(invalid), null, String(invalid));
});

test("límites de correo configurables: registro y recuperación 5 por hora por destinatario", () => {
  assert.deepEqual(EMAIL_RATE_LIMITS.registration, { max: 5, windowMs: 3_600_000 });
  assert.deepEqual(EMAIL_RATE_LIMITS.passwordReset, { max: 5, windowMs: 3_600_000 });
  const dimensions = limiting(AUTH_RATE_LIMIT_POLICIES["email-registration"]({ body: { email: "Ana.Perez+x@gmail.com" } }));
  assert.deepEqual(dimensions.map(({ name, parts, max }) => [name, parts, max]), [["recipient", ["recipient:anaperez@gmail.com"], 5]]);
});

test("las rutas que envían correo aplican el límite por destinatario después de validar", () => {
  // validate() devuelve una función anónima: el orden esperado es cuenta → validación → destinatario → controlador.
  const handlers = (path) => authRouter.stack.find((layer) => layer.route?.path === path).route.stack.map((layer) => layer.handle.name || "validate");
  assert.deepEqual(handlers("/registration/start"), ["sharedRateLimit", "validate", "sharedRateLimit", "startRegistration"]);
  assert.deepEqual(handlers("/registration/resend"), ["sharedRateLimit", "validate", "sharedRateLimit", "resendRegistration"]);
  assert.deepEqual(handlers("/forgot-password"), ["sharedRateLimit", "sharedRateLimit", "forgotPassword"]);
});

/**
 * Sustituye pool.query: contador compartido emulado y, opcionalmente, una cuenta existente.
 *
 * @param {import("node:test").TestContext} context - Contexto que restaura el mock.
 * @param {{ userExists?: boolean, failRateLimit?: boolean }} [options] - Escenario.
 * @returns {{ business: Array<string> }} Consultas de negocio registradas.
 */
function mockDatabase(context, { failRateLimit = false, userExists = false } = {}) {
  const rateLimitQueries = createRateLimitQueryMock();
  const business = [];
  context.mock.method(pool, "query", async (sql, params) => {
    if (failRateLimit && sql.includes("public.rate_limit_buckets")) throw Object.assign(new Error("down"), { code: "ECONNREFUSED" });
    const rateLimited = rateLimitQueries.handle(sql, params);
    if (rateLimited) return rateLimited;
    business.push(sql);
    if (userExists && sql.includes("from public.users u")) {
      return { rowCount: 1, rows: [{ client_id: "3", email: "anaperez@gmail.com", first_name: "Ana", id: "7", last_login_at: null, last_name: "Pérez", password_hash: "x", permissions: [], phone: null, profile_photo_url: null, role_code: "client", role_id: "3", role_name: "Cliente", status: "active", updated_at: null }] };
    }
    return { rowCount: 0, rows: [] };
  });
  return { business };
}

test("recuperación: 5 correos por hora por destinatario (alias de Gmail incluidos); el bloqueado no envía", async (context) => {
  const resend = mockResend(context);
  const { business } = mockDatabase(context, { userExists: true });
  const request = await serve(context, app);
  const aliases = ["anaperez@gmail.com", "Ana.Perez@gmail.com", "anaperez+1@gmail.com", "a.naperez+2@gmail.com", "ANAPEREZ@gmail.com", "ana.perez+3@gmail.com"];
  const statuses = [];
  for (const email of aliases) statuses.push((await request("POST", "/api/auth/forgot-password", { email })).status);
  assert.deepEqual(statuses, [202, 202, 202, 202, 202, 429]);
  assert.equal(resend.sent(), 5, "la sexta solicitud no envía correo");
  const queriesBeforeBlock = business.length;
  assert.equal((await request("POST", "/api/auth/forgot-password", { email: "anaperez@gmail.com" })).status, 429);
  assert.equal(business.length, queriesBeforeBlock, "una solicitud bloqueada no consulta la cuenta");
});

test("recuperación: la respuesta es idéntica para cuentas existentes e inexistentes (sin enumeración)", async (context) => {
  const run = async (userExists, email) => {
    mockDatabase(context, { userExists });
    const request = await serve(context, app);
    const statuses = [];
    for (let attempt = 0; attempt < 6; attempt += 1) statuses.push((await request("POST", "/api/auth/forgot-password", { email })).status);
    return statuses;
  };
  mockResend(context);
  const existing = await run(true, "existe@arca.test");
  const missing = await run(false, "no-existe@arca.test");
  assert.deepEqual(existing, missing);
  assert.deepEqual(existing, [202, 202, 202, 202, 202, 429]);
});

test("registro: inicio y reenvío comparten el límite por destinatario y el bloqueado no llega al controlador", async (context) => {
  mockDatabase(context);
  let controllerCalls = 0;
  const application = express();
  application.use(express.json());
  const controller = (_req, res) => { controllerCalls += 1; res.status(202).json({ ok: true }); };
  application.post("/start", emailRateLimits.registration, controller);
  application.post("/resend", emailRateLimits.registration, controller);
  const request = await serve(context, application);
  const statuses = [];
  for (const path of ["/start", "/resend", "/start", "/resend", "/start", "/resend"]) {
    statuses.push((await request("POST", path, { email: "nuevo.cliente+a@gmail.com" })).status);
  }
  assert.deepEqual(statuses, [202, 202, 202, 202, 202, 429]);
  assert.equal(controllerCalls, 5);
  assert.equal((await request("POST", "/start", { email: "otro@arca.test" })).status, 202, "otro destinatario no queda afectado");
});

// --- T2: tokens falsificados no crean contadores ------------------------------------------------

test("los tokens con firma inválida o de otro propósito no generan contador de cuenta", () => {
  const sign = (payload) => createAuthToken(payload, { expiresInSeconds: 600, secret: authConfig.tokenSecret });
  const validReset = sign({ email: "ana@arca.test", purpose: "password_reset", sub: "7" });
  const validRegistration = sign({ email: "ana@arca.test", purpose: "user_registration" });
  const policy = (scope, token) => limiting(AUTH_RATE_LIMIT_POLICIES[scope]({ body: { token } }, null));

  assert.equal(policy("password-reset", validReset).length, 1);
  assert.equal(policy("registration", validRegistration).length, 1);
  for (const forged of ["token-inventado-largo", `${validReset.slice(0, -2)}xx`, sign({ email: "x", purpose: "password_reset", sub: "7" }).replace(/\.[^.]+$/, ".firmaFalsa")]) {
    assert.deepEqual(policy("password-reset", forged), [], forged.slice(0, 20));
  }
  assert.deepEqual(policy("password-reset", validRegistration), [], "token de registro en recuperación");
  assert.deepEqual(policy("registration", validReset), [], "token de recuperación en registro");
  assert.deepEqual(policy("password-reset", sign({ sub: "7" })), [], "token de sesión anterior a B-3");
  assert.deepEqual(policy("password-reset", sign({ sid: "0b6f3c9e-6d5a-4c1e-9a43-6f1a2b3c4d5e", sub: "7" })), [], "token de sesión con sid");
});

test("una avalancha de tokens falsificados no añade filas al contador", async (context) => {
  const rateLimitQueries = createRateLimitQueryMock();
  context.mock.method(pool, "query", async (sql, params) => rateLimitQueries.handle(sql, params) ?? { rowCount: 0, rows: [] });
  const request = await serve(context, app);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await request("POST", "/api/auth/reset-password", { password: "Nueva2026*", token: `forjado-${attempt}-${"x".repeat(20)}` });
    assert.equal(response.status, 400);
  }
  assert.equal(rateLimitQueries.rows.size, 1, "solo el contador de observación del ámbito");
});

// --- T3: anomalías sin datos personales y sin bloquear --------------------------------------------

test("la anomalía se registra una sola vez al alcanzar el umbral y nunca bloquea", async (context) => {
  const warnings = [];
  context.mock.method(console, "warn", (line) => warnings.push(String(line)));
  const rateLimitQueries = createRateLimitQueryMock();
  context.mock.method(pool, "query", async (sql, params) => rateLimitQueries.handle(sql, params));
  const dimensions = (index) => [
    { max: 2, name: "account", parts: [`email:usuario${index % 3}@arca.test`], windowMs: 60_000 },
    { alertAt: 10, name: "scope-volume", observeOnly: true, parts: ["all"], windowMs: 60_000 },
  ];
  const results = [];
  for (let index = 0; index < 25; index += 1) results.push(await consumeRateLimit("login", dimensions(index), { scheduleCleanup: () => {} }));

  const anomalies = warnings.map((line) => JSON.parse(line)).filter((entry) => entry.type === "rate_limit_anomaly");
  assert.deepEqual(anomalies, [{ dimension: "scope-volume", scope: "login", threshold: 10, type: "rate_limit_anomaly", windowSeconds: 60 }]);
  const exceeded = warnings.map((line) => JSON.parse(line)).filter((entry) => entry.type === "rate_limit_exceeded");
  assert.equal(exceeded.length, 3, "un registro por cuenta al superar su límite por primera vez");
  for (const entry of exceeded) assert.match(entry.fingerprint, /^[0-9a-f]{12}$/);
  assert.doesNotMatch(warnings.join("\n"), /@arca\.test|usuario/);
  assert.equal(results.filter((result) => result.exceeded.includes("scope-volume")).length, 0, "la observación nunca bloquea");
});

// --- Segunda fase: comentarios, cargas y administración --------------------------------------------

test("límites de acciones: se conservan los anteriores y las cargas pasan a 60 cada 10 minutos", () => {
  assert.deepEqual(ACTION_RATE_LIMITS.comments, { max: 30, windowMs: 60_000 });
  assert.deepEqual(ACTION_RATE_LIMITS.projectRequests, { max: 10, windowMs: 60_000 });
  assert.deepEqual(ACTION_RATE_LIMITS.uploads, { max: 60, windowMs: 600_000 });
  assert.deepEqual(
    ["adminUserCreate", "adminUserStatus", "adminUserNote", "adminProjectBulkAction", "adminProjectRequestDecision"].map((name) => ACTION_RATE_LIMITS[name].max),
    [20, 60, 120, 60, 60],
  );
});

/**
 * Prepara la carga real de archivos de proyecto con PostgreSQL y almacenamiento simulados.
 *
 * @param {import("node:test").TestContext} context - Contexto que restaura los mocks.
 * @param {{ failRateLimit?: boolean }} [options] - Escenario.
 * @returns {{ stored: () => number }} Número de objetos escritos en el almacenamiento.
 */
function mockUploadBackend(context, { failRateLimit = false } = {}) {
  let stored = 0;
  let nextFileId = 100;
  const rateLimitQueries = createRateLimitQueryMock();
  context.mock.method(pool, "query", async (sql, params) => {
    if (failRateLimit && sql.includes("public.rate_limit_buckets")) throw Object.assign(new Error("down"), { code: "ECONNREFUSED" });
    const rateLimited = rateLimitQueries.handle(sql, params);
    if (rateLimited) return rateLimited;
    if (sql.includes("lower(title)")) return { rows: [] };
    return { rows: [{ assigned_architect_id: null, client_id: "7", id: "15", is_assignee: false, is_public: false, status: "in_process" }] };
  });
  context.mock.method(pool, "connect", async () => ({
    async query(sql) {
      if (sql.includes("insert into public.files")) return { rows: [{ current_version: 1, file_category: "document", file_type: "application/pdf", id: String(nextFileId++), project_id: "15", uploaded_by: "70" }] };
      if (sql.includes("insert into public.file_versions")) return { rows: [{ created_at: new Date(), file_name: "k", file_size: 4, file_url: "u", id: "1", original_name: "a.pdf", version_number: 1 }] };
      if (sql.includes("for update")) return { rows: [{ status: "in_process" }] };
      // Acceso vigente comprobado al registrar la carga (findProjectForFileUpload con el cliente).
      if (sql.includes("is_assignee")) return { rows: [{ assigned_architect_id: null, client_id: "7", id: "15", is_assignee: false, is_public: false, status: "in_process" }] };
      return { rows: [] };
    },
    release() {},
  }));
  context.mock.method(objectStorage, "put", async ({ body }) => {
    for await (const _chunk of body) { /* consume el flujo como el almacenamiento real */ }
    stored += 1;
    return {};
  });
  return { stored: () => stored };
}

/**
 * Monta la ruta real de cargas con el limitador compartido y un usuario cliente autenticado.
 *
 * @param {import("node:test").TestContext} context - Contexto del servidor.
 * @returns {Promise<Function>} Función que sube un PDF y devuelve el estado HTTP.
 */
async function startUploadRoute(context) {
  const application = express();
  application.use((req, _res, next) => { req.user = { clientId: 7, id: 70, permissionCodes: ["projects.files.upload"], role: { code: "client" } }; next(); });
  application.post("/projects/:projectId/files", uploadRateLimit, uploadProjectAttachment);
  const request = await serve(context, application);
  return async (index) => (await request("POST", "/projects/15/files", Buffer.from("%PDF"), {
    "Content-Length": "4", "Content-Type": "application/pdf", "X-File-Name": encodeURIComponent(`plano-${index}.pdf`),
  })).status;
}

test("cargas: un lote legítimo de 60 archivos en paralelo se acepta y el 61 recibe 429 sin escribir", async (context) => {
  const backend = mockUploadBackend(context);
  const upload = await startUploadRoute(context);
  const statuses = await Promise.all(Array.from({ length: 60 }, (_, index) => upload(index)));
  assert.deepEqual([...new Set(statuses)], [201]);
  assert.equal(backend.stored(), 60);
  assert.equal(await upload(61), 429);
  assert.equal(backend.stored(), 60, "el archivo rechazado no se escribe");
});

test("cargas: si el contador no está disponible responde 503 y no escribe el archivo", async (context) => {
  const backend = mockUploadBackend(context, { failRateLimit: true });
  const upload = await startUploadRoute(context);
  assert.equal(await upload(1), 503);
  assert.equal(backend.stored(), 0);
});

test("comentarios y administración: 503 antes de ejecutar la operación si el contador falla", async (context) => {
  const { business } = mockDatabase(context, { failRateLimit: true });
  const comments = await serve(context, authenticatedApp("/api/projects", projectsRouter, { clientId: 7, id: 70, permissionCodes: [], role: { code: "client" } }));
  let response = await comments("POST", "/api/projects/15/comments", { content: "Observación" });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "RATE_LIMIT_UNAVAILABLE");

  const admin = await serve(context, authenticatedApp("/api/admin", adminRouter, { id: 1, role: { code: "admin" } }));
  response = await admin("PATCH", "/api/admin/projects/bulk-action", { action: "archive", projectIds: [15] });
  assert.equal(response.status, 503);
  assert.deepEqual(business, [], "ninguna consulta de negocio sin comprobar el límite");
});

test("comentarios: el usuario 31 recibe el 429 actual y otro usuario no se ve afectado", async (context) => {
  mockDatabase(context);
  const statuses = [];
  const first = await serve(context, authenticatedApp("/api/projects", projectsRouter, { clientId: 7, id: 70, permissionCodes: [], role: { code: "client" } }));
  for (let attempt = 0; attempt < 31; attempt += 1) statuses.push((await first("POST", "/api/projects/15/comments", { content: "Observación" })).status);
  assert.equal(statuses.filter((status) => status === 429).length, 1);
  const response = await first("POST", "/api/projects/15/comments", { content: "Observación" });
  assert.deepEqual(await response.json(), { code: "RATE_LIMITED", message: "Demasiadas solicitudes. Intenta de nuevo más tarde.", retryAfter: Number(response.headers.get("retry-after")) });
  const second = await serve(context, authenticatedApp("/api/projects", projectsRouter, { clientId: 8, id: 80, permissionCodes: [], role: { code: "client" } }));
  assert.notEqual((await second("POST", "/api/projects/15/comments", { content: "Observación" })).status, 429);
});
