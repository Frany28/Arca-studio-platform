import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import express from "express";

// El transporte simulado nunca consulta la base configurada ni requiere dotenv.
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.AUTH_TOKEN_SECRET = "test-secret-with-sufficient-entropy-for-b2";
process.env.CORS_ORIGINS = "https://arca-studio-platform.netlify.app";
process.env.ROUTE_AUTH_DISABLED_FOR_TESTS = "false";

const { pool } = await import("../src/config/db.js");
const { hashRateLimitKey, normalizeEmailIdentity } = await import("../src/utils/rateLimitKey.js");
const { getVerifiedClientIp, isValidNetlifySignature } = await import("../src/utils/verifiedClientIp.js");
const { AUTH_RATE_LIMIT_DIMENSIONS, AUTH_RATE_LIMIT_POLICIES } = await import("../src/config/authRateLimits.js");
const { consumeRateLimit, scheduleRateLimitCleanup } = await import("../src/services/rateLimitService.js");
const { createAuthRateLimit } = await import("../src/middlewares/authRateLimit.js");
const { incrementRateLimitBuckets } = await import("../src/repositories/rateLimitRepository.js");
const { default: app } = await import("../src/app.js");

const SITE = "https://arca-studio-platform.netlify.app";
const SECRET = "netlify-proxy-secret-for-tests";

/**
 * Firma un JWS HS256 como el proxy de Netlify.
 *
 * @param {object} payload - Claims del JWS.
 * @param {object} [options] - Secreto y cabecera alternativos.
 * @returns {string} JWS compacto.
 */
