// Comprobación de integridad tras un escenario de carga (Fase 3). Solo lectura.
//
//   node load-tests/env/integrity-check.mjs [--baseline=archivo.json] [--write-baseline=archivo.json]
//
// Comprueba en PostgreSQL y MinIO: archivos duplicados por proyecto, archivos sin versión vigente,
// versiones sin objeto y objetos sin fila (huérfanos), transacciones abiertas, bloqueos en espera y
// conexiones de la aplicación. Con --baseline compara los recuentos con los de antes de la prueba
// (por ejemplo, comentarios creados frente a los que k6 informa como creados).
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { collectIsolationViolations, failOnViolations } from "./isolation.mjs";

const options = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")));
const skipObjects = "skip-objects" in options;
failOnViolations(collectIsolationViolations(process.env, { requireStorage: !skipObjects }), "la comprobación de integridad");

const backendDirectory = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(join(backendDirectory, "package.json"));
const pg = require("pg");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: false });
await client.connect();

/**
 * Ejecuta una consulta de recuento y devuelve el número.
 *
 * @param {string} sql - Consulta que devuelve una columna `total`.
 * @returns {Promise<number>} Recuento.
 */
async function count(sql) {
  return Number((await client.query(sql)).rows[0].total);
}

const counts = {
  comments: await count("select count(*) as total from public.project_comments where deleted_at is null"),
  files: await count("select count(*) as total from public.files where deleted_at is null and status <> 'deleted'"),
  projectRequests: await count("select count(*) as total from public.project_requests where deleted_at is null"),
  quotes: await count("select count(*) as total from public.quotes"),
};
const checks = {
  activeConnections: await count("select count(*) as total from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()"),
  duplicateProjectFiles: await count(`select count(*) as total from (
    select project_id, lower(title) from public.files
    where project_id is not null and deleted_at is null and status <> 'deleted'
    group by 1, 2 having count(*) > 1) duplicates`),
  filesWithoutCurrentVersion: await count(`select count(*) as total from public.files f
    where f.deleted_at is null and f.status <> 'deleted'
      and not exists (select 1 from public.file_versions v where v.file_id = f.id and v.is_current and v.deleted_at is null)`),
  idleInTransaction: await count("select count(*) as total from pg_stat_activity where datname = current_database() and state = 'idle in transaction'"),
  waitingLocks: await count("select count(*) as total from pg_locks where not granted"),
};

let storage = { skipped: true };
if (!skipObjects) {
  const { ListObjectsV2Command, S3Client } = require("@aws-sdk/client-s3");
  const s3 = new S3Client({
    credentials: { accessKeyId: process.env.SUPABASE_STORAGE_S3_ACCESS_KEY_ID, secretAccessKey: process.env.SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY },
    endpoint: process.env.SUPABASE_STORAGE_S3_ENDPOINT,
    forcePathStyle: true,
    region: process.env.SUPABASE_STORAGE_S3_REGION || "us-east-1",
  });
  const objects = new Set();
  let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: process.env.SUPABASE_STORAGE_BUCKET, ContinuationToken: token }));
    for (const object of page.Contents || []) objects.add(object.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  const recorded = new Set((await client.query("select file_name from public.file_versions where deleted_at is null")).rows.map((row) => row.file_name));
  const deleted = new Set((await client.query("select file_name from public.file_versions where deleted_at is not null")).rows.map((row) => row.file_name));
  const support = new Set((await client.query("select storage_key from public.support_request_files")).rows.map((row) => row.storage_key));
  storage = {
    objects: objects.size,
    // Objetos sin fila: huérfanos (por ejemplo, una compensación fallida o un borrado posterior fallido).
    orphanObjects: [...objects].filter((key) => !recorded.has(key) && !support.has(key) && !deleted.has(key)).length,
    objectsOfDeletedFiles: [...objects].filter((key) => deleted.has(key)).length,
    // Filas sin objeto: descargas que fallarían.
    rowsWithoutObject: [...recorded].filter((key) => !objects.has(key)).length,
  };
}
await client.end();

const result = { checks, counts, storage, timestamp: new Date().toISOString(), type: "loadtest_integrity" };
if (options.baseline) {
  const baseline = JSON.parse(readFileSync(options.baseline, "utf8"));
  result.delta = Object.fromEntries(Object.entries(counts).map(([name, value]) => [name, value - (baseline.counts?.[name] ?? 0)]));
}
if (options["write-baseline"]) writeFileSync(options["write-baseline"], JSON.stringify(result, null, 2));

const problems = [
  checks.duplicateProjectFiles && "archivos duplicados en un proyecto",
  checks.filesWithoutCurrentVersion && "archivos sin versión vigente",
  checks.idleInTransaction && "transacciones abiertas sin actividad",
  checks.waitingLocks && "bloqueos en espera",
  storage.orphanObjects && "objetos huérfanos en el almacenamiento",
  storage.rowsWithoutObject && "archivos registrados sin objeto",
].filter(Boolean);
result.ok = problems.length === 0;
result.problems = problems;
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
