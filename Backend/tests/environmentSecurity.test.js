import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assertSecureEnvironment,
  collectEnvironmentViolations,
  isLocalRuntime,
} from "../src/config/environment.js";

const backendDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STRONG_SECRET = "x".repeat(48);
const SECURE_PRODUCTION = {
  AUTH_TOKEN_SECRET: STRONG_SECRET,
  CORS_ORIGINS: "https://arca-studio-platform.netlify.app",
  FRONTEND_URL: "https://arca-studio-platform.netlify.app",
  NODE_ENV: "production",
};

// Variables que el entorno del proceso de pruebas no debe filtrar a los escenarios aislados.
const CONTROLLED_VARIABLES = [
  "AUTH_TOKEN_SECRET", "AWS_LAMBDA_FUNCTION_NAME", "CORS_ALLOW_NO_ORIGIN", "CORS_ORIGIN",
  "CORS_ORIGINS", "CSRF_ALLOW_NO_ORIGIN", "FRONTEND_URL", "FUNCTIONS_WORKER_RUNTIME", "NETLIFY",
  "NODE_ENV", "PORT", "ROUTE_AUTH_DISABLED_FOR_TESTS", "VERCEL", "VERCEL_ENV",
];

/**
 * Devuelve los códigos de infracción de un entorno para comparar escenarios de forma legible.
 *
 * @param {Record<string, string>} environment - Variables del escenario.
 * @returns {Array<string>} Códigos ordenados.
 */
function codes(environment) {
  return collectEnvironmentViolations(environment).map(({ code }) => code).sort();
}

