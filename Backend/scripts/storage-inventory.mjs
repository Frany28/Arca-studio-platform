import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import pg from "pg";

import { isLoopbackDatabase, resolveDatabaseConnection } from "../src/config/databaseTls.js";
import { createReadOnlyStorageInspector } from "../src/services/objectStorage.js";
import { STORAGE_INVENTORY_DEFAULTS, runStorageInventory } from "../src/services/storageInventoryService.js";
import { writeReport } from "./lib/maintenanceCommand.mjs";
import {
  assertConfirmedTarget,
  assertReportOutsideRepository,
  describeInventoryTarget,
  loadExplicitEnvironment,
  toStorageConnection,
} from "./lib/storageInventoryTarget.mjs";

/*
 * Inventario de solo lectura del almacenamiento (E0, Fase 1.2).
 *
 * No importa dotenv/config ni config/db.js: el destino se toma exclusivamente del archivo indicado
 * con --env-file, que debe estar fuera del repositorio. Lee referencias en una transacción READ ONLY,
 * lista los buckets y consulta metadatos (HEAD). No descarga contenidos ni crea, copia, modifica o
 * elimina objetos o registros. El informe se guarda fuera del repositorio y no contiene claves
 * completas, nombres de archivo, URLs ni credenciales.
 *
 * Uso:
 *   node scripts/storage-inventory.mjs --env-file <ruta> --describe-target
 *   node scripts/storage-inventory.mjs --env-file <ruta> --confirm-database <base@host>
 *     --confirm-storage <host> --confirm-buckets <bucket[,bucket]> [--report <ruta>]
 *     [--max-head <n>] [--max-findings <n>] [--accepted-public-buckets <bucket[,bucket]>]
 *
 * --accepted-public-buckets registra como característica del entorno la publicidad que el responsable
 * aceptó (por ejemplo, un bucket de pruebas); no cambia ninguna configuración remota.
 *
 * Códigos de salida: 0 completo sin hallazgos críticos; 2 completo con hallazgos críticos (bucket
 * público o filas activas sin objeto); 3 comprobaciones incompletas; 1 error o destino no confirmado.
 */

const USAGE = `Uso:
  node scripts/storage-inventory.mjs --env-file <ruta> --describe-target
  node scripts/storage-inventory.mjs --env-file <ruta> --confirm-database <base@host> \\
    --confirm-storage <host> --confirm-buckets <bucket[,bucket]> [--report <ruta>] \\
    [--max-head <n>] [--max-findings <n>] [--accepted-public-buckets <bucket[,bucket]>]`;

/**
 * Lee y valida los argumentos de la línea de comandos sin aceptar opciones desconocidas.
 * Los límites numéricos deben ser enteros positivos.
 *
 * @param {string[]} args - Argumentos del proceso.
 * @returns {object} Opciones validadas.
 */
function parseOptions(args) {
  const { values } = parseArgs({
    args,
    options: {
      "accepted-public-buckets": { type: "string" },
      "confirm-buckets": { type: "string" },
      "confirm-database": { type: "string" },
      "confirm-storage": { type: "string" },
      "describe-target": { type: "boolean" },
      "env-file": { type: "string" },
      help: { type: "boolean" },
      "max-findings": { type: "string" },
      "max-head": { type: "string" },
      report: { type: "string" },
    },
    strict: true,
  });
  for (const name of ["max-findings", "max-head"]) {
    if (values[name] !== undefined && !(Number.isInteger(Number(values[name])) && Number(values[name]) > 0)) {
      throw new Error(`--${name} debe ser un entero positivo.`);
    }
  }
  return values;
}

/**
 * Abre un cliente PostgreSQL propio para el destino confirmado, con TLS según la regla del backend.
 * Identifica la sesión como inventario y limita conexión y consultas en el propio cliente.
 *
 * @param {Record<string, string>} environment - Variables del archivo explícito.
 * @returns {Promise<pg.Client>} Cliente conectado.
 */
async function openDatabase(environment) {
  const { connectionString, ssl } = resolveDatabaseConnection(environment, { local: isLoopbackDatabase(environment.DATABASE_URL) });
  const client = new pg.Client({
    application_name: "arca-storage-inventory",
    connectionString,
    connectionTimeoutMillis: 10_000,
    query_timeout: STORAGE_INVENTORY_DEFAULTS.statementTimeoutMs + 5_000,
    ssl,
  });
  await client.connect();
  return client;
}

