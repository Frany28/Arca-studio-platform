import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

import { applyMigration, createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

/*
 * Migración 20261124120000_quote_version_restorations contra PostgreSQL real. Opcional y local:
 *   ARCA_SERVICE_CATALOG_DB_TESTS=1
 *   ARCA_SERVICE_CATALOG_TEST_DATABASE_URL=postgres://postgres:<clave>@localhost:54329/postgres
 * Base propia detenida antes de la migración, con historial real de migraciones y cotizaciones
 * creadas con el SQL del backend anterior. Comprueba preflight y postcheck, huellas idénticas,
 * checksum, compatibilidad del backend anterior con la migración aplicada, restauración, fallo de
 * almacenamiento del PDF, concurrencia idempotente, inmutabilidad, claves foráneas y la reversión.
 */

const MIGRATION = "20261124120000_quote_version_restorations";
const MIGRATION_FILE = new URL(`../prisma/migrations/${MIGRATION}/migration.sql`, import.meta.url);
const EXPECTED_CHECKSUM = "21dd6005ca27ae2175c92f691b4dd55811ef51291e21f57b563a3a76fe3b0857";
const enabled = process.env.ARCA_SERVICE_CATALOG_DB_TESTS === "1" && process.env.ARCA_SERVICE_CATALOG_TEST_DATABASE_URL;
const skip = !enabled && "Requiere PostgreSQL local, ARCA_SERVICE_CATALOG_DB_TESTS=1 y ARCA_SERVICE_CATALOG_TEST_DATABASE_URL.";
// Reversión documentada en PRISMA_MIGRATIONS.md (solo con el backend anterior publicado).
const ROLLBACK_SQL = `
  BEGIN;
  ALTER TABLE public.quote_versions
    DROP CONSTRAINT uq_quote_versions_restore_request,
    DROP CONSTRAINT fk_quote_versions_restored_from,
    DROP CONSTRAINT chk_quote_versions_restoration,
    DROP COLUMN restore_request_id,
    DROP COLUMN restore_reason,
    DROP COLUMN restored_from_version_number;
  DELETE FROM public._prisma_migrations WHERE migration_name = '${MIGRATION}';
  COMMIT;`;

let database;
let db;
let restorations;
const ids = {};
const checks = {};

/**
 * Ejecuta una consulta en la base desechable con el cliente de preparación.
 *
 * @param {string} sql - Sentencia.
 * @param {unknown[]} [values] - Parámetros.
 * @returns {Promise<Array<object>>} Filas.
 */
async function rows(sql, values = []) {
  return (await database.client.query(sql, values)).rows;
}

/**
 * Ejecuta un archivo de comprobación (sin metacomandos de psql) y devuelve todas sus filas.
 *
 * @param {"preflight"|"postcheck"} name - Archivo.
 * @returns {Promise<Array<object>>} Filas de todas las consultas.
 */
async function runCheck(name) {
  const source = await readFile(new URL(`../prisma/checks/${MIGRATION}/${name}.sql`, import.meta.url), "utf8");
  return (await database.client.query(source.replace(/^\\.*$/gm, ""))).flatMap((result) => result.rows);
}

/**
 * Comprueba que todos los indicadores ok_* de un check sean verdaderos.
 *
 * @param {Array<object>} checkRows - Filas del check.
 * @param {string} label - Nombre para los mensajes.
 * @returns {void}
 */
function assertAllOk(checkRows, label) {
  const indicators = checkRows.flatMap((row) => Object.entries(row).filter(([key]) => key.startsWith("ok_")));
  assert.ok(indicators.length > 0, `${label} sin indicadores`);
  for (const [key, value] of indicators) assert.equal(value, true, `${label}.${key}`);
}

/**
 * Extrae las huellas por tabla de las filas de un check.
 *
 * @param {Array<object>} checkRows - Filas del check.
 * @returns {object} Huella y recuento por tabla.
 */
function fingerprints(checkRows) {
  return Object.fromEntries(checkRows.filter((row) => row.table_name && row.fingerprint)
    .map((row) => [row.table_name, { count: Number(row.row_count), fingerprint: row.fingerprint }]));
}

/**
 * Registra una versión con el SQL exacto del backend anterior (13 columnas, sin las de restauración),
 * retirando antes la vigente, con sus conceptos y la reserva del PDF.
 *
 * @param {number} quoteId - Cotización.
 * @param {number} versionNumber - Número de versión.
 * @param {Array<{ quantity: string, unitRate: string, subtotal: string }>} items - Conceptos (servicio de la prueba).
 * @param {{ servicesTotal: string, vatAmount: string, notes: string|null }} totals - Totales calculados.
 * @returns {Promise<number>} Id de la versión.
 */
async function insertLegacyVersion(quoteId, versionNumber, items, { notes, servicesTotal, vatAmount }) {
  await rows("update public.quote_versions set is_current = false where quote_id = $1 and is_current", [quoteId]);
  const [version] = await rows(
    `insert into public.quote_versions (
       quote_id, version_number, client_id, client_name, project_id, project_name, notes, services_total, currency_code, created_by,
       reference_vat_enabled, reference_vat_rate, reference_vat_amount
     ) values ($1, $2, $3, $4, $5, $6, $7, $8::numeric, $9, $10, $11, $12::numeric, $13::numeric)
     returning id::int`,
    [quoteId, versionNumber, ids.client, "Cliente Restauración", ids.project, "Casa Restauración", notes, servicesTotal, "USD", ids.admin, true, "16.00", vatAmount],
  );
  for (const [index, item] of items.entries()) {
    await rows(`insert into public.quote_items (quote_version_id, line_number, service_id, service_version_id, service_version_unit_option_id,
        quantity, unit_rate, reference_rate, subtotal) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [version.id, index + 1, ids.service, ids.serviceVersion, ids.unitOption, item.quantity, item.unitRate, "14.00", item.subtotal]);
  }
  await rows(`insert into public.quote_pdf_documents (quote_version_id, object_key, file_name, document_model, source_hash, time_zone, layout_revision)
    values ($1, $2, $3, '{}'::jsonb, $4, 'America/Caracas', 2)`,
  [version.id, `quotes/${quoteId}/versions/v${versionNumber}/COT-${String(quoteId).padStart(3, "0")}-v${versionNumber}.pdf`,
    `COT-${String(quoteId).padStart(3, "0")}-v${versionNumber}.pdf`, createHash("sha256").update(`${quoteId}:${versionNumber}`).digest("hex")]);
  return version.id;
}

/**
 * Crea una cotización con el SQL del backend anterior y la versión 1 indicada.
 *
 * @param {Array<object>} items - Conceptos.
 * @param {object} totals - Totales.
 * @returns {Promise<number>} Id de la cotización.
 */
async function insertLegacyQuote(items, totals) {
  const [{ id }] = await rows("select nextval(pg_get_serial_sequence('public.quotes', 'id'))::int as id");
  await rows("insert into public.quotes (id, code, created_by, updated_by) values ($1, $2, $3, $3)", [id, `COT-${String(id).padStart(3, "0")}`, ids.admin]);
  await insertLegacyVersion(id, 1, items, totals);
  return id;
}

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({
    baseUrl: process.env.ARCA_SERVICE_CATALOG_TEST_DATABASE_URL,
    prefix: "arca_quote_restorations",
    recordMigrations: true,
    stopBefore: MIGRATION,
  });
  const [role] = await rows("insert into public.roles (code, name) values ('admin', 'Administrador') returning id");
  const [admin] = await rows(`insert into public.users (role_id, email, first_name, last_name, password_hash)
    values ($1, 'admin@restauracion.test', 'Admin', 'Restauración', '!integration-login-disabled!') returning id::int`, [role.id]);
  const [client] = await rows("insert into public.clients (name, email) values ('Cliente Restauración', 'cliente@restauracion.test') returning id::int");
  const [project] = await rows(`insert into public.projects (client_id, created_by, name, start_date, project_type, location, public_slug, has_plans)
    values ($1, $2, 'Casa Restauración', current_date, (select enum_range(null::public.project_type))[1], 'Caracas', 'casa-restauracion', false) returning id::int`,
  [client.id, admin.id]);
  Object.assign(ids, { admin: admin.id, client: client.id, project: project.id });

  Object.assign(process.env, { DATABASE_POOL_MAX: "5", DATABASE_URL: database.databaseUrl, NODE_ENV: "test" });
  delete process.env.SUPABASE_QUOTE_PDF_BUCKET;
  db = await import("../src/config/db.js");
  const catalog = await import("../src/services/serviceCatalogService.js");
  const [unit] = await rows("select id::int from public.measurement_units where code = 'square_meter'");
  const service = await catalog.createService({
    payload: { changeNote: null, description: null, isActive: true, measurementUnitId: unit.id, name: "Anteproyecto", referenceRate: "14.00", sortOrder: 0 },
    user: { id: admin.id },
  });
  const [option] = await rows(`select v.id::int as version_id, uo.id::int as option_id from public.service_versions v
    join public.service_version_unit_options uo on uo.service_version_id = v.id where v.service_id = $1 and v.is_current`, [service.id]);
  Object.assign(ids, { service: service.id, serviceVersion: option.version_id, unitOption: option.option_id });

  // Historial previo a la migración: COT con V1 (200.500 m² × 14.33), V2 y V3 vigente; otra cotización con V1.
  ids.quote = await insertLegacyQuote([{ quantity: "200.500", subtotal: "2873.17", unitRate: "14.33" }], { notes: "Original", servicesTotal: "2873.17", vatAmount: "459.71" });
  await insertLegacyVersion(ids.quote, 2, [{ quantity: "3.000", subtotal: "30.00", unitRate: "10.00" }], { notes: null, servicesTotal: "30.00", vatAmount: "4.80" });
  await insertLegacyVersion(ids.quote, 3, [{ quantity: "4.000", subtotal: "40.00", unitRate: "10.00" }], { notes: null, servicesTotal: "40.00", vatAmount: "6.40" });
  ids.otherQuote = await insertLegacyQuote([{ quantity: "1.000", subtotal: "14.00", unitRate: "14.00" }], { notes: null, servicesTotal: "14.00", vatAmount: "2.24" });

  checks.preflight = await runCheck("preflight");
  await applyMigration(database.client, MIGRATION);
  checks.checksum = createHash("sha256").update(await readFile(MIGRATION_FILE)).digest("hex");
  await rows(`insert into public._prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count)
    values ($1, $2, $3, now(), 1)`, [randomUUID(), checks.checksum, MIGRATION]);
  checks.postcheck = await runCheck("postcheck");
  restorations = await import("../src/services/quoteRestorationService.js");
});

after(async () => {
  await db?.pool.end().catch(() => {});
  if (database) await database.drop();
});

test("preflight y postcheck correctos, checksum LF exacto y huellas del historial idénticas", { skip }, () => {
  assertAllOk(checks.preflight, "preflight");
  assertAllOk(checks.postcheck, "postcheck");
  assert.equal(checks.checksum, EXPECTED_CHECKSUM);
  const before = fingerprints(checks.preflight);
  assert.deepEqual(Object.keys(before).sort(), ["quote_items", "quote_pdf_documents", "quote_versions", "quotes"]);
  assert.deepEqual(fingerprints(checks.postcheck), before, "La migración no modifica cotizaciones, versiones, conceptos ni PDF");
  assert.deepEqual([before.quote_versions.count, before.quote_items.count, before.quote_pdf_documents.count], [4, 4, 4]);
});

test("compatibilidad: el SQL del backend anterior sigue creando y versionando cotizaciones con la migración aplicada", { skip }, async () => {
  const quoteId = await insertLegacyQuote([{ quantity: "2.000", subtotal: "28.00", unitRate: "14.00" }], { notes: null, servicesTotal: "28.00", vatAmount: "4.48" });
  await insertLegacyVersion(quoteId, 2, [{ quantity: "1.000", subtotal: "14.00", unitRate: "14.00" }], { notes: "Edición", servicesTotal: "14.00", vatAmount: "2.24" });
  assert.deepEqual(await rows(`select version_number, is_current, restored_from_version_number, restore_reason, restore_request_id
    from public.quote_versions where quote_id = $1 order by version_number`, [quoteId]), [
    { is_current: false, restore_reason: null, restore_request_id: null, restored_from_version_number: null, version_number: 1 },
    { is_current: true, restore_reason: null, restore_request_id: null, restored_from_version_number: null, version_number: 2 },
  ]);
});

test("restauración sobre historial previo: V1 → V4 exacta, V1–V3 intactas y PDF en error recuperable si falla el almacenamiento", { skip }, async () => {
  const before = await rows("select id, to_jsonb(v) - 'is_current' as row from public.quote_versions v where quote_id = $1 order by id", [ids.quote]);
  const { quote, replayed } = await restorations.restoreQuoteVersion({
    payload: { expectedVersion: 3, reason: "El cliente aprobó la primera propuesta", requestId: randomUUID() },
    quoteId: ids.quote,
    user: { id: ids.admin },
    versionNumber: 1,
  });
  assert.equal(replayed, false);
  assert.equal(quote.currentVersion, 4);
  assert.deepEqual(quote.version.restoredFrom, { reason: "El cliente aprobó la primera propuesta", versionNumber: 1 });
  assert.deepEqual([quote.servicesTotal, quote.referenceVat.amount, quote.notes], ["2873.17", "459.71", "Original"]);
  assert.deepEqual(quote.items.map((item) => [item.quantity, item.unitRate, item.subtotal, item.unit.optionId]), [["200.500", "14.33", "2873.17", ids.unitOption]]);
  // Sin almacenamiento privado configurado el PDF queda en error, sin revertir la restauración.
  assert.equal(quote.pdf.status, "error");
  const [doc] = await rows(`select d.status, d.error_code, d.object_key from public.quote_pdf_documents d
    join public.quote_versions v on v.id = d.quote_version_id where v.quote_id = $1 and v.version_number = 4`, [ids.quote]);
  assert.equal(doc.status, "error");
  assert.match(doc.object_key, /\/versions\/v4\//);
  const after = await rows("select id, to_jsonb(v) - 'is_current' as row from public.quote_versions v where quote_id = $1 and version_number < 4 order by id", [ids.quote]);
  assert.deepEqual(after, before, "Las versiones anteriores no cambian");
  const [audit] = await rows("select user_id::int, new_values from public.audit_logs where action = 'quote.version_restore' and entity_id = $1", [ids.quote]);
  assert.deepEqual([audit.user_id, audit.new_values.restoredFromVersion, audit.new_values.versionNumber], [ids.admin, 1, 4]);
});

test("concurrencia: el mismo envío simultáneo crea una sola versión y el otro lo recupera", { skip }, async () => {
  const requestId = randomUUID();
  const attempt = () => restorations.restoreQuoteVersion({
    payload: { expectedVersion: 4, reason: "Vuelve la V2", requestId }, quoteId: ids.quote, user: { id: ids.admin }, versionNumber: 2,
  });
  const results = await Promise.all([attempt(), attempt()]);
  assert.deepEqual(results.map((result) => result.quote.currentVersion), [5, 5]);
  assert.deepEqual(results.map((result) => result.replayed).sort(), [false, true]);
  assert.equal((await rows("select count(*)::int as total from public.quote_versions where quote_id = $1", [ids.quote]))[0].total, 5);
  await assert.rejects(restorations.restoreQuoteVersion({
    payload: { expectedVersion: 4, reason: "Obsoleta", requestId: randomUUID() }, quoteId: ids.quote, user: { id: ids.admin }, versionNumber: 1,
  }), { code: "QUOTE_VERSION_CONFLICT" });
});

test("inmutabilidad, claves foráneas y unicidad protegen la trazabilidad de la restauración", { skip }, async () => {
  await assert.rejects(rows("update public.quote_versions set restore_reason = 'otro' where quote_id = $1 and version_number = 4", [ids.quote]), { code: "55000" });
  await assert.rejects(rows("update public.quote_versions set restored_from_version_number = null where quote_id = $1 and version_number = 4", [ids.quote]), { code: "55000" });
  await assert.rejects(rows("delete from public.quote_versions where quote_id = $1 and version_number = 1", [ids.quote]), { code: "55000" });

  const [used] = await rows("select restore_request_id from public.quote_versions where quote_id = $1 and version_number = 4", [ids.quote]);
  const insert = (quoteId, number, origin, reason, requestId) => rows(`insert into public.quote_versions (quote_id, version_number, client_id, client_name, project_id,
      project_name, services_total, created_by, is_current, restored_from_version_number, restore_reason, restore_request_id)
    values ($1, $2, $3, 'C', $4, 'P', 0, $5, false, $6, $7, $8)`, [quoteId, number, ids.client, ids.project, ids.admin, origin, reason, requestId]);
  await assert.rejects(insert(ids.otherQuote, 9, 3, "Origen de otra cotización", randomUUID()), { code: "23503", constraint: "fk_quote_versions_restored_from" });
  await assert.rejects(insert(ids.quote, 90, 1, "Repetido", used.restore_request_id), { code: "23505", constraint: "uq_quote_versions_restore_request" });
  await assert.rejects(insert(ids.quote, 91, 1, null, randomUUID()), { code: "23514", constraint: "chk_quote_versions_restoration" });
  await assert.rejects(insert(ids.quote, 92, 95, "Origen posterior", randomUUID()), { code: "23514", constraint: "chk_quote_versions_restoration" });
  await assert.rejects(insert(ids.quote, 93, 1, "   ", randomUUID()), { code: "23514", constraint: "chk_quote_versions_restoration" });
});

test("reversión documentada: deja el esquema previo (preflight correcto) y la migración se puede volver a aplicar", { skip }, async () => {
  // Base aparte con el historial completo registrado (incluida esta migración): con restauraciones
  // reales, revertir pierde su trazabilidad, por eso la reversión exige un respaldo previo.
  const scratch = await createIsolatedMigrationDatabase({
    baseUrl: process.env.ARCA_SERVICE_CATALOG_TEST_DATABASE_URL, prefix: "arca_quote_restorations_rollback", recordMigrations: true,
  });
  try {
    const query = async (sql) => (await scratch.client.query(sql));
    await query(ROLLBACK_SQL);
    const source = await readFile(new URL(`../prisma/checks/${MIGRATION}/preflight.sql`, import.meta.url), "utf8");
    assertAllOk((await scratch.client.query(source.replace(/^\\.*$/gm, ""))).flatMap((result) => result.rows), "preflight tras revertir");

    // Con otra sesión leyendo quote_versions, la migración no espera indefinidamente: aborta por
    // lock_timeout (55P03) en ~3 s y la transacción se revierte sin cambios.
    const { default: pg } = await import("pg");
    const reader = new pg.Client({ connectionString: scratch.databaseUrl, ssl: false });
    await reader.connect();
    try {
      await reader.query("BEGIN");
      await reader.query("select count(*) from public.quote_versions");
      const started = Date.now();
      await assert.rejects(applyMigration(scratch.client, MIGRATION), { code: "55P03" });
      const elapsed = Date.now() - started;
      assert.ok(elapsed >= 2500 && elapsed < 15000, `abortó en ${elapsed} ms`);
      await query("ROLLBACK");
      const [{ total }] = (await query(`select count(*)::int as total from information_schema.columns
        where table_schema = 'public' and table_name = 'quote_versions' and column_name like 'restore%'`)).rows;
      assert.equal(total, 0, "La transacción abortada no deja columnas nuevas");
    } finally {
      await reader.query("ROLLBACK").catch(() => {});
      await reader.end();
    }

    await applyMigration(scratch.client, MIGRATION);
    await query(`insert into public._prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count)
      values ('${randomUUID()}', '${EXPECTED_CHECKSUM}', '${MIGRATION}', now(), 1)`);
    const post = await readFile(new URL(`../prisma/checks/${MIGRATION}/postcheck.sql`, import.meta.url), "utf8");
    assertAllOk((await scratch.client.query(post.replace(/^\\.*$/gm, ""))).flatMap((result) => result.rows), "postcheck tras reaplicar");
  } finally {
    await scratch.drop();
  }
});