function netlifySign(payload, { header = { alg: "HS256", typ: "JWT" }, secret = SECRET } = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${encode(header)}.${encode(payload)}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

const validClaims = () => ({ deploy_context: "production", exp: Math.floor(Date.now() / 1000) + 60, iss: "netlify", netlify_id: "id", site_url: SITE });

/**
 * Contador compartido en memoria con la misma semántica que el repositorio de PostgreSQL.
 * Simula varias instancias del backend usando un único almacén.
 *
 * @returns {{ increment: Function, rows: Map<string, object> }} Implementación y estado.
 */
function sharedStore() {
  const rows = new Map();
  return {
    increment: async (buckets) => buckets.map(({ keyHash, windowMs }) => {
      const key = keyHash.toString("hex");
      const now = Date.now();
      const current = rows.get(key);
      const next = !current || current.expiresAt <= now ? { count: 1, expiresAt: now + windowMs } : { ...current, count: current.count + 1 };
      rows.set(key, next);
      return { count: next.count, keyHash, retryAfterMs: next.expiresAt - now };
    }),
    rows,
  };
}

// --- Claves sin datos personales ---------------------------------------------------------------

test("las claves son HMAC de 32 bytes, deterministas, separadas por ámbito y sin datos en claro", () => {
  const key = hashRateLimitKey("login", "account", ["email:ana@arca.test"]);
  assert.equal(key.length, 32);
  assert.deepEqual(key, hashRateLimitKey("login", "account", ["email:ana@arca.test"]));
  assert.notDeepEqual(key, hashRateLimitKey("password-reset", "account", ["email:ana@arca.test"]));
  assert.notDeepEqual(key, hashRateLimitKey("login", "account-ip", ["email:ana@arca.test"]));
  assert.notDeepEqual(hashRateLimitKey("s", "d", ["ab", "c"]), hashRateLimitKey("s", "d", ["a", "bc"]));
  assert.doesNotMatch(key.toString("latin1"), /ana@arca/);
  assert.equal(normalizeEmailIdentity("  Ana@Arca.TEST "), "ana@arca.test");
  for (const invalid of [null, 42, { email: "x" }, "sin-arroba", "a".repeat(300) + "@x.test"]) assert.equal(normalizeEmailIdentity(invalid), null);
});

// --- IP verificada por el proxy firmado de Netlify ---------------------------------------------

test("solo se acepta la IP con una firma de Netlify válida para nuestro sitio", () => {
  const env = { NETLIFY_PROXY_SIGNATURE_SECRET: SECRET };
  const request = (headers) => ({ headers });
  const valid = netlifySign(validClaims());
  assert.equal(getVerifiedClientIp(request({ "x-nf-client-connection-ip": "203.0.113.7", "x-nf-sign": valid }), env), "203.0.113.7");
  assert.equal(getVerifiedClientIp(request({ "x-nf-client-connection-ip": "2001:db8::7", "x-nf-sign": valid }), env), "2001:db8::7");

  const rejected = {
    "sin secreto configurado": [{ "x-nf-client-connection-ip": "203.0.113.7", "x-nf-sign": valid }, {}],
    "cabecera de IP sin firma (cliente directo)": [{ "x-nf-client-connection-ip": "203.0.113.7" }, env],
    "solo X-Forwarded-For": [{ "x-forwarded-for": "203.0.113.7", "x-nf-sign": valid }, env],
    "firma con otro secreto": [{ "x-nf-client-connection-ip": "203.0.113.7", "x-nf-sign": netlifySign(validClaims(), { secret: "otro" }) }, env],
    "alg none": [{ "x-nf-client-connection-ip": "203.0.113.7", "x-nf-sign": netlifySign(validClaims(), { header: { alg: "none" } }) }, env],
    "firma caducada": [{ "x-nf-client-connection-ip": "203.0.113.7", "x-nf-sign": netlifySign({ ...validClaims(), exp: Math.floor(Date.now() / 1000) - 120 }) }, env],
    "emisor distinto": [{ "x-nf-client-connection-ip": "203.0.113.7", "x-nf-sign": netlifySign({ ...validClaims(), iss: "otro" }) }, env],
    "sitio ajeno": [{ "x-nf-client-connection-ip": "203.0.113.7", "x-nf-sign": netlifySign({ ...validClaims(), site_url: "https://otro.netlify.app" }) }, env],
    "varias IP": [{ "x-nf-client-connection-ip": "203.0.113.7, 198.51.100.1", "x-nf-sign": valid }, env],
    "IP inválida": [{ "x-nf-client-connection-ip": "no-es-ip", "x-nf-sign": valid }, env],
    "JWS mal formado": [{ "x-nf-client-connection-ip": "203.0.113.7", "x-nf-sign": "a.b" }, env],
  };
  for (const [label, [headers, environment]] of Object.entries(rejected)) {
    assert.equal(getVerifiedClientIp(request(headers), environment), null, label);
  }
  assert.equal(isValidNetlifySignature(valid, SECRET), true);
});

// --- Políticas: dimensiones por ámbito, sin bloqueos colectivos --------------------------------

test("sin IP verificada solo cuenta la cuenta; nunca se usa req.ip compartida de Netlify", () => {
  const req = { body: { email: "Ana@Arca.test" }, ip: "198.51.100.10" };
  const dimensions = AUTH_RATE_LIMIT_POLICIES.login(req, null);
  assert.deepEqual(dimensions.map(({ name, max, windowMs }) => ({ max, name, windowMs })), [{ max: 20, name: "account", windowMs: 3_600_000 }]);
  assert.doesNotMatch(JSON.stringify(dimensions), /198\.51\.100\.10/);
  // Sin cuenta reconocible ni IP verificada no hay contador colectivo ("anonymous").
  assert.deepEqual(AUTH_RATE_LIMIT_POLICIES["password-reset"]({ body: {}, ip: "198.51.100.10" }, null), []);
});

test("con IP verificada se aplican cuenta + IP 5/15 min, cuenta 20/h e IP 30/15 min", () => {
  const dimensions = AUTH_RATE_LIMIT_POLICIES.login({ body: { email: "ana@arca.test" } }, "203.0.113.7");
  assert.deepEqual(dimensions.map(({ name, max, windowMs }) => [name, max, windowMs]), [
    ["account", 20, 3_600_000], ["account-ip", 5, 900_000], ["ip", 30, 900_000],
  ]);
  assert.equal(AUTH_RATE_LIMIT_DIMENSIONS.accountIp.max, 5);
  // Recuperación: el correo o, en los pasos del enlace, el token identifican la cuenta.
  assert.deepEqual(AUTH_RATE_LIMIT_POLICIES["password-reset"]({ body: { token: "token-de-prueba-largo" } }, null).map(({ parts }) => parts), [["token:token-de-prueba-largo"]]);
  assert.deepEqual(AUTH_RATE_LIMIT_POLICIES["change-password"]({ user: { id: 7 } }, null).map(({ name, max }) => [name, max]), [["user", 5]]);
});

// --- Servicio ------------------------------------------------------------------------------------

test("el servicio bloquea al superar cualquier dimensión y calcula Retry-After", async () => {
  const store = sharedStore();
  const dimensions = [{ max: 2, name: "account", parts: ["email:a@x.test"], windowMs: 60_000 }, { max: 10, name: "ip", parts: ["203.0.113.7"], windowMs: 60_000 }];
  const options = { incrementBuckets: store.increment, scheduleCleanup: () => {} };
  assert.equal((await consumeRateLimit("login", dimensions, options)).allowed, true);
  assert.equal((await consumeRateLimit("login", dimensions, options)).allowed, true);
  const blocked = await consumeRateLimit("login", dimensions, options);
  assert.deepEqual([blocked.allowed, blocked.exceeded], [false, ["account"]]);
  assert.ok(blocked.retryAfterSeconds >= 59 && blocked.retryAfterSeconds <= 60);
  assert.deepEqual(await consumeRateLimit("login", [], options), { allowed: true, exceeded: [], retryAfterSeconds: 0 });
});

test("si PostgreSQL falla o devuelve un resultado incompleto, el servicio lo informa como no disponible", async () => {
  const dimensions = [{ max: 2, name: "account", parts: ["email:a@x.test"], windowMs: 60_000 }];
  await assert.rejects(
    consumeRateLimit("login", dimensions, { incrementBuckets: async () => { throw Object.assign(new Error("down"), { code: "ECONNREFUSED" }); }, scheduleCleanup: () => {} }),
    { code: "RATE_LIMIT_STORE_UNAVAILABLE" },
  );
  await assert.rejects(consumeRateLimit("login", dimensions, { incrementBuckets: async () => [], scheduleCleanup: () => {} }), { code: "RATE_LIMIT_STORE_UNAVAILABLE" });
});

test("la limpieza se lanza en una fracción de peticiones, sin esperar y sin propagar errores", async () => {
  let calls = 0;
  scheduleRateLimitCleanup({ deleteExpired: async () => { calls += 1; }, random: () => 0.5 });
  scheduleRateLimitCleanup({ deleteExpired: async () => { calls += 1; throw new Error("fallo"); }, random: () => 0 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
});

test("el repositorio usa una única sentencia parametrizada, sin correos ni tokens en la consulta", async (context) => {
  let captured;
  context.mock.method(pool, "query", async (sql, params) => {
    captured = { params, sql };
    return { rows: [{ count: "3", key_hash: params[0], retry_after_ms: "1500" }] };
  });
  const keyHash = hashRateLimitKey("login", "account", ["email:ana@arca.test"]);
  assert.deepEqual(await incrementRateLimitBuckets([{ keyHash, scope: "login", windowMs: 60_000 }]), [{ count: 3, keyHash, retryAfterMs: 1500 }]);
  assert.match(captured.sql, /insert into public\.rate_limit_buckets[\s\S]*on conflict \(key_hash\) do update/);
  assert.match(captured.sql, /order by key_hash/);
  assert.deepEqual(captured.params, [keyHash, "login", 60_000]);
  assert.doesNotMatch(captured.sql + JSON.stringify(captured.params), /ana@arca/);
});

// --- Middleware: contrato 429 y 503 --------------------------------------------------------------

/**
 * Monta el middleware con dependencias simuladas y una ruta que confirma el paso.
 *
 * @param {import("node:test").TestContext} context - Contexto que cierra el servidor.
 * @param {Function} consume - Consumo simulado.
 * @returns {Promise<Function>} Cliente `post(body)`.
 */
async function startLimitedRoute(context, consume) {
  const limited = express();
  limited.use(express.json());
  limited.post("/limited", createAuthRateLimit("login", { consume, resolveVerifiedIp: () => null }), (_req, res) => res.json({ ok: true }));
  const server = limited.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  return (body) => fetch(`http://127.0.0.1:${server.address().port}/limited`, { body: JSON.stringify(body), headers: { "Content-Type": "application/json" }, method: "POST" });
}

test("middleware: 429 conserva el contrato actual y 503 nunca deja pasar la petición", async (context) => {
  const blocked = await startLimitedRoute(context, async () => ({ allowed: false, exceeded: ["account"], retryAfterSeconds: 42 }));
  let response = await blocked({ email: "a@x.test" });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "42");
  assert.deepEqual(await response.json(), { code: "RATE_LIMITED", message: "Demasiadas solicitudes. Intenta de nuevo más tarde.", retryAfter: 42 });

  const unavailable = await startLimitedRoute(context, async () => { throw Object.assign(new Error("x"), { code: "RATE_LIMIT_STORE_UNAVAILABLE" }); });
  response = await unavailable({ email: "a@x.test" });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "30");
  assert.equal((await response.json()).code, "RATE_LIMIT_UNAVAILABLE");

  const allowed = await startLimitedRoute(context, async () => ({ allowed: true, exceeded: [], retryAfterSeconds: 0 }));
  assert.deepEqual(await (await allowed({ email: "a@x.test" })).json(), { ok: true });
});

// --- Login y recuperación con la aplicación real --------------------------------------------------

/**
 * Sustituye pool.query: los contadores usan un almacén compartido y el resto de consultas responden vacío.
 *
 * @param {import("node:test").TestContext} context - Contexto que restaura el mock.
 * @param {{ failRateLimit?: boolean }} [options] - Si la consulta del contador debe fallar.
 * @returns {Array<string>} Consultas de negocio ejecutadas (sin las del contador).
 */
function mockAppDatabase(context, { failRateLimit = false } = {}) {
  const store = sharedStore();
  const businessQueries = [];
  context.mock.method(pool, "query", async (sql, params) => {
    if (sql.includes("public.rate_limit_buckets")) {
      if (sql.includes("delete from")) return { rowCount: 0, rows: [] };
      if (failRateLimit) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
      const buckets = [];
      for (let index = 0; index < params.length; index += 3) buckets.push({ keyHash: params[index], windowMs: params[index + 2] });
      const rows = await store.increment(buckets);
      return { rows: rows.map(({ count, keyHash, retryAfterMs }) => ({ count, key_hash: keyHash, retry_after_ms: retryAfterMs })) };
    }
    businessQueries.push(sql);
    return { rowCount: 0, rows: [] };
  });
  return businessQueries;
}

/**
 * Inicia la aplicación real en un puerto efímero.
 *
 * @param {import("node:test").TestContext} context - Contexto que cierra el servidor.
 * @returns {Promise<Function>} Cliente `post(path, body, headers)`.
 */
async function startApp(context) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  context.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return (path, body, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    body: JSON.stringify(body), headers: { "Content-Type": "application/json", ...headers }, method: "POST",
  });
}

