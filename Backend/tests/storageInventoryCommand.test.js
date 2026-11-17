import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

// El comando se ejecuta en un subproceso con un archivo de entorno temporal y ficticio. Los hosts
// apuntan a un puerto local cerrado: si el comando intentara conectar, el error sería de conexión y
// no el rechazo del destino que esperan estas pruebas.
const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMMAND = path.join(BACKEND_ROOT, "scripts", "storage-inventory.mjs");
let directory;
let envFile;

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "arca-storage-inventory-"));
  envFile = path.join(directory, "inventory.env");
  await writeFile(envFile, [
    "DATABASE_URL=postgresql://lector:secreto-db@127.0.0.1:1/arca_inventario",
    "SUPABASE_STORAGE_BUCKET=general-files",
    "SUPABASE_QUOTE_PDF_BUCKET=quote-pdfs",
    "SUPABASE_STORAGE_S3_ACCESS_KEY_ID=clave-acceso",
    "SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY=secreto-s3",
    "SUPABASE_STORAGE_S3_ENDPOINT=http://127.0.0.1:1/storage/v1/s3",
    "",
  ].join("\n"), "utf8");
});

after(async () => {
  await rm(directory, { force: true, recursive: true });
});

/**
 * Ejecuta el comando con un entorno de proceso sin variables de base de datos ni almacenamiento.
 *
 * @param {string[]} args - Argumentos del comando.
 * @returns {{ status: number|null, output: string }} Código de salida y salida combinada.
 */
function runCommand(args) {
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(DATABASE_|DIRECT_URL|SUPABASE_)/.test(name)));
  const result = spawnSync(process.execPath, [COMMAND, ...args], { cwd: BACKEND_ROOT, encoding: "utf8", env: environment, timeout: 20_000 });
  return { output: `${result.stdout}${result.stderr}`, status: result.status };
}

test("--describe-target muestra el destino sin credenciales y sin conectar", () => {
  const { output, status } = runCommand(["--env-file", envFile, "--describe-target"]);
  assert.equal(status, 0, output);
  assert.match(output, /arca_inventario@127\.0\.0\.1:1/);
  assert.match(output, /--confirm-buckets general-files,quote-pdfs/);
  for (const secret of ["secreto-db", "lector", "clave-acceso", "secreto-s3"]) assert.ok(!output.includes(secret), secret);
});

test("sin confirmaciones el comando se detiene antes de conectar", () => {
  const { output, status } = runCommand(["--env-file", envFile]);
  assert.equal(status, 1, output);
  assert.match(output, /Destino no confirmado/);
  assert.doesNotMatch(output, /ECONNREFUSED/);
});

test("sin --env-file o con Backend/.env el comando se detiene", () => {
  const missing = runCommand([]);
  assert.equal(missing.status, 1);
  assert.match(missing.output, /--env-file/);
  const repositoryEnv = runCommand(["--env-file", path.join(BACKEND_ROOT, ".env"), "--describe-target"]);
  assert.equal(repositoryEnv.status, 1);
  assert.match(repositoryEnv.output, /dentro del repositorio/);
});

test("un informe dentro del repositorio se rechaza antes de conectar", () => {
  const { output, status } = runCommand([
    "--env-file", envFile,
    "--confirm-database", "arca_inventario@127.0.0.1:1",
    "--confirm-storage", "127.0.0.1:1",
    "--confirm-buckets", "general-files,quote-pdfs",
    "--report", path.join(BACKEND_ROOT, "informe.json"),
  ]);
  assert.equal(status, 1, output);
  assert.match(output, /dentro del repositorio/);
});
