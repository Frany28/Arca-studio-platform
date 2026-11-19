import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import pg from "pg";

import { isLoopbackDatabase, resolveDatabaseConnection } from "../src/config/databaseTls.js";
import {
  applyCompatibilityPlan,
  buildCompatibilityPlan,
  buildCompatibilityReport,
  readPlan,
  sha256,
  verifyCompatibilityPlan,
} from "../src/services/projectFileCompatibilityService.js";
import { writeReport } from "./lib/maintenanceCommand.mjs";
import { REPOSITORY_ROOT, assertReportOutsideRepository, isInsideDirectory, loadExplicitEnvironment } from "./lib/storageInventoryTarget.mjs";

/*
 * Compatibilidad de archivos heredados (Fase 1.2, B9). Planificación de solo lectura, aplicación
 * explícita y verificación posterior.
 *
 * No importa dotenv/config ni config/db.js: el destino se toma solo del archivo indicado con
 * --env-file (fuera del repositorio) y debe confirmarse con --confirm-database <base@host>. El plan,
 * que contiene ids y la visión de acceso anterior, y los informes se guardan fuera del repositorio.
 *
 *   node scripts/project-file-compatibility.mjs --env-file <ruta> --describe-target
 *   node scripts/project-file-compatibility.mjs --env-file <ruta> --confirm-database <base@host> --plan --out <plan.json>
 *   node scripts/project-file-compatibility.mjs --env-file <ruta> --confirm-database <base@host> --apply \
 *     --plan-file <plan.json> --plan-sha256 <huella> --operator-user-id <id> [--max-files <n>]
 *   node scripts/project-file-compatibility.mjs --env-file <ruta> --confirm-database <base@host> --verify \
 *     --plan-file <plan.json> --plan-sha256 <huella>
 *   Opcional: --report <ruta> (por defecto ~/ARCA_PRIVATE_BACKUPS/project-file-compatibility/).
 *
 * Códigos de salida: 0 completo sin errores; 2 completo con archivos obsoletos, errores o fallos de
 * verificación; 1 error de uso, destino no confirmado o plan inválido.
 */

const USAGE = `Uso:
  node scripts/project-file-compatibility.mjs --env-file <ruta> --describe-target
  node scripts/project-file-compatibility.mjs --env-file <ruta> --confirm-database <base@host> --plan --out <plan.json>
  node scripts/project-file-compatibility.mjs --env-file <ruta> --confirm-database <base@host> --apply --plan-file <plan.json> --plan-sha256 <huella> --operator-user-id <id> [--max-files <n>]
  node scripts/project-file-compatibility.mjs --env-file <ruta> --confirm-database <base@host> --verify --plan-file <plan.json> --plan-sha256 <huella>
  Opcional: --report <ruta>`;

/**
 * Lee las opciones y comprueba que el modo y sus requisitos sean coherentes.
 * Las rutas del plan y del informe deben quedar fuera del repositorio.
 *
 * @param {string[]} args - Argumentos del proceso.
 * @returns {object} Opciones validadas con `mode`.
 * @throws {Error} Si faltan requisitos o hay opciones incompatibles.
 */
function parseOptions(args) {
  const { values } = parseArgs({
    args,
    options: {
      apply: { type: "boolean", default: false },
      "confirm-database": { type: "string" },
      "describe-target": { type: "boolean", default: false },
      "env-file": { type: "string" },
      help: { type: "boolean", default: false },
      "max-files": { type: "string" },
      "operator-user-id": { type: "string" },
      out: { type: "string" },
      plan: { type: "boolean", default: false },
      "plan-file": { type: "string" },
      "plan-sha256": { type: "string" },
      report: { type: "string" },
      verify: { type: "boolean", default: false },
    },
    strict: true,
  });
  const modes = ["describe-target", "plan", "apply", "verify"].filter((mode) => values[mode]);
  if (values.help) return { ...values, mode: "help" };
  if (modes.length !== 1) throw new Error("Elige un solo modo: --describe-target, --plan, --apply o --verify.");
  const mode = modes[0];
  const problems = [];
  if (mode !== "describe-target" && !values["confirm-database"]) problems.push("--confirm-database <base@host>");
  if (mode === "plan" && !values.out) problems.push("--out <plan.json>");
  if (["apply", "verify"].includes(mode) && (!values["plan-file"] || !/^[0-9a-f]{64}$/i.test(values["plan-sha256"] ?? ""))) problems.push("--plan-file y --plan-sha256 <huella de 64 hex>");
  if (mode === "apply" && !(Number.isInteger(Number(values["operator-user-id"])) && Number(values["operator-user-id"]) > 0)) problems.push("--operator-user-id <id de un administrador activo>");
  if (values["max-files"] !== undefined && !(Number.isInteger(Number(values["max-files"])) && Number(values["max-files"]) > 0)) problems.push("--max-files entero positivo");
  if (problems.length) throw new Error(`Faltan o no son válidos: ${problems.join("; ")}.`);
  for (const file of [values.out, values["plan-file"], values.report].filter(Boolean)) {
    if (isInsideDirectory(path.resolve(file), REPOSITORY_ROOT)) throw new Error("El plan y el informe deben guardarse fuera del repositorio.");
  }
  return { ...values, mode };
}

