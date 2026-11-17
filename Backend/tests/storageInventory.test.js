import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketPolicyCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

import {
  describeStorageKeyShape,
  fingerprintStorageKey,
  toStorageReferences,
} from "../src/domain/storageInventory.js";
import { assertReadOnlyInventoryStatement } from "../src/repositories/storageInventoryRepository.js";
import { assertReadOnlyStorageCommand, createReadOnlyStorageInspector } from "../src/services/objectStorage.js";
import { runStorageInventory } from "../src/services/storageInventoryService.js";
import { describeStorageReference, parseStorageObjectKey } from "../src/utils/storageObjectKey.js";

// Datos ficticios: nombres de personas en claves para comprobar que el informe nunca los expone.
const GENERAL = "general-files";
const QUOTES = "quote-pdfs";
const SUPABASE_URL = "https://example-project.supabase.co";
const CONFIG = { buckets: { general: GENERAL, quotes: QUOTES }, supabaseUrl: SUPABASE_URL };

const PROJECT_KEY = "projects/31/users/7/2026/11/files/901/v1/cedula-juan-perez.pdf";
const REQUEST_KEY = "project-requests/12/users/9/2026/10/files/902/v1/plano-maria-gomez.jpg";
const MISSING_KEY = "projects/31/users/7/2026/11/files/903/v1/contrato-ana-ruiz.pdf";
const DELETED_KEY = "projects/31/users/7/2026/09/files/904/v1/borrador-luis.pdf";
const PHOTO_KEY = "users/7/profile-photo/2026/08/1754-foto-juan-perez.jpg";
const SUPPORT_KEY = "support-requests/4/users/7/2026/11/files/55/v1/captura-error.png";
const ORPHAN_KEY = "projects/40/users/2/2026/07/files/777/v1/presupuesto-carla.xlsx";
const QUOTE_KEY = "quotes/57/versions/v1/COT-0057-v1.pdf";

const publicUrl = (key) => `${SUPABASE_URL}/storage/v1/object/public/${GENERAL}/${key}`;

/**
 * Filas simuladas de PostgreSQL por fuente, en el formato que devuelve el repositorio.
 *
 * @returns {Record<string, Array<object>>} Filas por fuente.
 */
function sampleRows() {
  return {
    file_versions: [
      { context: "project", file_size: "100", file_url: publicUrl(PROJECT_KEY), id: "1", owner_deleted: false, storage_key: PROJECT_KEY, version_deleted: false },
      { context: "project", file_size: "50", file_url: publicUrl(REQUEST_KEY), id: "2", owner_deleted: false, storage_key: REQUEST_KEY, version_deleted: false },
      { context: "project", file_size: "10", file_url: publicUrl(MISSING_KEY), id: "3", owner_deleted: false, storage_key: MISSING_KEY, version_deleted: false },
      { context: "project", file_size: "10", file_url: publicUrl(DELETED_KEY), id: "4", owner_deleted: true, storage_key: DELETED_KEY, version_deleted: true },
    ],
    quote_pdf_documents: [
      { bucket: QUOTES, file_size: 2048, id: "5", status: "available", storage_key: QUOTE_KEY },
      { bucket: QUOTES, file_size: null, id: "6", status: "pending", storage_key: "quotes/58/versions/v1/COT-0058-v1.pdf" },
    ],
    support_request_files: [
      { context: "support", file_size: "20", file_url: `s3://${GENERAL}/${SUPPORT_KEY}`, id: "8", owner_deleted: false, storage_key: SUPPORT_KEY, version_deleted: false },
    ],
    users: [
      { id: "7", owner_deleted: false, profile_photo_url: publicUrl(PHOTO_KEY), signature_url: null },
      { id: "11", owner_deleted: false, profile_photo_url: "https://otro-host.example/img/avatar.png", signature_url: null },
    ],
  };
}

