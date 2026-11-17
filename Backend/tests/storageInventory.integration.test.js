import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";
import {
  beginReadOnlySnapshot,
  createReadOnlyInventoryClient,
  endReadOnlySnapshot,
} from "../src/repositories/storageInventoryRepository.js";
import { runStorageInventory } from "../src/services/storageInventoryService.js";

/*
 * Integración del inventario con PostgreSQL real (E0). Opcional y solo local:
 *   ARCA_STORAGE_INVENTORY_DB_TESTS=1
 *   ARCA_STORAGE_INVENTORY_TEST_DATABASE_URL=postgres://postgres@localhost:54329/postgres
 * Crea una base desechable con todo el historial de migraciones, un esquema `storage.buckets` que
 * imita los metadatos de Supabase y un rol de solo lectura propio del clúster local. Nunca lee .env
 * ni DATABASE_URL, y el helper rechaza hosts remotos. Los datos son ficticios.
 */

const ENABLED = process.env.ARCA_STORAGE_INVENTORY_DB_TESTS === "1";
const BASE_URL = process.env.ARCA_STORAGE_INVENTORY_TEST_DATABASE_URL;
const BACKEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = !ENABLED || !BASE_URL ? "Define ARCA_STORAGE_INVENTORY_DB_TESTS=1 y ARCA_STORAGE_INVENTORY_TEST_DATABASE_URL (local)." : false;

const GENERAL = "general-files";
const QUOTES = "quote-pdfs";
const CONFIG = { buckets: { general: GENERAL, quotes: QUOTES }, supabaseUrl: null };
const APPLICATION_NAME = "arca-storage-inventory-it";

const KEYS = {
  deleted: "projects/1/users/1/2026/09/files/3/v1/borrador.pdf",
  missing: "projects/1/users/1/2026/11/files/2/v1/contrato.pdf",
  orphan: "projects/9/users/1/2026/07/files/99/v1/huerfano.pdf",
  photo: "users/1/profile-photo/2026/08/1754-foto.jpg",
  present: "projects/1/users/1/2026/11/files/1/v1/plano.pdf",
  quote: "quotes/1/versions/v1/COT-001-v1.pdf",
  support: "support-requests/1/users/1/2026/11/files/1/v1/captura.png",
};

let database;
let ownerUrl;
let readerUrl;
let readerRole;
let rlsReaderRole;
let rlsReaderUrl;

/**
 * Inserta datos ficticios que referencian objetos en las cuatro fuentes del inventario.
 *
 * @param {pg.Client} client - Cliente propietario de la base desechable.
 * @returns {Promise<void>}
 */
async function seed(client) {
  await client.query("insert into public.roles (id, code, name) values (1, 'admin', 'Administrador')");
  await client.query(`insert into public.users (id, role_id, first_name, last_name, email, password_hash, profile_photo_url)
    values (1, 1, 'Persona', 'Ficticia', 'ficticia@example.test', 'x', $1)`, [`s3://${GENERAL}/${KEYS.photo}`]);
  await client.query("insert into public.clients (id, name) values (1, 'Cliente ficticio')");
  await client.query(`insert into public.projects (id, client_id, created_by, name, status, progress, is_public, public_slug)
    values (1, 1, 1, 'Proyecto ficticio', 'draft', 0, false, 'proyecto-ficticio-1')`);
  const versions = [
    [1, KEYS.present, 100, false],
    [2, KEYS.missing, 10, false],
    [3, KEYS.deleted, 10, true],
  ];
  for (const [id, key, size, deleted] of versions) {
    await client.query(`insert into public.files (id, project_id, uploaded_by, title, file_type, current_version, deleted_at, status)
      values ($1, 1, 1, $2, 'application/pdf', 1, $3, $4::file_status)`, [id, `archivo-${id}.pdf`, deleted ? new Date() : null, deleted ? "deleted" : "active"]);
    await client.query(`insert into public.file_versions (id, file_id, uploaded_by, version_number, file_name, original_name, file_url, file_extension, file_size, deleted_at)
      values ($1, $1, 1, 1, $2, $3, $4, 'pdf', $5, $6)`, [id, key, `archivo-${id}.pdf`, `s3://${GENERAL}/${key}`, size, deleted ? new Date() : null]);
  }
  await client.query("insert into public.support_requests (id, user_id, subject, description) values (1, 1, 'Asunto', 'Descripción')");
  await client.query(`insert into public.support_request_files (id, support_request_id, uploaded_by, original_name, file_type, file_size, storage_key, file_url)
    values (1, 1, 1, 'captura.png', 'image/png', 20, $1, $2)`, [KEYS.support, `s3://${GENERAL}/${KEYS.support}`]);
  await client.query("insert into public.quotes (id, code, created_by, updated_by) values (1, 'COT-001', 1, 1)");
  await client.query(`insert into public.quote_versions (id, quote_id, version_number, client_id, client_name, project_id, project_name, services_total, created_by)
    values (1, 1, 1, 1, 'Cliente ficticio', 1, 'Proyecto ficticio', 0, 1)`);
  await client.query(`insert into public.quote_pdf_documents (quote_version_id, object_key, file_name, document_model, source_hash, time_zone,
      layout_revision, bucket, status, size_bytes, content_hash, generated_at, stored_at)
    values (1, $1, 'COT-001-v1.pdf', '{}'::jsonb, $2, 'America/Caracas', 1, $3, 'available', 2048, $2, now(), now())`, [KEYS.quote, "0".repeat(64), QUOTES]);

  // Metadatos de buckets como en Supabase: el general privado y el de cotizaciones también.
  await client.query("create schema storage");
  await client.query("create table storage.buckets (id text primary key, public boolean not null)");
  await client.query("insert into storage.buckets (id, public) values ($1, false), ($2, false)", [GENERAL, QUOTES]);
}

