import "dotenv/config";

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { databaseHost, readPassword, writeReport } from "./lib/maintenanceCommand.mjs";

/*
 * Separación de los servicios con unidades alternativas en servicios independientes, una unidad
 * por servicio (una sola vez, en mantenimiento, antes de la migración
 * 20261030120000_service_single_unit_option).
 *
 *   node scripts/split-service-units.mjs --catalog <archivo.json> --admin-email <correo>
 *     [--dry-run | --verify [--history-baseline <informe del dry-run>]
 *      | --apply --confirm-target <base@host> --catalog-sha256 <huella> --plan-sha256 <huella>]
 *     [--report <archivo.json>]
 *
 * - El archivo es el catálogo oficial revisado (mismo formato que la carga): describe el estado
 *   final, con una unidad por servicio.
 * - Por defecto (--dry-run) solo lee: muestra las versiones nuevas de los originales, las altas con
 *   su código previsto, las cotizaciones afectadas, la huella del historial y los bloqueos, y la
 *   huella del plan (SHA-256 de las escrituras previstas).
 * - --apply versiona los originales y crea los servicios adicionales con los servicios del backend,
 *   a nombre del administrador. Exige confirmar el destino, la huella del archivo y la huella del
 *   plan revisado en el dry-run: si la base cambió, el plan no coincide y no se escribe nada.
 * - --verify comprueba en solo lectura el resultado; con --history-baseline compara además el
 *   historial con la huella guardada en el informe del dry-run.
 * - La contraseña nunca va en la línea de comandos. El informe se guarda fuera del repositorio.
 */

const USAGE = `Uso:
  node scripts/split-service-units.mjs --catalog <archivo.json> --admin-email <correo> [--dry-run]
  node scripts/split-service-units.mjs --catalog <archivo.json> --admin-email <correo> --verify [--history-baseline <informe.json>]
  node scripts/split-service-units.mjs --catalog <archivo.json> --admin-email <correo> --apply \\
    --confirm-target <base@host> --catalog-sha256 <huella> --plan-sha256 <huella del plan>
Opcional: --report <archivo.json> (por defecto ~/ARCA_PRIVATE_BACKUPS/service-unit-split/).`;

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;
const REPORT_FOLDER = "service-unit-split";
const SHA256 = /^[0-9a-f]{64}$/i;

/**
 * Lee las opciones de la línea de comandos y comprueba que el modo y sus requisitos sean
 * coherentes. Devuelve null y muestra el uso si no lo son.
 *
 * @returns {object|null} Opciones.
 */
function readOptions() {
  const { values } = parseArgs({
    options: {
      "admin-email": { type: "string" },
      apply: { type: "boolean", default: false },
      catalog: { type: "string" },
      "catalog-sha256": { type: "string" },
      "confirm-target": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "history-baseline": { type: "string" },
      "plan-sha256": { type: "string" },
      report: { type: "string" },
      verify: { type: "boolean", default: false },
    },
    strict: true,
  });
  const modes = ["apply", "dry-run", "verify"].filter((mode) => values[mode]);
  const mode = modes[0] ?? "dry-run";
  const problems = [];
  if (modes.length > 1) problems.push("Elige un solo modo: --dry-run, --verify o --apply.");
  if (!values.catalog) problems.push("Falta --catalog.");
  if (!values["admin-email"]) problems.push("Falta --admin-email.");
  if (mode === "apply" && !values["confirm-target"]) problems.push("--apply exige --confirm-target <base@host>.");
  if (mode === "apply" && !SHA256.test(values["catalog-sha256"] ?? "")) problems.push("--apply exige --catalog-sha256 con la huella mostrada en el dry-run.");
  if (mode === "apply" && !SHA256.test(values["plan-sha256"] ?? "")) problems.push("--apply exige --plan-sha256 con la huella del plan mostrada en el dry-run.");
  if (values["history-baseline"] && mode !== "verify") problems.push("--history-baseline solo se usa con --verify.");
  if (problems.length) {
    console.error(`${problems.join("\n")}\n\n${USAGE}`);
    return null;
  }
  return { ...values, mode };
}