/**
 * Cliente PostgreSQL simulado que registra cada sentencia y responde por fuente.
 *
 * @param {object} [options] - Fallos simulados.
 * @param {string[]} [options.failSources] - Fuentes cuya consulta falla.
 * @param {boolean} [options.privacyFails] - Si la consulta de privacidad falla.
 * @param {Array<object>} [options.privacy] - Filas de storage.buckets.
 * @param {Record<string, Array<object>>} [options.rows] - Filas por fuente.
 * @returns {{ query: Function, end: Function, statements: string[], ended: boolean }} Cliente simulado.
 */
function createFakeDatabase({ failSources = [], privacy = [{ id: GENERAL, public: false }, { id: QUOTES, public: false }], privacyFails = false, rlsFiltered = [], rows = sampleRows() } = {}) {
  const fake = {
    ended: false,
    statements: [],
    async end() {
      fake.ended = true;
    },
    async query(text, params = []) {
      const normalized = text.replace(/\s+/g, " ").trim();
      fake.statements.push(normalized);
      if (!/^select\b/i.test(normalized)) return { rows: [] };
      if (normalized.includes("from pg_class")) {
        return { rows: params[0].map((name) => ({ filtered: rlsFiltered.includes(name), qualified_name: name })) };
      }
      if (normalized.includes("storage.buckets")) {
        if (privacyFails) throw Object.assign(new Error("relation storage.buckets does not exist at host db.internal"), { code: "42P01" });
        return { rows: privacy };
      }
      const source = ["file_versions", "quote_pdf_documents", "support_request_files"].find((name) => normalized.includes(`from public.${name}`))
        || (normalized.includes("from public.users") ? "users" : null);
      if (failSources.includes(source)) throw Object.assign(new Error(`permission denied for ${source}`), { code: "42501" });
      const [afterId, limit] = params;
      return { rows: (rows[source] || []).filter((row) => Number(row.id) > Number(afterId)).slice(0, limit) };
    },
  };
  return fake;
}

/**
 * Almacenamiento simulado con listado paginado y HEAD configurables.
 *
 * @param {object} [options] - Contenido y fallos simulados.
 * @param {Record<string, Array<object>>} [options.objects] - Objetos por bucket.
 * @param {number} [options.pageSize] - Objetos por página.
 * @param {string[]} [options.failListing] - Buckets cuyo listado falla en la segunda página.
 * @param {Record<string, object>} [options.head] - Respuestas HEAD por clave.
 * @returns {{ listPage: Function, headObject: Function, calls: Array<object> }} Inspector simulado.
 */
function createFakeStorage({ failListing = [], head = {}, objects, pageSize = 2 } = {}) {
  const contents = objects || {
    [GENERAL]: [
      { key: PROJECT_KEY, lastModified: "2026-11-01T00:00:00.000Z", size: 100 },
      { key: REQUEST_KEY, lastModified: "2026-10-01T00:00:00.000Z", size: 51 },
      { key: DELETED_KEY, lastModified: "2026-09-01T00:00:00.000Z", size: 10 },
      { key: PHOTO_KEY, lastModified: "2026-08-01T00:00:00.000Z", size: 5 },
      { key: SUPPORT_KEY, lastModified: "2026-11-02T00:00:00.000Z", size: 20 },
      { key: ORPHAN_KEY, lastModified: "2026-07-01T00:00:00.000Z", size: 70 },
      { key: "projects/.emptyFolderPlaceholder", lastModified: null, size: 0 },
    ],
    [QUOTES]: [{ key: QUOTE_KEY, lastModified: "2026-11-03T00:00:00.000Z", size: 2048 }],
  };
  const calls = [];
  return {
    calls,
    async headObject({ bucket, key }) {
      calls.push({ bucket, key, type: "head" });
      return head[key] || { status: "missing" };
    },
    async listPage({ bucket, continuationToken }) {
      calls.push({ bucket, continuationToken, type: "list" });
      const start = continuationToken ? Number(continuationToken) : 0;
      if (failListing.includes(bucket) && start > 0) throw Object.assign(new Error(`AccessDenied on ${bucket}/${PROJECT_KEY}`), { name: "AccessDenied" });
      const all = contents[bucket] || [];
      const page = all.slice(start, start + pageSize);
      const next = start + pageSize;
      return { isTruncated: next < all.length, nextToken: next < all.length ? String(next) : null, objects: page };
    },
  };
}