/**
 * Crea un rol LOGIN con solo SELECT sobre las tablas que lee el inventario, en el clúster local.
 * Con `bypassRls` el rol ve todas las filas pese a RLS (las tablas de ARCA lo tienen activo).
 *
 * @param {pg.Client} client - Cliente propietario.
 * @param {string} databaseName - Base desechable.
 * @param {{ bypassRls: boolean }} options - Atributo BYPASSRLS del rol.
 * @returns {Promise<string>} Nombre del rol.
 */
async function createReaderRole(client, databaseName, { bypassRls }) {
  const role = `arca_inventory_reader_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await client.query(`create role ${role} login ${bypassRls ? "bypassrls" : "nobypassrls"}`);
  await client.query(`grant connect on database "${databaseName}" to ${role}`);
  await client.query(`grant usage on schema public, storage to ${role}`);
  await client.query(`grant select on public.file_versions, public.files, public.support_request_files, public.support_requests,
    public.users, public.quote_pdf_documents, storage.buckets to ${role}`);
  return role;
}

/**
 * Almacenamiento simulado: el objeto "missing" no está y hay un huérfano.
 *
 * @returns {{ listPage: Function, headObject: Function }} Inspector simulado.
 */
function fakeStorage() {
  const objects = {
    [GENERAL]: [KEYS.present, KEYS.deleted, KEYS.photo, KEYS.support, KEYS.orphan].map((key) => ({ key, lastModified: "2026-11-01T00:00:00.000Z", size: key === KEYS.present ? 100 : 10 })),
    [QUOTES]: [{ key: KEYS.quote, lastModified: "2026-11-01T00:00:00.000Z", size: 2048 }],
  };
  return {
    async headObject({ key }) {
      return key === KEYS.missing ? { status: "missing" } : { status: "inaccessible", code: "AccessDenied", httpStatus: 403 };
    },
    async listPage({ bucket }) {
      return { isTruncated: false, nextToken: null, objects: objects[bucket] || [] };
    },
  };
}

/**
 * Ejecuta el inventario con un rol de solo lectura y una conexión real.
 *
 * @param {object} [limits] - Límites del inventario.
 * @param {string} [connectionString] - Rol de conexión; por defecto el lector con BYPASSRLS.
 * @returns {Promise<object>} Informe.
 */
function runAsReader(limits, connectionString = readerUrl) {
  return runStorageInventory({
    config: CONFIG,
    limits,
    openDatabase: async () => {
      const client = new pg.Client({ application_name: APPLICATION_NAME, connectionString, ssl: false });
      await client.connect();
      return client;
    },
    run: { runId: "it", target: {} },
    storage: fakeStorage(),
  });
}

/**
 * Calcula una huella del contenido de las tablas leídas para comprobar que nada cambia.
 *
 * @returns {Promise<string>} Huella.
 */
async function fingerprintData() {
  const result = await database.client.query(`
    select md5(string_agg(t, '|' order by t)) as fingerprint from (
      select 'fv' || row_to_json(v)::text as t from public.file_versions v
      union all select 'f' || row_to_json(f)::text from public.files f
      union all select 's' || row_to_json(s)::text from public.support_request_files s
      union all select 'u' || row_to_json(u)::text from public.users u
      union all select 'q' || row_to_json(q)::text from public.quote_pdf_documents q
      union all select 'b' || row_to_json(b)::text from storage.buckets b
    ) rows`);
  return result.rows[0].fingerprint;
}

/**
 * Cuenta las sesiones abiertas del inventario en el clúster local.
 *
 * @returns {Promise<number>} Sesiones con el nombre de aplicación del inventario.
 */
async function inventorySessions() {
  const result = await database.client.query("select count(*)::int as count from pg_stat_activity where application_name = any($1::text[])", [[APPLICATION_NAME, "arca-storage-inventory"]]);
  return result.rows[0].count;
}

before(async () => {
  if (SKIP) return;
  database = await createIsolatedMigrationDatabase({ baseUrl: BASE_URL, prefix: "arca_storage_inventory" });
  ownerUrl = database.databaseUrl;
  await seed(database.client);
  const databaseName = new URL(ownerUrl).pathname.slice(1);
  readerRole = await createReaderRole(database.client, databaseName, { bypassRls: true });
  rlsReaderRole = await createReaderRole(database.client, databaseName, { bypassRls: false });
  readerUrl = urlForRole(readerRole);
  rlsReaderUrl = urlForRole(rlsReaderRole);
});

after(async () => {
  if (SKIP || !database) return;
  await database.drop();
  // Los roles son globales del clúster: se eliminan después de la base que tenía sus permisos.
  const admin = new pg.Client({ connectionString: BASE_URL, ssl: false });
  await admin.connect();
  for (const role of [readerRole, rlsReaderRole].filter(Boolean)) await admin.query(`drop role if exists ${role}`).catch(() => {});
  await admin.end();
});

/**
 * Construye la URL de la base desechable para otro rol del clúster local (autenticación trust).
 *
 * @param {string} role - Rol de conexión.
 * @returns {string} URL sin contraseña.
 */
function urlForRole(role) {
  const url = new URL(ownerUrl);
  url.username = role;
  url.password = "";
  return url.toString();
}

test("RLS activo sin BYPASSRLS deja las fuentes incompletas en lugar de leer cero filas como completas", { skip: SKIP }, async () => {
  const report = await runAsReader(undefined, rlsReaderUrl);
  for (const source of ["file_versions", "support_request_files", "users", "quote_pdf_documents"]) {
    assert.deepEqual(report.completeness.sources[source], { errorCode: "ROW_LEVEL_SECURITY_FILTERS_ROWS", status: "failed" }, source);
  }
  // Ningún objeto válido se presenta como huérfano por no haber podido leer sus referencias.
  assert.ok(report.confirmed.orphanDetection.every((orphan) => orphan.status === "incomplete" && orphan.orphanCandidates.total === 0));
  assert.equal(report.completeness.outcome, "incomplete");
  assert.equal(await inventorySessions(), 0);
});

test("las consultas reales leen las cuatro fuentes y la privacidad con un rol de solo lectura", { skip: SKIP }, async () => {
  const before = await fingerprintData();
  const report = await runAsReader();

  assert.deepEqual(Object.fromEntries(Object.entries(report.completeness.sources).map(([source, state]) => [source, [state.status, state.rows]])), {
    file_versions: ["complete", 3],
    quote_pdf_documents: ["complete", 1],
    support_request_files: ["complete", 1],
    users: ["complete", 1],
  });
  assert.deepEqual(report.completeness.privacy.map((bucket) => [bucket.bucket, bucket.status]), [[GENERAL, "private"], [QUOTES, "private"]]);
  assert.equal(report.confirmed.missingObjectsForActiveRows.total, 1);
  const general = report.confirmed.orphanDetection.find((orphan) => orphan.bucket === GENERAL);
  assert.equal(general.status, "complete");
  assert.equal(general.orphanCandidates.total, 1);
  assert.equal(general.deletedRowObjects.total, 1);
  assert.equal(report.confirmed.urlKeyMismatches.total, 0);
  assert.equal(report.completeness.outcome, "complete");

  assert.equal(await fingerprintData(), before, "El inventario no debe modificar datos");
  assert.equal(await inventorySessions(), 0, "El inventario debe cerrar su conexión");
});

test("la transacción del inventario rechaza escrituras en el servidor aunque el rol sea propietario", { skip: SKIP }, async () => {
  const owner = new pg.Client({ application_name: APPLICATION_NAME, connectionString: ownerUrl, ssl: false });
  await owner.connect();
  try {
    const guarded = createReadOnlyInventoryClient(owner);
    await beginReadOnlySnapshot(guarded, { idleTimeoutMs: 10_000, lockTimeoutMs: 1_000, statementTimeoutMs: 10_000 });
    // Saltando la guardia del cliente a propósito: el servidor también lo impide (25006).
    await assert.rejects(() => owner.query("update public.users set first_name = 'Cambio' where id = 1"), { code: "25006" });
    await assert.rejects(() => guarded.query("update public.users set first_name = 'Cambio' where id = 1"), { code: "READ_ONLY_STATEMENT_REQUIRED" });
    await endReadOnlySnapshot(guarded);
    const state = await owner.query("select first_name from public.users where id = 1");
    assert.equal(state.rows[0].first_name, "Persona");
  } finally {
    await owner.end();
  }
});

test("un permiso denegado deja la fuente y la privacidad incompletas, nunca como objetos ausentes", { skip: SKIP }, async () => {
  await database.client.query(`revoke select on public.support_request_files from ${readerRole}`);
  await database.client.query(`revoke select on storage.buckets from ${readerRole}`);
  try {
    const report = await runAsReader();
    assert.deepEqual(report.completeness.sources.support_request_files, { errorCode: "42501", status: "failed" });
    assert.equal(report.completeness.sources.file_versions.status, "complete");
    assert.deepEqual(report.completeness.privacy.map((bucket) => bucket.status), ["unknown", "unknown"]);
    assert.equal(report.completeness.privacy[0].reason, "privacy_query_failed:42501");
    const general = report.confirmed.orphanDetection.find((orphan) => orphan.bucket === GENERAL);
    assert.equal(general.status, "incomplete");
    assert.equal(general.reason, "sources_incomplete:support_request_files");
    // El objeto de soporte, cuya referencia no se pudo leer, no aparece como huérfano.
    assert.equal(general.orphanCandidates.total, 0);
    assert.equal(report.completeness.outcome, "incomplete");
    assert.equal(await inventorySessions(), 0);
  } finally {
    await database.client.query(`grant select on public.support_request_files, storage.buckets to ${readerRole}`);
  }
});

test("un bloqueo concurrente agota lock_timeout en una fuente sin esperar indefinidamente", { skip: SKIP }, async () => {
  const locker = new pg.Client({ connectionString: ownerUrl, ssl: false });
  await locker.connect();
  try {
    await locker.query("begin");
    await locker.query("lock table public.users in access exclusive mode");
    const started = Date.now();
    const report = await runAsReader({ lockTimeoutMs: 300 });
    assert.ok(Date.now() - started < 10_000);
    assert.deepEqual(report.completeness.sources.users, { errorCode: "55P03", status: "failed" });
    assert.equal(report.completeness.sources.file_versions.status, "complete");
    assert.equal(report.completeness.outcome, "incomplete");
  } finally {
    await locker.query("rollback");
    await locker.end();
  }
  assert.equal(await inventorySessions(), 0);
});

test("el comando completo usa la base local explícita y un almacenamiento inaccesible queda incompleto, no ausente", { skip: SKIP }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "arca-storage-inventory-it-"));
  try {
    const target = new URL(readerUrl);
    const envFile = path.join(directory, "inventory.env");
    await writeFile(envFile, [
      `DATABASE_URL=${readerUrl}`,
      `SUPABASE_STORAGE_BUCKET=${GENERAL}`,
      `SUPABASE_QUOTE_PDF_BUCKET=${QUOTES}`,
      "SUPABASE_STORAGE_S3_ACCESS_KEY_ID=clave-ficticia",
      "SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY=secreto-ficticio",
      "SUPABASE_STORAGE_S3_ENDPOINT=http://127.0.0.1:1/storage/v1/s3",
      "",
    ].join("\n"), "utf8");
    const reportFile = path.join(directory, "informe.json");
    const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(DATABASE_|DIRECT_URL|SUPABASE_)/.test(name)));
    const result = spawnSync(process.execPath, [
      path.join(BACKEND_ROOT, "scripts", "storage-inventory.mjs"),
      "--env-file", envFile,
      "--confirm-database", `${target.pathname.slice(1)}@${target.hostname}:${target.port}`,
      "--confirm-storage", "127.0.0.1:1",
      "--confirm-buckets", `${GENERAL},${QUOTES}`,
      "--report", reportFile,
    ], { cwd: BACKEND_ROOT, encoding: "utf8", env: environment, timeout: 60_000 });
    assert.equal(result.status, 3, `${result.stdout}${result.stderr}`);

    const report = JSON.parse(await readFile(reportFile, "utf8"));
    assert.equal(report.completeness.sources.file_versions.status, "complete");
    assert.ok(report.completeness.listings.every((listing) => listing.status === "incomplete"));
    // Sin respuesta del almacenamiento, ninguna referencia se declara ausente.
    assert.equal(report.confirmed.missingObjectsForActiveRows.total, 0);
    assert.ok(report.inaccessible.total > 0);
    assert.ok(report.confirmed.orphanDetection.every((orphan) => orphan.status === "incomplete"));
    const serialized = JSON.stringify(report);
    for (const key of Object.values(KEYS)) assert.ok(!serialized.includes(key));
    for (const secret of ["clave-ficticia", "secreto-ficticio", readerRole]) assert.ok(!serialized.includes(secret), secret);
    assert.deepEqual((await readdir(directory)).sort(), ["informe.json", "inventory.env"]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
  assert.equal(await inventorySessions(), 0);
});
