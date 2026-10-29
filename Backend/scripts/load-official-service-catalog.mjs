import "dotenv/config";

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { databaseHost, readPassword, writeReport } from "./lib/maintenanceCommand.mjs";

/*
 * Carga controlada del catálogo oficial de servicios (una sola vez, en mantenimiento).
 *
 *   node scripts/load-official-service-catalog.mjs --catalog <archivo.json> --admin-email <correo>
 *     [--dry-run | --verify | --apply --confirm-target <base@host> --catalog-sha256 <huella>]
 *     [--report <archivo.json>]
 *
 * - Por defecto (--dry-run) solo lee: valida el archivo, identifica la base, comprueba la
 *   migración, las unidades, las denominaciones y los servicios existentes, y muestra los códigos
 *   previstos y los bloqueos. No consume secuencias.
 * - --apply crea lo pendiente con los servicios del backend a nombre del administrador
 *   autenticado. Exige confirmar el destino (base@host) y la huella SHA-256 del archivo revisado
 *   en el dry-run, de modo que no se aplique otro archivo ni otra base por error.
 * - --verify comprueba en solo lectura que la base contiene el catálogo exacto.
 * - La contraseña nunca va en la línea de comandos: se pide sin eco o se lee de
 *   ARCA_MAINTENANCE_ADMIN_PASSWORD. El informe JSON se guarda fuera del repositorio.
 */

const USAGE = `Uso:
  node scripts/load-official-service-catalog.mjs --catalog <archivo.json> --admin-email <correo> [--dry-run]
  node scripts/load-official-service-catalog.mjs --catalog <archivo.json> --admin-email <correo> --verify
  node scripts/load-official-service-catalog.mjs --catalog <archivo.json> --admin-email <correo> --apply \\
    --confirm-target <base@host> --catalog-sha256 <huella del dry-run>
Opcional: --report <archivo.json> (por defecto ~/ARCA_PRIVATE_BACKUPS/catalog-load/).`;

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

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
  if (mode === "apply" && !/^[0-9a-f]{64}$/i.test(values["catalog-sha256"] ?? "")) problems.push("--apply exige --catalog-sha256 con la huella mostrada en el dry-run.");
  if (problems.length) {
    console.error(`${problems.join("\n")}\n\n${USAGE}`);
    return null;
  }
  return { ...values, mode };
}

/**
 * Muestra el plan de forma legible: destino, denominaciones, servicios con su unidad y tarifa,
 * y bloqueos.
 *
 * @param {object} plan - Plan de planOfficialCatalogLoad.
 * @param {string} target - Destino base@host.
 * @returns {void}
 */
function printPlan(plan, target) {
  console.log(`Destino: ${target} (PostgreSQL ${plan.target.serverVersion})`);
  console.log(`Migración de unidades: ${plan.migration.structureReady ? "estructura presente" : "FALTA"}${plan.migration.historyAvailable ? `, historial ${plan.migration.migrationFinished ? "terminada" : "NO terminada"}` : ""}`);
  if (plan.denominations.length) console.log("\nDenominaciones:");
  for (const step of plan.denominations) console.log(`  ${step.action.padEnd(7)} ${String(step.publicCode ?? "").padEnd(9)} ${step.label}${step.reason ? ` — ${step.reason}` : ""}`);
  if (plan.services.length) console.log("\nServicios:");
  for (const step of plan.services) {
    console.log(`  ${step.action.padEnd(7)} ${step.expectedCode} ${step.kind.padEnd(10)} $${step.referenceRate.padStart(7)}  ${step.name} — ${step.unitLabel}`);
  }
  console.log(`\nAltas pendientes: ${plan.pendingWrites}`);
  if (plan.blockers.length) console.log(`\nBLOQUEOS (no se escribirá nada):\n${plan.blockers.map((message) => `  - ${message}`).join("\n")}`);
}