/**
 * Ejecuta el inventario con dependencias simuladas.
 *
 * @param {object} [options] - Opciones de las simulaciones.
 * @param {object} [options.database] - Opciones del PostgreSQL simulado.
 * @param {object} [options.storage] - Opciones del almacenamiento simulado.
 * @param {object} [options.limits] - Límites del inventario.
 * @returns {Promise<{ report: object, database: object, storage: object }>} Informe y simulaciones.
 */
async function runWithFakes({ database: databaseOptions, limits, storage: storageOptions } = {}) {
  const database = createFakeDatabase(databaseOptions);
  const storage = createFakeStorage(storageOptions);
  const report = await runStorageInventory({
    config: CONFIG,
    limits,
    now: () => new Date("2026-11-17T12:00:00.000Z"),
    openDatabase: async () => database,
    run: { runId: "run-test", target: { buckets: CONFIG.buckets, database: "postgres@db.example", storageHost: "s3.example" } },
    storage,
  });
  return { database, report, storage };
}

test("describeStorageReference conserva la regla histórica e identifica el motivo de rechazo", () => {
  const options = { bucket: GENERAL, supabaseUrl: SUPABASE_URL };
  assert.equal(parseStorageObjectKey(publicUrl(PHOTO_KEY), options), PHOTO_KEY);
  assert.equal(parseStorageObjectKey(`s3://${GENERAL}/${PHOTO_KEY}`, options), PHOTO_KEY);
  // Host histórico distinto de SUPABASE_URL: se acepta por la ruta /storage/v1/object/public/<bucket>/.
  assert.equal(parseStorageObjectKey(`https://historico.example/storage/v1/object/public/${GENERAL}/a%20b.png`, options), "a b.png");
  assert.equal(parseStorageObjectKey(`https://historico.example/storage/v1/object/sign/${GENERAL}/x.png?token=1`, options), "x.png");
  assert.deepEqual(describeStorageReference("", options), { key: null, reason: "empty" });
  assert.deepEqual(describeStorageReference(publicUrl(PHOTO_KEY), { bucket: null }), { key: null, reason: "no_bucket" });
  assert.deepEqual(describeStorageReference(`s3://otro/${PHOTO_KEY}`, options), { key: null, reason: "foreign_bucket" });
  assert.deepEqual(describeStorageReference(`${SUPABASE_URL}/storage/v1/object/public/otro/${PHOTO_KEY}`, options), { key: null, reason: "foreign_bucket" });
  assert.deepEqual(describeStorageReference("https://otro-host.example/img/avatar.png", options), { key: null, reason: "unrecognized" });
  assert.deepEqual(describeStorageReference(`${SUPABASE_URL}/storage/v1/object/public/${GENERAL}/`, options), { key: null, reason: "unrecognized" });
});

test("la forma y la huella de una clave no contienen nombres ni ids concretos", () => {
  assert.equal(describeStorageKeyShape(PROJECT_KEY), "projects/<n>/users/<n>/<n>/<n>/files/<n>/v<n>/<archivo>.pdf");
  assert.equal(describeStorageKeyShape(PHOTO_KEY), "users/<n>/profile-photo/<n>/<n>/<archivo>.jpg");
  assert.equal(describeStorageKeyShape("carpeta-juan/otra/archivo"), "<texto>/<texto>/<archivo>");
  assert.match(fingerprintStorageKey(GENERAL, PROJECT_KEY), /^[0-9a-f]{16}$/);
  assert.notEqual(fingerprintStorageKey(GENERAL, PROJECT_KEY), fingerprintStorageKey(QUOTES, PROJECT_KEY));
});