/**
 * Huella de las escrituras previstas por el plan: versiones (servicio, versión, nombres) y altas
 * (código, nombre, unidad, tarifa, orden), además del próximo id de la secuencia. Si la base
 * cambia entre el dry-run y la aplicación, la huella cambia y no se escribe nada.
 *
 * @param {object} plan - Plan de planServiceUnitSplit.
 * @returns {string} SHA-256 en hexadecimal.
 */
function planFingerprint(plan) {
  const writes = {
    creations: plan.creations.map((step) => [step.expectedCode, step.name, step.kind, step.referenceRate, step.sortOrder]),
    nextServiceId: plan.nextServiceId,
    updates: plan.updates.map((step) => [step.code, step.currentVersion, step.nextVersion, step.fromName, step.toName, step.removedUnits]),
  };
  return createHash("sha256").update(JSON.stringify(writes)).digest("hex");
}

/**
 * Muestra el plan de forma legible: destino, versiones, altas, cotizaciones, huella del historial
 * y bloqueos.
 *
 * @param {object} plan - Plan de planServiceUnitSplit.
 * @param {string} target - Destino base@host.
 * @returns {void}
 */
function printPlan(plan, target) {
  console.log(`Destino: ${target} (PostgreSQL ${plan.target.serverVersion})`);
  if (plan.updates.length) console.log("\nVersiones nuevas (se conserva la anterior como historial):");
  for (const step of plan.updates) {
    console.log(`  ${step.code} v${step.currentVersion} → v${step.nextVersion}  «${step.fromName}» → «${step.toName}»  ${step.unitLabel} $${step.referenceRate} (retira ${step.removedUnits} unidad alternativa)`);
  }
  if (plan.creations.length) console.log("\nAltas (código generado por la secuencia):");
  for (const step of plan.creations) {
    console.log(`  ${step.expectedCode} ${step.kind.padEnd(10)} $${step.referenceRate.padStart(7)}  orden ${step.sortOrder}  ${step.name}`);
  }
  if (plan.quoteReferences) {
    const refs = plan.quoteReferences;
    console.log(`\nCotizaciones: ${refs.quotes} (versiones ${refs.quoteVersions}, conceptos ${refs.quoteItems}); conceptos con servicios afectados: ${refs.affectedQuoteItems}`);
  }
  if (plan.history) {
    console.log(`Historial: ${plan.history.versions.count} versiones, ${plan.history.versionUnits.count} unidades copiadas, ${plan.history.quoteItems.count} conceptos`);
  }
  console.log(`\nEscrituras pendientes: ${plan.pendingWrites}`);
  if (plan.blockers.length) console.log(`\nBLOQUEOS (no se escribirá nada):\n${plan.blockers.map((message) => `  - ${message}`).join("\n")}`);
}

/**
 * Muestra el resultado de una verificación: incidencias, notas y comparación del historial.
 *
 * @param {object} verification - Resultado de verifyServiceUnitSplit.
 * @returns {void}
 */
function printVerification(verification) {
  console.log(verification.ok ? "\nVerificación correcta." : `\nINCIDENCIAS:\n${verification.issues.map((issue) => `  - ${issue}`).join("\n")}`);
  for (const note of verification.notes) console.log(`  nota: ${note}`);
  if (verification.history) console.log("  Historial comparado con la huella anterior.");
}

/**
 * Lee la huella del historial guardada en el informe de un dry-run.
 *
 * @param {string} file - Informe JSON.
 * @returns {Promise<object>} Huella (`plan.history`).
 * @throws {Error} Si el informe no contiene la huella.
 */
async function readHistoryBaseline(file) {
  const report = JSON.parse(await readFile(path.resolve(file), "utf8"));
  if (!report.plan?.history) throw new Error("El informe indicado no contiene la huella del historial (plan.history).");
  return report.plan.history;
}

/**
 * Ejecuta el comando: valida el archivo, autentica al administrador, planifica, aplica o verifica
 * según el modo y guarda el informe. Devuelve el código de salida del proceso.
 *
 * @returns {Promise<number>} Código de salida.
 */