const MATRIX = [
  // Local legítimo.
  { label: "desarrollo local", env: { NODE_ENV: "development" }, expected: [] },
  { label: "pruebas locales", env: { NODE_ENV: "test" }, expected: [] },
  { label: "desarrollo local con orígenes comodín y sin Origin", env: { CORS_ORIGINS: "https://*.netlify.app", CSRF_ALLOW_NO_ORIGIN: "true", NODE_ENV: "development" }, expected: [] },
  // Ausentes y ambiguos.
  { label: "NODE_ENV ausente", env: {}, expected: ["NODE_ENV_INVALID"] },
  { label: "NODE_ENV vacío", env: { NODE_ENV: "" }, expected: ["NODE_ENV_INVALID"] },
  { label: "NODE_ENV Production", env: { ...SECURE_PRODUCTION, NODE_ENV: "Production" }, expected: ["NODE_ENV_INVALID"] },
  { label: "NODE_ENV con espacios", env: { ...SECURE_PRODUCTION, NODE_ENV: " production " }, expected: ["NODE_ENV_INVALID"] },
  { label: "NODE_ENV staging", env: { NODE_ENV: "staging" }, expected: ["NODE_ENV_INVALID"] },
  { label: "NODE_ENV prod", env: { NODE_ENV: "prod" }, expected: ["NODE_ENV_INVALID"] },
  // Plataformas con NODE_ENV no productivo.
  { label: "Vercel con development", env: { NODE_ENV: "development", VERCEL: "1" }, expected: ["HOSTED_RUNTIME_NOT_PRODUCTION"] },
  { label: "Vercel preview con test", env: { NODE_ENV: "test", VERCEL_ENV: "preview" }, expected: ["HOSTED_RUNTIME_NOT_PRODUCTION"] },
  { label: "Vercel sin NODE_ENV", env: { VERCEL: "1" }, expected: ["HOSTED_RUNTIME_NOT_PRODUCTION", "NODE_ENV_INVALID"] },
  { label: "Lambda con development", env: { AWS_LAMBDA_FUNCTION_NAME: "arca", NODE_ENV: "development" }, expected: ["HOSTED_RUNTIME_NOT_PRODUCTION"] },
  { label: "Netlify con development", env: { NETLIFY: "true", NODE_ENV: "development" }, expected: ["HOSTED_RUNTIME_NOT_PRODUCTION"] },
  // Producción.
  { label: "producción segura", env: SECURE_PRODUCTION, expected: [] },
  { label: "producción segura en Vercel", env: { ...SECURE_PRODUCTION, VERCEL: "1", VERCEL_ENV: "production" }, expected: [] },
  { label: "producción segura en VPS sin marcadores ni orígenes extra", env: { AUTH_TOKEN_SECRET: STRONG_SECRET, NODE_ENV: "production" }, expected: [] },
  { label: "producción sin secreto", env: { ...SECURE_PRODUCTION, AUTH_TOKEN_SECRET: undefined }, expected: ["AUTH_TOKEN_SECRET_WEAK"] },
  { label: "producción con secreto de 31 caracteres", env: { ...SECURE_PRODUCTION, AUTH_TOKEN_SECRET: "x".repeat(31) }, expected: ["AUTH_TOKEN_SECRET_WEAK"] },
  { label: "producción con secreto de 32 caracteres", env: { ...SECURE_PRODUCTION, AUTH_TOKEN_SECRET: "x".repeat(32) }, expected: [] },
  { label: "producción con bypass true", env: { ...SECURE_PRODUCTION, ROUTE_AUTH_DISABLED_FOR_TESTS: "true" }, expected: ["AUTH_BYPASS_FLAG_PRESENT"] },
  { label: "producción con bypass 1", env: { ...SECURE_PRODUCTION, ROUTE_AUTH_DISABLED_FOR_TESTS: "1" }, expected: ["AUTH_BYPASS_FLAG_PRESENT"] },
  { label: "producción con bypass false", env: { ...SECURE_PRODUCTION, ROUTE_AUTH_DISABLED_FOR_TESTS: " FALSE " }, expected: [] },
  { label: "producción con CSRF sin Origin", env: { ...SECURE_PRODUCTION, CSRF_ALLOW_NO_ORIGIN: "TRUE" }, expected: ["CSRF_ALLOWS_MISSING_ORIGIN"] },
  { label: "producción con CSRF_ALLOW_NO_ORIGIN false", env: { ...SECURE_PRODUCTION, CSRF_ALLOW_NO_ORIGIN: "false" }, expected: [] },
  { label: "producción con comodín de subdominio", env: { ...SECURE_PRODUCTION, CORS_ORIGINS: "https://arca-studio-platform.netlify.app,https://*.netlify.app" }, expected: ["CORS_ORIGIN_INSECURE"] },
  { label: "producción con comodín total", env: { ...SECURE_PRODUCTION, CORS_ORIGIN: "*" }, expected: ["CORS_ORIGIN_INSECURE"] },
  { label: "producción con origen http", env: { ...SECURE_PRODUCTION, FRONTEND_URL: "http://arca.example.com" }, expected: ["CORS_ORIGIN_INSECURE"] },
  { label: "producción con origen inválido", env: { ...SECURE_PRODUCTION, CORS_ORIGINS: "arca.example.com" }, expected: ["CORS_ORIGIN_INSECURE"] },
  {
    label: "producción con todas las infracciones",
    env: { CORS_ORIGINS: "https://*.netlify.app", CSRF_ALLOW_NO_ORIGIN: "true", NODE_ENV: "production", ROUTE_AUTH_DISABLED_FOR_TESTS: "true" },
    expected: ["AUTH_BYPASS_FLAG_PRESENT", "AUTH_TOKEN_SECRET_WEAK", "CORS_ORIGIN_INSECURE", "CSRF_ALLOWS_MISSING_ORIGIN"],
  },
];

for (const { label, env, expected } of MATRIX) {
  test(`matriz de entorno: ${label}`, () => {
    assert.deepEqual(codes(env), expected);
  });
}

test("solo development/test exactos y sin plataforma se consideran locales", () => {
  assert.equal(isLocalRuntime({ NODE_ENV: "development" }), true);
  assert.equal(isLocalRuntime({ NODE_ENV: "test" }), true);
  for (const env of [{}, { NODE_ENV: "Development" }, { NODE_ENV: "production" }, { NODE_ENV: "development", VERCEL: "1" }]) {
    assert.equal(isLocalRuntime(env), false, JSON.stringify(env));
  }
});

test("el error de arranque nombra variables sin revelar sus valores", () => {
  const secret = "valor-secreto-corto";
  const origin = "https://*.dominio-privado.example";
  assert.throws(
    () => assertSecureEnvironment({ AUTH_TOKEN_SECRET: secret, CORS_ORIGINS: origin, NODE_ENV: "production" }),
    (error) => {
      assert.equal(error.code, "INSECURE_ENVIRONMENT");
      assert.match(error.message, /AUTH_TOKEN_SECRET/);
      assert.match(error.message, /CORS_ORIGIN_INSECURE/);
      assert.doesNotMatch(error.message, new RegExp(secret));
      assert.doesNotMatch(error.message, /dominio-privado/);
      return true;
    },
  );
  assert.doesNotThrow(() => assertSecureEnvironment(SECURE_PRODUCTION));
});