test("toStorageReferences normaliza las cuatro fuentes y detecta URLs que no coinciden con la clave", () => {
  const [mismatch] = toStorageReferences("file_versions", [
    { context: "project", file_size: "1", file_url: publicUrl("otra/clave.pdf"), id: "1", owner_deleted: false, storage_key: PROJECT_KEY, version_deleted: false },
  ], CONFIG);
  assert.equal(mismatch.urlKeyMismatch, true);
  const users = toStorageReferences("users", [{ id: "1", owner_deleted: false, profile_photo_url: publicUrl(PHOTO_KEY), signature_url: publicUrl("firma.png") }], CONFIG);
  assert.deepEqual(users.map((reference) => reference.field), ["profile_photo_url", "signature_url"]);
  const [quote] = toStorageReferences("quote_pdf_documents", [{ bucket: null, file_size: 1, id: "1", status: "pending", storage_key: QUOTE_KEY }], CONFIG);
  assert.equal(quote.bucket, QUOTES);
  assert.equal(quote.expectAbsent, true);
  assert.throws(() => toStorageReferences("desconocida", [], CONFIG));
});

test("el inventario lee en una transacción READ ONLY que termina con ROLLBACK y cierra la conexión", async () => {
  const { database } = await runWithFakes();
  assert.equal(database.statements[0], "begin transaction isolation level repeatable read read only");
  assert.ok(database.statements.some((statement) => statement.startsWith("set local statement_timeout")));
  assert.equal(database.statements.at(-1), "rollback");
  assert.ok(!database.statements.some((statement) => /^(commit|insert|update|delete)\b/i.test(statement)));
  assert.equal(database.ended, true);
});

test("un fallo dentro de la instantánea conserva el error original, intenta ROLLBACK y cierra la conexión", async () => {
  const database = createFakeDatabase();
  const originalQuery = database.query;
  database.query = async (text, params) => {
    if (/^set local lock_timeout/i.test(text)) throw Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    if (/^rollback$/i.test(text)) {
      database.statements.push("rollback");
      throw Object.assign(new Error("connection lost"), { code: "57P01" });
    }
    return originalQuery(text, params);
  };
  await assert.rejects(() => runStorageInventory({
    config: CONFIG,
    openDatabase: async () => database,
    run: { runId: "run-test", target: {} },
    storage: createFakeStorage(),
  }), { code: "57014" });
  assert.equal(database.statements.at(-1), "rollback");
  assert.equal(database.ended, true);
});

test("el inventario recorre todas las páginas y clasifica presentes, ausentes, huérfanos y restos de filas eliminadas", async () => {
  const { report, storage } = await runWithFakes();

  // Listado completo: 7 objetos del bucket general en 4 páginas de 2 (el marcador se cuenta aparte).
  const general = report.completeness.listings.find((listing) => listing.bucket === GENERAL);
  assert.equal(general.status, "complete");
  assert.equal(general.pages, 4);
  assert.equal(general.objects, 6);
  assert.equal(general.folderPlaceholders, 1);

  // La referencia sin objeto en el listado se confirma con HEAD (404) y es una fila activa sin objeto.
  assert.equal(report.confirmed.missingObjectsForActiveRows.total, 1);
  assert.deepEqual(storage.calls.filter((call) => call.type === "head").map((call) => call.key).sort(), [MISSING_KEY, "quotes/58/versions/v1/COT-0058-v1.pdf"].sort());

  // El PDF pendiente sin objeto es una ausencia esperada, no una pérdida.
  assert.equal(report.confirmed.referenceCounts["quote_pdf_documents.object_key"]["active:expected_absent"], 1);

  const generalOrphans = report.confirmed.orphanDetection.find((orphan) => orphan.bucket === GENERAL);
  assert.equal(generalOrphans.status, "complete");
  assert.equal(generalOrphans.orphanCandidates.total, 1);
  assert.equal(generalOrphans.orphanCandidates.items[0].keyFingerprint, fingerprintStorageKey(GENERAL, ORPHAN_KEY));
  assert.equal(generalOrphans.deletedRowObjects.total, 1);
  assert.equal(generalOrphans.deletedRowObjects.items[0].keyFingerprint, fingerprintStorageKey(GENERAL, DELETED_KEY));

  // Tamaño distinto (50 en PostgreSQL, 51 en el almacenamiento) y URL de otro host sin interpretar.
  assert.equal(report.confirmed.sizeMismatches.total, 1);
  assert.equal(report.unparseableReferences.total, 1);
  assert.equal(report.unparseableReferences.items[0].reason, "unrecognized");

  assert.equal(report.completeness.outcome, "complete");
  assert.deepEqual(report.critical, ["missing_objects_for_active_rows:1"]);
  assert.deepEqual(report.publicBucketImpact, []);
});