async function main() {
  const options = readOptions();
  if (!options) return EXIT_USAGE;
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL.");
    return EXIT_USAGE;
  }
  // El bloqueo de la operación ocupa una conexión durante toda la ejecución.
  process.env.DATABASE_POOL_MAX ??= "3";

  const fileBytes = await readFile(path.resolve(options.catalog));
  const catalogSha256 = createHash("sha256").update(fileBytes).digest("hex");
  const runId = randomUUID().slice(0, 8);
  const report = { catalogFile: path.resolve(options.catalog), catalogSha256, mode: options.mode, runId, startedAt: new Date().toISOString() };

  const { pool } = await import("../src/config/db.js");
  const { parseOfficialCatalog } = await import("../src/services/officialServiceCatalogLoadService.js");
  const split = await import("../src/services/serviceUnitSplitService.js");
  const { authenticateMaintenanceAdmin } = await import("../src/services/credentialService.js");
  try {
    const catalog = parseOfficialCatalog(JSON.parse(fileBytes.toString("utf8")));
    Object.assign(report, { catalogId: catalog.catalogId, source: catalog.source });
    console.log(`Catálogo: ${catalog.catalogId} — ${catalog.source}\nSHA-256: ${catalogSha256}`);

    const user = await authenticateMaintenanceAdmin({ email: options["admin-email"], password: await readPassword(options["admin-email"]) });
    report.actor = user;
    console.log(`Administrador: ${user.email} (id ${user.id})`);

    if (options.mode === "verify") {
      const historyBefore = options["history-baseline"] ? await readHistoryBaseline(options["history-baseline"]) : undefined;
      report.verification = await split.verifyServiceUnitSplit(catalog, { historyBefore });
      printVerification(report.verification);
      return report.verification.ok ? EXIT_OK : EXIT_FAILED;
    }

    const plan = await split.planServiceUnitSplit(catalog, { runId });
    const target = `${plan.target.database}@${databaseHost()}`;
    const planSha256 = planFingerprint(plan);
    Object.assign(report, { plan, planSha256, target });
    printPlan(plan, target);
    if (options.mode === "dry-run") {
      if (!plan.ready) console.log("\nDry-run con bloqueos.");
      else if (plan.pendingWrites === 0) console.log("\nNo hay nada pendiente. Usa --verify para comprobar el resultado.");
      else console.log(`\nDry-run sin bloqueos. Para aplicar: --apply --confirm-target ${target} --catalog-sha256 ${catalogSha256} --plan-sha256 ${planSha256}`);
      return plan.ready ? EXIT_OK : EXIT_FAILED;
    }

    if (options["confirm-target"] !== target) throw new Error(`--confirm-target no coincide con la base conectada (${target}).`);
    if (options["catalog-sha256"].toLowerCase() !== catalogSha256) throw new Error("--catalog-sha256 no coincide con el archivo indicado.");
    if (options["plan-sha256"].toLowerCase() !== planSha256) throw new Error("--plan-sha256 no coincide: la base cambió desde el dry-run. Repite el dry-run.");
    const result = await split.applyServiceUnitSplit(catalog, { catalogSha256, runId, user });
    Object.assign(report, { completed: result.completed, verification: result.verification });
    console.log(`\nEscrituras realizadas: ${result.completed.map((item) => `${item.code}${item.version ? ` v${item.version}` : ""}`).join(", ")}`);
    printVerification(result.verification);
    return result.verification.ok ? EXIT_OK : EXIT_FAILED;
  } catch (error) {
    report.error = { code: error.code ?? null, fields: error.fields ?? null, message: error.message };
    if (error.serviceUnitSplit) Object.assign(report, error.serviceUnitSplit);
    console.error(`\nERROR ${error.code ?? ""}: ${error.message}`);
    if (error.fields) console.error(Object.entries(error.fields).map(([field, message]) => `  - ${field}: ${message}`).join("\n"));
    if (report.completed?.length) console.error(`Escrituras realizadas antes del fallo: ${report.completed.map((item) => item.code).join(", ")}`);
    return EXIT_FAILED;
  } finally {
    report.finishedAt = new Date().toISOString();
    console.log(`Informe: ${await writeReport(options.report, REPORT_FOLDER, report)}`);
    await pool.end();
  }
}

process.exitCode = await main();