/**
 * Ejecuta un punto de entrada real en un directorio temporal sin `.env`.
 * Resuelve cuando el servidor anuncia el arranque (y lo detiene) o cuando el proceso termina.
 *
 * @param {string} script - Código ES del proceso hijo.
 * @param {Record<string, string>} overrides - Variables del escenario.
 * @returns {Promise<{ started: boolean, exitCode: number|null, output: string }>} Resultado observado.
 */
async function runIsolated(script, overrides) {
  const workingDirectory = await mkdtemp(path.join(tmpdir(), "arca-env-"));
  const environment = { ...process.env };
  for (const name of CONTROLLED_VARIABLES) delete environment[name];
  Object.assign(environment, {
    DATABASE_URL: "postgresql://test:test@localhost:5432/arca_unit_test",
    PORT: "0",
    ...overrides,
  });

  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
        cwd: workingDirectory,
        env: environment,
      });
      let output = "";
      let started = false;
      const timer = setTimeout(() => { child.kill(); reject(new Error(`Sin respuesta:\n${output}`)); }, 30_000);
      const collect = (chunk) => {
        output += chunk;
        if (!started && /Backend running|ENTRY_LOADED/.test(output)) {
          started = true;
          child.kill();
        }
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      child.on("exit", (exitCode) => {
        clearTimeout(timer);
        resolve({ exitCode: started ? null : exitCode, output, started });
      });
    });
  } finally {
    await rm(workingDirectory, { force: true, recursive: true });
  }
}

const LOCAL_ENTRY = `await import(${JSON.stringify(pathToFileURL(path.join(backendDirectory, "local.js")).href)});`;
const VERCEL_ENTRY = `
const entry = await import(${JSON.stringify(pathToFileURL(path.join(backendDirectory, "api", "index.js")).href)});
if (typeof entry.default === "function") console.log("ENTRY_LOADED");
`;

for (const { label, entry, env, started, violation } of [
  { label: "local.js arranca en desarrollo", entry: LOCAL_ENTRY, env: { NODE_ENV: "development" }, started: true },
  { label: "local.js arranca en producción segura", entry: LOCAL_ENTRY, env: SECURE_PRODUCTION, started: true },
  { label: "local.js no arranca sin NODE_ENV", entry: LOCAL_ENTRY, env: {}, started: false, violation: "NODE_ENV_INVALID" },
  { label: "local.js no arranca con NODE_ENV staging", entry: LOCAL_ENTRY, env: { NODE_ENV: "staging" }, started: false, violation: "NODE_ENV_INVALID" },
  { label: "local.js no arranca en producción con comodín", entry: LOCAL_ENTRY, env: { ...SECURE_PRODUCTION, CORS_ORIGINS: "https://*.netlify.app" }, started: false, violation: "CORS_ORIGIN_INSECURE" },
  { label: "api/index.js carga en Vercel producción segura", entry: VERCEL_ENTRY, env: { ...SECURE_PRODUCTION, VERCEL: "1", VERCEL_ENV: "production" }, started: true },
  { label: "api/index.js no carga en Vercel con development", entry: VERCEL_ENTRY, env: { NODE_ENV: "development", VERCEL: "1" }, started: false, violation: "HOSTED_RUNTIME_NOT_PRODUCTION" },
  { label: "api/index.js no carga en Vercel con bypass", entry: VERCEL_ENTRY, env: { ...SECURE_PRODUCTION, ROUTE_AUTH_DISABLED_FOR_TESTS: "true", VERCEL: "1" }, started: false, violation: "AUTH_BYPASS_FLAG_PRESENT" },
]) {
  test(`punto de entrada: ${label}`, async () => {
    const result = await runIsolated(entry, env);
    assert.equal(result.started, started, result.output);
    if (!started) {
      assert.notEqual(result.exitCode, 0);
      assert.match(result.output, /INSECURE_ENVIRONMENT|Configuración de entorno insegura/);
      assert.match(result.output, new RegExp(violation));
    }
  });
}