test("un listado interrumpido deja la detección de huérfanos incompleta y confirma referencias con HEAD", async () => {
  const { report, storage } = await runWithFakes({
    storage: { failListing: [GENERAL], head: { [PROJECT_KEY]: { size: 100, status: "present" }, [PHOTO_KEY]: { code: "AccessDenied", httpStatus: 403, status: "inaccessible" } } },
  });
  const general = report.completeness.listings.find((listing) => listing.bucket === GENERAL);
  assert.equal(general.status, "incomplete");
  assert.equal(general.errorCode, "AccessDenied");
  const orphans = report.confirmed.orphanDetection.find((orphan) => orphan.bucket === GENERAL);
  assert.equal(orphans.status, "incomplete");
  assert.equal(orphans.reason, "listing_incomplete");
  assert.equal(orphans.orphanCandidates.total, 0);
  assert.ok(storage.calls.some((call) => call.type === "head" && call.key === PROJECT_KEY));
  assert.equal(report.inaccessible.total, 1);
  assert.equal(report.completeness.outcome, "incomplete");
});

test("una fuente ilegible impide concluir huérfanos en su bucket pero no en los demás", async () => {
  const { report } = await runWithFakes({ database: { failSources: ["users"] } });
  assert.deepEqual(report.completeness.sources.users, { errorCode: "42501", status: "failed" });
  const general = report.confirmed.orphanDetection.find((orphan) => orphan.bucket === GENERAL);
  assert.equal(general.status, "incomplete");
  assert.equal(general.reason, "sources_incomplete:users");
  const quotes = report.confirmed.orphanDetection.find((orphan) => orphan.bucket === QUOTES);
  assert.equal(quotes.status, "complete");
  assert.equal(report.completeness.outcome, "incomplete");
});

test("una tabla filtrada por RLS (también la de un JOIN) deja su fuente incompleta sin leerla", async () => {
  const { database, report } = await runWithFakes({ database: { rlsFiltered: ["public.files", "storage.buckets"] } });
  assert.deepEqual(report.completeness.sources.file_versions, { errorCode: "ROW_LEVEL_SECURITY_FILTERS_ROWS", status: "failed" });
  assert.equal(report.completeness.sources.users.status, "complete");
  assert.ok(!database.statements.some((statement) => statement.includes("from public.file_versions")));
  assert.equal(report.completeness.privacy[0].reason, "privacy_query_failed:ROW_LEVEL_SECURITY_FILTERS_ROWS");
  const general = report.confirmed.orphanDetection.find((orphan) => orphan.bucket === GENERAL);
  assert.equal(general.status, "incomplete");
  assert.equal(general.orphanCandidates.total, 0);
});