/**
 * Describe la base del archivo de entorno sin credenciales: `nombre@host[:puerto]`.
 *
 * @param {Record<string, string>} environment - Variables del archivo explícito.
 * @returns {string} Destino.
 * @throws {Error} Si DATABASE_URL falta o no es válida.
 */
function describeDatabase(environment) {
  if (!environment.DATABASE_URL) throw new Error("Falta DATABASE_URL en el archivo de entorno.");
  const url = new URL(environment.DATABASE_URL);
  const name = decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres";
  return `${name}@${url.port ? `${url.hostname}:${url.port}` : url.hostname}`;
}

/**
 * Abre un cliente PostgreSQL propio para el destino confirmado, con TLS según la regla del backend.
 *
 * @param {Record<string, string>} environment - Variables del archivo explícito.
 * @returns {Promise<pg.Client>} Cliente conectado.
 */
async function openDatabase(environment) {
  const { connectionString, ssl } = resolveDatabaseConnection(environment, { local: isLoopbackDatabase(environment.DATABASE_URL) });
  const client = new pg.Client({ application_name: "arca-project-file-compatibility", connectionString, connectionTimeoutMillis: 10_000, ssl });
  await client.connect();
  return client;
}

/**
 * Ejecuta el modo pedido y guarda el informe privado. Ninguna conexión se abre antes de confirmar.
 *
 * @returns {Promise<number>} Código de salida.
 */
async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.mode === "help") {
    console.log(USAGE);
    return 0;
  }
  const environment = await loadExplicitEnvironment(options["env-file"]);
  const target = describeDatabase(environment);
  if (options.mode === "describe-target") {
    console.log(`Destino: ${target}\nConfirma con --confirm-database ${target}`);
    return 0;
  }
  if (options["confirm-database"] !== target) throw new Error(`Destino no confirmado: --confirm-database debe ser ${target}.`);
  assertReportOutsideRepository(options.report);
  const startedAt = new Date().toISOString();
  const runId = randomUUID();
  const client = await openDatabase(environment);
  try {
    if (options.mode === "plan") {
      const plan = await buildCompatibilityPlan(client, { target });
      const text = `${JSON.stringify(plan, null, 2)}\n`;
      await mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
      await writeFile(path.resolve(options.out), text, "utf8");
      const planSha256 = sha256(text);
      const reportFile = await writeReport(options.report, "project-file-compatibility", buildCompatibilityReport({ mode: "plan", plan, planSha256, runId, startedAt }));
      console.log(`Heredados: ${plan.summary.legacyFiles}; convertibles: ${plan.summary.convert}; en revisión: ${plan.summary.review}`);
      console.log(`Plan: ${path.resolve(options.out)}\nSHA-256: ${planSha256}\nInforme: ${reportFile}`);
      return 0;
    }
    const planSha256 = options["plan-sha256"].toLowerCase();
    const plan = readPlan(await readFile(path.resolve(options["plan-file"]), "utf8"), planSha256);
    const run = options.mode === "apply"
      ? await applyCompatibilityPlan(client, {
        maxFiles: options["max-files"] ? Number(options["max-files"]) : undefined,
        operatorUserId: Number(options["operator-user-id"]),
        plan,
        planSha256,
        target,
      })
      : await verifyCompatibilityPlan(client, { plan, planSha256 });
    const reportFile = await writeReport(options.report, "project-file-compatibility", buildCompatibilityReport({ mode: options.mode, plan, planSha256, run, runId, startedAt }));
    console.log(`Resultado: ${JSON.stringify(run.summary)}\nInforme: ${reportFile}`);
    const failed = run.results.some((result) => ["stale", "error", "verification_failed", "review_changed", "missing", "review_now"].includes(result.outcome));
    return failed ? 2 : 0;
  } finally {
    await client.end();
  }
}

main().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
