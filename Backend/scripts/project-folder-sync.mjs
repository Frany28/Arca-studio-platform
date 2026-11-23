import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import pg from "pg";

import { isLoopbackDatabase, resolveDatabaseConnection } from "../src/config/databaseTls.js";
import { sha256 } from "../src/services/projectFileCompatibilityService.js";
import {
  applyFolderSyncPlan,
  buildFolderSyncPlan,
  readFolderSyncPlan,
  serializeFolderSyncPlan,
  verifyFolderSync,
} from "../src/services/projectFolderSyncService.js";
import { writeReport } from "./lib/maintenanceCommand.mjs";
import { REPOSITORY_ROOT, assertReportOutsideRepository, isInsideDirectory, loadExplicitEnvironment } from "./lib/storageInventoryTarget.mjs";

/*
 * Sincronización de carpetas predeterminadas y clasificación documental de proyectos existentes
 * (archivística). Plan de solo lectura (simulación), aplicación explícita del plan revisado y
 * verificación posterior. Idempotente: nunca elimina carpetas ni archivos ni toca el almacenamiento.
 *
 * No importa dotenv/config ni config/db.js: el destino se toma solo del archivo indicado con
 * --env-file (fuera del repositorio) y debe confirmarse con --confirm-database <base@host>.
 *
 *   node scripts/project-folder-sync.mjs --env-file <ruta> --describe-target
 *   node scripts/project-folder-sync.mjs --env-file <ruta> --confirm-database <base@host> --plan --out <plan.json>
 *   node scripts/project-folder-sync.mjs --env-file <ruta> --confirm-database <base@host> --apply \
 *     --plan-file <plan.json> --plan-sha256 <huella> --operator-user-id <id>
 *   node scripts/project-folder-sync.mjs --env-file <ruta> --confirm-database <base@host> --verify
 *   Opcional: --report <ruta> (por defecto ~/ARCA_PRIVATE_BACKUPS/project-folder-sync/).
 *
 * Códigos de salida: 0 completo; 2 completo con errores de proyecto o verificación pendiente;
 * 1 error de uso, destino no confirmado o plan inválido.
 */

const USAGE = `Uso:
  node scripts/project-folder-sync.mjs --env-file <ruta> --describe-target
  node scripts/project-folder-sync.mjs --env-file <ruta> --confirm-database <base@host> --plan --out <plan.json>
  node scripts/project-folder-sync.mjs --env-file <ruta> --confirm-database <base@host> --apply --plan-file <plan.json> --plan-sha256 <huella> --operator-user-id <id>
  node scripts/project-folder-sync.mjs --env-file <ruta> --confirm-database <base@host> --verify
  Opcional: --report <ruta>`;

/**
 * Lee las opciones y comprueba que el modo y sus requisitos sean coherentes.
 * El plan y el informe deben quedar fuera del repositorio.
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
  if (values.help) return { ...values, mode: "help" };
  const modes = ["describe-target", "plan", "apply", "verify"].filter((mode) => values[mode]);
  if (modes.length !== 1) throw new Error("Elige un solo modo: --describe-target, --plan, --apply o --verify.");
  const mode = modes[0];
  const problems = [];
  if (mode !== "describe-target" && !values["confirm-database"]) problems.push("--confirm-database <base@host>");
  if (mode === "plan" && !values.out) problems.push("--out <plan.json>");
  if (mode === "apply" && (!values["plan-file"] || !/^[0-9a-f]{64}$/i.test(values["plan-sha256"] ?? ""))) problems.push("--plan-file y --plan-sha256 <huella de 64 hex>");
  if (mode === "apply" && !(Number.isInteger(Number(values["operator-user-id"])) && Number(values["operator-user-id"]) > 0)) problems.push("--operator-user-id <id de un administrador activo>");
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
  const client = new pg.Client({ application_name: "arca-project-folder-sync", connectionString, connectionTimeoutMillis: 10_000, ssl });
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
      const plan = await buildFolderSyncPlan(client, { target });
      const text = serializeFolderSyncPlan(plan);
      await mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
      await writeFile(path.resolve(options.out), text, "utf8");
      const planSha256 = sha256(text);
      const reportFile = await writeReport(options.report, "project-folder-sync", { mode: "plan", planSha256, runId, startedAt, summary: plan.summary, target });
      console.log(`Resumen: ${JSON.stringify(plan.summary)}`);
      console.log(`Plan: ${path.resolve(options.out)}\nSHA-256: ${planSha256}\nInforme: ${reportFile}`);
      return 0;
    }
    if (options.mode === "verify") {
      const result = await verifyFolderSync(client, { target });
      const reportFile = await writeReport(options.report, "project-folder-sync", { mode: "verify", ...result, runId, startedAt, target });
      console.log(`Verificación: ${result.ok ? "sin cambios pendientes" : "quedan cambios aplicables"}\nResumen: ${JSON.stringify(result.summary)}\nInforme: ${reportFile}`);
      return result.ok ? 0 : 2;
    }
    const planSha256 = options["plan-sha256"].toLowerCase();
    const plan = readFolderSyncPlan(await readFile(path.resolve(options["plan-file"]), "utf8"), planSha256);
    const run = await applyFolderSyncPlan(client, { operatorUserId: Number(options["operator-user-id"]), plan, planSha256, target });
    const reportFile = await writeReport(options.report, "project-folder-sync", { mode: "apply", planSha256, run, runId, startedAt, target });
    console.log(`Resultado: ${JSON.stringify(run.summary)}\nInforme: ${reportFile}`);
    return run.summary.errors ? 2 : 0;
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