test("la privacidad solo se confirma con public = false; un bucket público genera impacto y procedimiento sin ejecutarlo", async () => {
  const { report } = await runWithFakes({ database: { privacy: [{ id: GENERAL, public: true }, { id: QUOTES, public: false }] } });
  assert.deepEqual(report.completeness.privacy, [
    { bucket: GENERAL, publicAccepted: false, reason: null, status: "public" },
    { bucket: QUOTES, reason: null, status: "private" },
  ]);
  assert.ok(report.critical.includes(`public_bucket:${GENERAL}`));
  const [impact] = report.publicBucketImpact;
  assert.equal(impact.bucket, GENERAL);
  assert.equal(impact.procedureExecuted, false);
  assert.ok(impact.procedure.length > 0);
  assert.ok(impact.exposedPersonalDataContexts.includes("profile_photo"));

  // Publicidad aceptada para el entorno: queda registrada, con su impacto, pero no es crítica.
  const acceptedRun = await runStorageInventory({
    acceptedPublicBuckets: [GENERAL],
    config: CONFIG,
    openDatabase: async () => createFakeDatabase({ privacy: [{ id: GENERAL, public: true }, { id: QUOTES, public: false }] }),
    run: { runId: "accepted", target: {} },
    storage: createFakeStorage(),
  });
  assert.equal(acceptedRun.completeness.privacy[0].publicAccepted, true);
  assert.ok(!acceptedRun.critical.some((entry) => entry.startsWith("public_bucket")));
  assert.deepEqual(acceptedRun.environment.notes, [`public_bucket_accepted:${GENERAL}`]);
  assert.equal(acceptedRun.publicBucketImpact[0].accepted, true);
  await assert.rejects(() => runStorageInventory({
    acceptedPublicBuckets: ["otro-bucket"],
    config: CONFIG,
    openDatabase: async () => createFakeDatabase(),
    run: { runId: "x", target: {} },
    storage: createFakeStorage(),
  }), /bucket configurado/);

  const unknown = await runWithFakes({ database: { privacyFails: true } });
  assert.equal(unknown.report.completeness.privacy[0].status, "unknown");
  assert.equal(unknown.report.completeness.privacy[0].reason, "privacy_query_failed:42P01");
  const missingRow = await runWithFakes({ database: { privacy: [{ id: QUOTES, public: false }] } });
  assert.equal(missingRow.report.completeness.privacy[0].reason, "bucket_not_found_in_storage_buckets");
});

test("el máximo de HEAD deja referencias sin comprobar y lo marca como incompleto", async () => {
  const { report } = await runWithFakes({ limits: { maxHead: 1 } });
  assert.equal(report.completeness.head.limitReached, true);
  assert.equal(report.completeness.head.performed, 1);
  assert.ok(report.completeness.incompleteChecks.includes("head:limit_reached"));
  assert.equal(report.notChecked.total, 1);
});

test("el informe no contiene claves completas, nombres de archivo, URLs, hosts privados ni mensajes del proveedor", async () => {
  const { report } = await runWithFakes({ database: { failSources: ["support_request_files"], privacyFails: true }, storage: { failListing: [QUOTES] } });
  const serialized = JSON.stringify(report);
  for (const forbidden of [
    PROJECT_KEY, REQUEST_KEY, MISSING_KEY, PHOTO_KEY, ORPHAN_KEY, SUPPORT_KEY, QUOTE_KEY,
    "juan", "perez", "maria", "carla", "ana-ruiz", "cedula", "supabase.co", "otro-host", "s3://",
    "db.internal", "permission denied", "AccessDenied on",
  ]) {
    assert.ok(!serialized.toLowerCase().includes(forbidden.toLowerCase()), `El informe expone: ${forbidden}`);
  }
});