/**
 * Ejecuta el comando: valida el archivo, autentica al administrador, planifica, aplica o
 * verifica según el modo y guarda el informe. Devuelve el código de salida del proceso.
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
  // El bloqueo de carga ocupa una conexión durante toda la ejecución.
  process.env.DATABASE_POOL_MAX ??= "3";

  const fileBytes = await readFile(path.resolve(options.catalog));
  const catalogSha256 = createHash("sha256").update(fileBytes).digest("hex");
  const runId = randomUUID().slice(0, 8);
  const report = { catalogFile: path.resolve(options.catalog), catalogSha256, mode: options.mode, runId, startedAt: new Date().toISOString() };

  const { pool } = await import("../src/config/db.js");
  const loader = await import("../src/services/officialServiceCatalogLoadService.js");
  const { authenticateMaintenanceAdmin } = await import("../src/services/credentialService.js");
  try {
    const catalog = loader.parseOfficialCatalog(JSON.parse(fileBytes.toString("utf8")));
    Object.assign(report, { catalogId: catalog.catalogId, source: catalog.source });
    console.log(`Catálogo: ${catalog.catalogId} — ${catalog.source}\nSHA-256: ${catalogSha256}`);

    const user = await authenticateMaintenanceAdmin({ email: options["admin-email"], password: await readPassword(options["admin-email"]) });
    report.actor = user;
    console.log(`Administrador: ${user.email} (id ${user.id})`);

    if (options.mode === "verify") {
      report.verification = await loader.verifyOfficialCatalog(catalog);
      console.log(report.verification.ok ? "\nVerificación correcta." : `\nINCIDENCIAS:\n${report.verification.issues.map((issue) => `  - ${issue}`).join("\n")}`);
      for (const note of report.verification.notes) console.log(`  nota: ${note}`);
      return report.verification.ok ? EXIT_OK : EXIT_FAILED;
    }

    const plan = await loader.planOfficialCatalogLoad(catalog, { runId });
    const target = `${plan.target.database}@${databaseHost()}`;
    Object.assign(report, { plan, target });
    printPlan(plan, target);
    if (options.mode === "dry-run") {
      if (!plan.ready) console.log("\nDry-run con bloqueos.");
      else if (plan.pendingWrites === 0) console.log("\nEl catálogo ya está cargado: no hay nada pendiente. Usa --verify para comprobarlo.");
      else console.log(`\nDry-run sin bloqueos. Para aplicar: --apply --confirm-target ${target} --catalog-sha256 ${catalogSha256}`);
      return plan.ready ? EXIT_OK : EXIT_FAILED;
    }

    if (options["confirm-target"] !== target) throw new Error(`--confirm-target no coincide con la base conectada (${target}).`);
    if (options["catalog-sha256"].toLowerCase() !== catalogSha256) throw new Error("--catalog-sha256 no coincide con el archivo indicado.");
    const result = await loader.applyOfficialCatalogLoad(catalog, { catalogSha256, runId, user });
    Object.assign(report, { completed: result.completed, verification: result.verification });
    console.log(`\nAltas realizadas: ${result.completed.length}`);
    console.log(result.verification.ok ? "Verificación posterior correcta." : `INCIDENCIAS:\n${result.verification.issues.map((issue) => `  - ${issue}`).join("\n")}`);
    return result.verification.ok ? EXIT_OK : EXIT_FAILED;
  } catch (error) {
    report.error = { code: error.code ?? null, fields: error.fields ?? null, message: error.message };
    if (error.catalogLoad) Object.assign(report, error.catalogLoad);
    console.error(`\nERROR ${error.code ?? ""}: ${error.message}`);
    if (error.fields) console.error(Object.entries(error.fields).map(([field, message]) => `  - ${field}: ${message}`).join("\n"));
    if (report.completed?.length) console.error(`Altas realizadas antes del fallo: ${report.completed.map((item) => item.code).join(", ")}`);
    return EXIT_FAILED;
  } finally {
    report.finishedAt = new Date().toISOString();
    console.log(`Informe: ${await writeReport(options.report, "catalog-load", report)}`);
    await pool.end();
  }
}

process.exitCode = await main();