test("login: la cuenta admite 20 intentos por hora y los distintos X-Forwarded-For no la reinician", async (context) => {
  mockAppDatabase(context);
  const post = await startApp(context);
  const statuses = [];
  for (let attempt = 0; attempt < 22; attempt += 1) {
    statuses.push((await post("/api/auth/login", { email: "victima@arca.test", password: "Incorrecta1!" }, { "X-Forwarded-For": `203.0.113.${attempt}` })).status);
  }
  assert.deepEqual(statuses.slice(0, 20), Array(20).fill(401));
  assert.deepEqual(statuses.slice(20), [429, 429]);
  // Otra cuenta, misma IP de Netlify: no queda bloqueada (sin bloqueos colectivos).
  assert.equal((await post("/api/auth/login", { email: "otra@arca.test", password: "Incorrecta1!" })).status, 401);
});

test("recuperación: tiene su propio contador y no consume el del login", async (context) => {
  mockAppDatabase(context);
  const post = await startApp(context);
  for (let attempt = 0; attempt < 20; attempt += 1) await post("/api/auth/login", { email: "ana@arca.test", password: "Incorrecta1!" });
  assert.equal((await post("/api/auth/login", { email: "ana@arca.test", password: "Incorrecta1!" })).status, 429);
  assert.equal((await post("/api/auth/forgot-password", { email: "ana@arca.test" })).status, 202);
  for (let attempt = 0; attempt < 19; attempt += 1) await post("/api/auth/forgot-password", { email: "ana@arca.test" });
  assert.equal((await post("/api/auth/forgot-password", { email: "ana@arca.test" })).status, 429);
});

test("si PostgreSQL no permite comprobar el límite, login y recuperación responden 503 sin ejecutarse", async (context) => {
  const businessQueries = mockAppDatabase(context, { failRateLimit: true });
  const post = await startApp(context);
  for (const [path, body] of [["/api/auth/login", { email: "ana@arca.test", password: "Incorrecta1!" }], ["/api/auth/forgot-password", { email: "ana@arca.test" }], ["/api/auth/reset-password", { password: "Nueva2026*", token: "token-de-prueba-largo" }]]) {
    const response = await post(path, body);
    assert.equal(response.status, 503, path);
    assert.equal((await response.json()).code, "RATE_LIMIT_UNAVAILABLE");
  }
  assert.deepEqual(businessQueries, [], "no se consultan usuarios ni tokens sin comprobar el límite");
});