test("la guardia SQL solo admite lecturas y control de la transacción de solo lectura", () => {
  for (const allowed of [
    "begin transaction isolation level repeatable read read only",
    "set local statement_timeout = '30000ms'",
    "savepoint inventory_source",
    "release savepoint inventory_source",
    "rollback to savepoint inventory_source",
    "rollback",
    "select id, public from storage.buckets where id = any($1::text[])",
    "select version.id, (version.deleted_at is not null) as version_deleted from public.file_versions version",
  ]) {
    assert.doesNotThrow(() => assertReadOnlyInventoryStatement(allowed), allowed);
  }
  for (const forbidden of [
    "insert into public.files (id) values (1)",
    "update public.files set title = 'x'",
    "delete from public.files",
    "commit",
    "begin",
    "select 1; delete from public.files",
    "with gone as (delete from public.files returning id) select * from gone",
    "select * into copia from public.files",
    "select nextval('files_id_seq')",
    "select id from public.files for update",
    "select pg_advisory_lock(1)",
    "set local statement_timeout = 0",
    "truncate public.files",
  ]) {
    assert.throws(() => assertReadOnlyInventoryStatement(forbidden), { code: "READ_ONLY_STATEMENT_REQUIRED" }, forbidden);
  }
});

test("el inspector de almacenamiento rechaza cualquier comando que no sea listar o HEAD antes de enviarlo", async () => {
  const sent = [];
  const client = {
    destroyed: false,
    destroy() {
      client.destroyed = true;
    },
    async send(command) {
      sent.push(command.constructor.name);
      if (command instanceof HeadObjectCommand) {
        if (command.input.Key === "missing") throw Object.assign(new Error("Not Found"), { $metadata: { httpStatusCode: 404 }, name: "NotFound" });
        if (command.input.Key === "forbidden") throw Object.assign(new Error(`Denied ${command.input.Key}`), { $metadata: { httpStatusCode: 403 }, name: "Forbidden" });
        return { ContentLength: 12 };
      }
      if (command instanceof ListObjectsV2Command) {
        return { Contents: [{ Key: "a/b.pdf", LastModified: new Date("2026-01-01T00:00:00Z"), Size: 3 }], IsTruncated: true, NextContinuationToken: "t2" };
      }
      throw new Error("comando inesperado");
    },
  };
  const inspector = createReadOnlyStorageInspector({}, { client });
  assert.ok(Object.isFrozen(inspector));
  assert.deepEqual(Object.keys(inspector).sort(), ["close", "headObject", "listPage"]);

  assert.deepEqual(await inspector.listPage({ bucket: GENERAL, continuationToken: "t1" }), {
    isTruncated: true,
    nextToken: "t2",
    objects: [{ key: "a/b.pdf", lastModified: "2026-01-01T00:00:00.000Z", size: 3 }],
  });
  assert.deepEqual(await inspector.headObject({ bucket: GENERAL, key: "present" }), { size: 12, status: "present" });
  assert.deepEqual(await inspector.headObject({ bucket: GENERAL, key: "missing" }), { status: "missing" });
  assert.deepEqual(await inspector.headObject({ bucket: GENERAL, key: "forbidden" }), { code: "Forbidden", httpStatus: 403, status: "inaccessible" });
  assert.deepEqual(sent, ["ListObjectsV2Command", "HeadObjectCommand", "HeadObjectCommand", "HeadObjectCommand"]);

  // El inspector no expone métodos de escritura o descarga, y la lista blanca que usa internamente
  // rechaza esos comandos antes de que lleguen al proveedor.
  const writeOrDownload = [
    new PutObjectCommand({ Bucket: GENERAL, Key: "x" }),
    new DeleteObjectCommand({ Bucket: GENERAL, Key: "x" }),
    new GetObjectCommand({ Bucket: GENERAL, Key: "x" }),
    new CopyObjectCommand({ Bucket: GENERAL, CopySource: `${GENERAL}/x`, Key: "y" }),
    new PutBucketPolicyCommand({ Bucket: GENERAL, Policy: "{}" }),
  ];
  for (const command of writeOrDownload) {
    assert.throws(() => assertReadOnlyStorageCommand(command), { code: "STORAGE_COMMAND_NOT_ALLOWED" });
  }
  assert.doesNotThrow(() => assertReadOnlyStorageCommand(new HeadObjectCommand({ Bucket: GENERAL, Key: "x" })));
  assert.equal(sent.length, 4);
  inspector.close();
  assert.equal(client.destroyed, true);
});
