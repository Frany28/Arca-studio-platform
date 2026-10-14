import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { resolveRouteAuthBypass } from "../src/config/auth.js";

const execFileAsync = promisify(execFile);
const sourceUrl = (path) => pathToFileURL(new URL(path, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")).href;

// Variables que pueden influir en el bypass y que nunca deben heredarse del proceso de pruebas.
const CONTROLLED_VARIABLES = [
  "NODE_ENV",
  "ROUTE_AUTH_DISABLED_FOR_TESTS",
  "PUBLIC_TEST_USER_ID",
  "PUBLIC_TEST_CLIENT_ID",
  "VERCEL",
  "VERCEL_ENV",
  "AWS_LAMBDA_FUNCTION_NAME",
  "FUNCTIONS_WORKER_RUNTIME",
  "NETLIFY",
];

// Script ejecutado en un proceso aislado: el bypass se evalúa al importar el middleware,
// así que cada combinación de variables necesita su propio proceso.
const PROBE_SCRIPT = `
const { default: app } = await import(${JSON.stringify(sourceUrl("../src/app.js"))});
const { requireAuth, requirePermissions, requireRoles } = await import(${JSON.stringify(sourceUrl("../src/middlewares/auth.js"))});

function runMiddleware(middleware, req) {
  return new Promise((resolve) => {
    const res = { status(code) { this.code = code; return this; }, json() { resolve(this.code); } };
    Promise.resolve(middleware(req, res, () => resolve("next"))).catch(() => resolve("error"));
  });
}

const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const me = await fetch(base + "/api/auth/me");
const adminRoles = await fetch(base + "/api/admin/roles");
const adminCreate = await fetch(base + "/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const client = { id: 9, clientId: 4, permissionCodes: [], role: { code: "client" } };
const result = {
  meStatus: me.status,
  meRole: me.status === 200 ? (await me.json()).user?.role?.code : null,
  adminRolesStatus: adminRoles.status,
  adminCreateStatus: adminCreate.status,
  anonymousRequireAuth: await runMiddleware(requireAuth, { headers: {} }),
  clientRequireAdmin: await runMiddleware(requireRoles("admin"), { headers: {}, user: client }),
  clientRequirePermission: await runMiddleware(requirePermissions("projects.publish"), { headers: {}, user: client }),
};
server.closeAllConnections();
server.close();
console.log("PROBE_RESULT" + JSON.stringify(result));
`;

/**
 * Ejecuta la aplicación real en un proceso aislado con las variables indicadas.
 * Nunca usa `.env` ni una base real: la URL apunta a un host local inexistente y las
 * solicitudes evaluadas se resuelven antes de consultar PostgreSQL.
 *
 * @param {Record<string, string>} overrides - Variables del escenario.
 * @returns {Promise<object>} Estados HTTP y resultados de los middlewares.
 */
async function probe(overrides) {
  const environment = { ...process.env };
  for (const name of CONTROLLED_VARIABLES) delete environment[name];
  Object.assign(environment, {
    AUTH_TOKEN_SECRET: "test-secret-with-sufficient-entropy",
    DATABASE_URL: "postgresql://test:test@localhost:5432/arca_unit_test",
    ...overrides,
  });
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--input-type=module", "-e", PROBE_SCRIPT],
    { env: environment, timeout: 30_000 },
  );
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith("PROBE_RESULT"));
  return JSON.parse(line.slice("PROBE_RESULT".length));
}

const MISCONFIGURED_ENVIRONMENTS = [
  { label: "NODE_ENV production", env: { NODE_ENV: "production" } },
  { label: "NODE_ENV con mayúsculas", env: { NODE_ENV: "Production" } },
  { label: "NODE_ENV con espacios", env: { NODE_ENV: " production " } },
  { label: "NODE_ENV ausente", env: {} },
  { label: "NODE_ENV vacío", env: { NODE_ENV: "" } },
  { label: "NODE_ENV staging", env: { NODE_ENV: "staging" } },
  { label: "NODE_ENV prod", env: { NODE_ENV: "prod" } },
  { label: "Vercel con NODE_ENV development", env: { NODE_ENV: "development", VERCEL: "1" } },
  { label: "Vercel preview con NODE_ENV test", env: { NODE_ENV: "test", VERCEL_ENV: "preview" } },
  { label: "Lambda con NODE_ENV development", env: { AWS_LAMBDA_FUNCTION_NAME: "arca", NODE_ENV: "development" } },
];

test("el bypass solo se habilita con solicitud explícita en desarrollo o pruebas locales", () => {
  for (const NODE_ENV of ["development", "test", " Development ", "TEST"]) {
    assert.deepEqual(
      resolveRouteAuthBypass({ NODE_ENV, ROUTE_AUTH_DISABLED_FOR_TESTS: "true" }),
      { enabled: true, requested: true },
      `NODE_ENV=${NODE_ENV}`,
    );
  }
  for (const { label, env } of MISCONFIGURED_ENVIRONMENTS) {
    assert.equal(
      resolveRouteAuthBypass({ ...env, ROUTE_AUTH_DISABLED_FOR_TESTS: "true" }).enabled,
      false,
      label,
    );
  }
  for (const flag of [undefined, "", "false", "1", "yes", "on", "enabled"]) {
    assert.deepEqual(
      resolveRouteAuthBypass({ NODE_ENV: "development", ROUTE_AUTH_DISABLED_FOR_TESTS: flag }),
      { enabled: false, requested: false },
      `flag=${flag}`,
    );
  }
});

for (const { label, env } of MISCONFIGURED_ENVIRONMENTS) {
  test(`ninguna solicitud obtiene privilegios de administrador con el flag activo y ${label}`, async () => {
    const { adminCreateStatus, ...result } = await probe({ ...env, ROUTE_AUTH_DISABLED_FOR_TESTS: "true", PUBLIC_TEST_USER_ID: "1" });
    // En producción la protección CSRF rechaza antes (403) el POST sin Origin; ambos son denegaciones.
    assert.ok([401, 403].includes(adminCreateStatus), `adminCreateStatus=${adminCreateStatus}`);
    assert.deepEqual(result, {
      meStatus: 401,
      meRole: null,
      adminRolesStatus: 401,
      anonymousRequireAuth: 401,
      clientRequireAdmin: 403,
      clientRequirePermission: 403,
    });
  });
}

test("el control local confirma que la sonda detectaría un bypass activo", async () => {
  const result = await probe({ NODE_ENV: "development", ROUTE_AUTH_DISABLED_FOR_TESTS: "true" });
  assert.equal(result.meStatus, 200);
  assert.equal(result.meRole, "admin");
  assert.equal(result.anonymousRequireAuth, "next");
  assert.equal(result.clientRequireAdmin, "next");
});