/**
 * Imprime un resumen breve del informe en la terminal, sin claves ni datos de personas.
 * El detalle completo queda en el archivo privado del informe.
 *
 * @param {object} report - Informe redactado.
 * @param {string} file - Ruta del informe.
 * @returns {void}
 */
function printSummary(report, file) {
  console.log(`Resultado: ${report.completeness.outcome}`);
  for (const bucket of report.completeness.privacy) {
    const accepted = bucket.publicAccepted ? " (aceptado para este entorno)" : "";
    console.log(`Privacidad ${bucket.bucket}: ${bucket.status}${accepted}${bucket.reason ? ` (${bucket.reason})` : ""}`);
  }
  for (const listing of report.completeness.listings) console.log(`Listado ${listing.bucket}: ${listing.status}, ${listing.objects} objetos en ${listing.pages} páginas`);
  for (const orphan of report.confirmed.orphanDetection) {
    console.log(`Huérfanos ${orphan.bucket}: ${orphan.status}; candidatos ${orphan.orphanCandidates.total}; solo filas eliminadas ${orphan.deletedRowObjects.total}`);
  }
  console.log(`Filas activas sin objeto: ${report.confirmed.missingObjectsForActiveRows.total}; inaccesibles: ${report.inaccessible.total}; sin comprobar: ${report.notChecked.total}`);
  if (report.critical.length) console.log(`Hallazgos críticos: ${report.critical.join(", ")}`);
  if (report.completeness.incompleteChecks.length) console.log(`Comprobaciones incompletas: ${report.completeness.incompleteChecks.join(", ")}`);
  console.log(`Informe: ${file}`);
}

/**
 * Coordina el comando: destino explícito, confirmación previa, inventario e informe privado.
 * Ninguna conexión se abre antes de que las confirmaciones coincidan con el destino descrito.
 *
 * @returns {Promise<number>} Código de salida.
 */
async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  const environment = await loadExplicitEnvironment(options["env-file"]);
  const target = describeInventoryTarget(environment);
  if (options["describe-target"]) {
    console.log(JSON.stringify(target, null, 2));
    console.log(`\nPara inventariar (solo lectura):\n  --confirm-database ${target.database} --confirm-storage ${target.storageHost} --confirm-buckets ${[target.buckets.general, target.buckets.quotes].filter(Boolean).join(",")}`);
    return 0;
  }
  assertConfirmedTarget(target, {
    buckets: options["confirm-buckets"],
    database: options["confirm-database"],
    storage: options["confirm-storage"],
  });
  assertReportOutsideRepository(options.report);

  const storage = createReadOnlyStorageInspector(toStorageConnection(environment));
  const runId = randomUUID();
  try {
    const report = await runStorageInventory({
      // Publicidad aceptada por el responsable para este entorno: se registra, no se trata como crítica.
      acceptedPublicBuckets: String(options["accepted-public-buckets"] || "").split(",").map((value) => value.trim()).filter(Boolean),
      config: { buckets: target.buckets, supabaseUrl: environment.SUPABASE_URL || null },
      limits: {
        ...(options["max-findings"] ? { maxFindings: Number(options["max-findings"]) } : {}),
        ...(options["max-head"] ? { maxHead: Number(options["max-head"]) } : {}),
      },
      openDatabase: () => openDatabase(environment),
      run: { runId, target: { buckets: target.buckets, database: target.database, storageHost: target.storageHost } },
      storage,
    });
    const file = await writeReport(options.report, "storage-inventory", { ...report, mode: "inventory", runId, startedAt: report.run.startedAt });
    printSummary(report, file);
    if (report.completeness.outcome !== "complete") return 3;
    return report.critical.length ? 2 : 0;
  } finally {
    storage.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    // Solo el mensaje propio del comando; los errores de proveedores se reducen a su código.
    const message = error?.code ? `${error.code}` : error?.message || "Error desconocido";
    console.error(`Inventario detenido: ${message}`);
    console.error(USAGE);
    process.exitCode = 1;
  });
