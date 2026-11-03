import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";
import { mockQuotePdfStorage } from "./helpers/quotePdfMock.js";

const enabled = process.env.ARCA_SERVICE_CATALOG_DB_TESTS === "1";
const skip = !enabled && "Requiere PostgreSQL local aislado y ARCA_SERVICE_CATALOG_TEST_DATABASE_URL.";
let database;
let db;
let quotes;
let pdf;
let storage;
let documents;
let ids;

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({ baseUrl: process.env.ARCA_SERVICE_CATALOG_TEST_DATABASE_URL,
    prefix: "arca_quote_pdf", createApiRoles: true });
  await database.client.query("create schema storage; create table storage.buckets (id text primary key, public boolean not null)");
  await database.client.query("insert into storage.buckets values ('quotes-private-test', false)");
  const { rows: [role] } = await database.client.query("insert into public.roles (code, name) values ('admin', 'Admin') returning id");
  const { rows: [user] } = await database.client.query("insert into public.users (role_id, email, first_name, last_name, password_hash) values ($1, 'pdf@arca.test', 'Admin', 'PDF', '!disabled!') returning id", [role.id]);
  const { rows: [client] } = await database.client.query("insert into public.clients (name, email) values ('Cliente PDF', 'client@arca.test') returning id");
  const { rows: [unit] } = await database.client.query("select id from public.measurement_units where code = 'square_meter'");
  Object.assign(process.env, { DATABASE_URL: database.databaseUrl, NODE_ENV: "test", DATABASE_POOL_MAX: "5",
    SUPABASE_QUOTE_PDF_BUCKET: "quotes-private-test", SUPABASE_STORAGE_BUCKET: "general-test" });
  db = await import("../src/config/db.js");
  quotes = await import("../src/services/quoteService.js");
  pdf = await import("../src/services/quotePdfService.js");
  documents = await import("../src/repositories/quotePdfRepository.js");
  storage = (await import("../src/services/objectStorage.js")).objectStorage;
  const catalog = await import("../src/services/serviceCatalogService.js");
  const service = await catalog.createService({ user: { id: Number(user.id) }, payload: {
    changeNote: null, description: null, isActive: true, measurementUnitId: Number(unit.id), name: "Servicio PDF", referenceRate: "14.00", sortOrder: 0,
  } });
  ids = { user: Number(user.id), client: Number(client.id), service: service.id };
});

after(async () => {
  await db?.pool.end();
  await database?.drop();
});

function payload(overrides = {}) {
  return { clientId: ids.client, newProjectName: `Draft ${randomUUID()}`, items: [{ serviceId: ids.service, quantity: "2.000", unitRate: "14.00" }],
    notes: "Documento persistente", submissionId: randomUUID(), ...overrides };
}

test("PostgreSQL real: Draft, idempotencia concurrente, versiones y snapshots con S3 aislado", { skip }, async (context) => {
  const s3 = mockQuotePdfStorage(context, storage);
  const body = payload();
  const results = await Promise.all(Array.from({ length: 4 }, () => quotes.createQuote({ payload: body, user: { id: ids.user } })));
  const quote = results[0].quote;
  assert.equal(new Set(results.map((result) => result.quote.id)).size, 1);
  assert.equal(results.filter((result) => !result.replayed).length, 1);
  assert.equal(s3.calls.put, 1);
  const { rows: [counts] } = await database.client.query(`select (select count(*)::int from public.projects) projects,
    (select count(*)::int from public.quote_pdf_documents) documents`);
  assert.deepEqual(counts, { projects: 1, documents: 1 });
  const unchanged = await quotes.updateQuote({ quoteId: quote.id, user: { id: ids.user }, payload: {
    clientId: ids.client, projectId: quote.project.id, items: body.items, notes: body.notes, expectedVersion: 1,
  } });
  assert.equal(unchanged.changed, false);
  assert.equal(s3.calls.put, 1);
  const old = (await documents.findQuotePdf(quote.version.id));
  const original = s3.objects.get(old.object_key).bytes;
  const updated = await quotes.updateQuote({ quoteId: quote.id, user: { id: ids.user }, payload: {
    clientId: ids.client, projectId: quote.project.id, items: body.items, notes: "Versión dos", expectedVersion: 1,
  } });
  assert.equal(updated.quote.pdf.status, "available");
  assert.equal(s3.objects.size, 2);
  assert.equal(s3.objects.get(old.object_key).bytes, original);
  assert.equal((await pdf.getQuotePdf({ quoteId: quote.id, versionNumber: 1 })).fileName, old.file_name);
  await assert.rejects(database.client.query("update public.quote_pdf_documents set document_model = '{}' where quote_version_id = $1", [quote.version.id]), { code: "55000" });
  await assert.rejects(database.client.query("update public.quote_pdf_documents set content_hash = $2 where quote_version_id = $1", [quote.version.id, "f".repeat(64)]), { code: "55000" });
  await assert.rejects(database.client.query("update public.quote_versions set client_name = 'Otro' where id = $1", [quote.version.id]), { code: "55000" });
  await database.client.query("set role authenticated");
  try {
    await assert.rejects(database.client.query("select * from public.quote_pdf_documents"), { code: "42501" });
  } finally {
    await database.client.query("reset role");
  }
});

test("PostgreSQL real: reserva vencida se recupera concurrentemente sin retener conexiones durante S3", { skip }, async (context) => {
  const s3 = mockQuotePdfStorage(context, storage);
  s3.setFailPut(true);
  const { quote } = await quotes.createQuote({ payload: payload(), user: { id: ids.user } });
  const staleToken = randomUUID();
  await database.client.query(`update public.quote_pdf_documents set status = 'pending', lease_token = $2,
    lease_until = now() - interval '1 second' where quote_version_id = $1`, [quote.version.id, staleToken]);
  s3.setFailPut(false);
  const originalPut = storage.put.bind(storage);
  context.mock.method(storage, "put", async (options) => {
    // Tomar todas las conexiones mientras S3 se transfiere demuestra que ninguna está retenida.
    const connections = await Promise.all(Array.from({ length: 5 }, () => db.pool.connect()));
    connections.forEach((client) => client.release());
    return originalPut(options);
  });
  const results = await Promise.all(Array.from({ length: 4 }, () => pdf.retryQuotePdf({ quoteId: quote.id })));
  assert.ok(results.some((result) => result.status === "available"));
  assert.equal(s3.objects.size, 1);
  assert.equal(await documents.completeQuotePdf(quote.version.id, staleToken), null);
  assert.equal((await documents.findQuotePdf(quote.version.id)).status, "available");
});

test("PostgreSQL real: recuperación de una subida cuya confirmación falló y detección de objeto perdido", { skip }, async (context) => {
  const s3 = mockQuotePdfStorage(context, storage);
  await database.client.query(`create function public.test_fail_pdf_confirmation() returns trigger language plpgsql as $$ begin
    if NEW.status = 'available' then raise exception 'fallo simulado'; end if; return NEW; end $$`);
  await database.client.query(`create trigger test_fail_pdf_confirmation before update on public.quote_pdf_documents
    for each row execute function public.test_fail_pdf_confirmation()`);
  let quote;
  try {
    ({ quote } = await quotes.createQuote({ payload: payload(), user: { id: ids.user } }));
    assert.equal(quote.pdf.status, "error");
    assert.equal(s3.objects.size, 1);
  } finally {
    await database.client.query("drop trigger test_fail_pdf_confirmation on public.quote_pdf_documents");
    await database.client.query("drop function public.test_fail_pdf_confirmation()");
  }
  assert.equal((await pdf.retryQuotePdf({ quoteId: quote.id })).status, "available");
  assert.equal(s3.calls.put, 1);
  const row = await documents.findQuotePdf(quote.version.id);
  const bytes = s3.objects.get(row.object_key).bytes;
  s3.objects.delete(row.object_key);
  await assert.rejects(pdf.getQuotePdf({ quoteId: quote.id }), { code: "QUOTE_PDF_MISSING" });
  assert.equal((await pdf.retryQuotePdf({ quoteId: quote.id })).status, "available");
  assert.ok(s3.objects.get(row.object_key).bytes.equals(bytes));
});

test("PostgreSQL real: cotización heredada sin reserva se recupera sin alterar versión ni participantes", { skip }, async (context) => {
  const s3 = mockQuotePdfStorage(context, storage);
  const { rows: [source] } = await database.client.query("select quote_id, id from public.quote_versions order by id limit 1");
  const { rows: [reserved] } = await database.client.query("select nextval(pg_get_serial_sequence('public.quotes','id')) as id");
  const quoteId = Number(reserved.id);
  await database.client.query("insert into public.quotes (id, code, created_by, updated_by) values ($1,$2,$3,$3)",
    [quoteId, `COT-${String(quoteId).padStart(3, '0')}`, ids.user]);
  const { rows: [version] } = await database.client.query(`insert into public.quote_versions
    (quote_id, version_number, client_id, client_name, project_id, project_name, notes, services_total, created_by)
    select $1, 1, client_id, client_name, project_id, project_name, notes, services_total, created_by
    from public.quote_versions where id = $2 returning id`, [quoteId, source.id]);
  await database.client.query(`insert into public.quote_items
    (quote_version_id, line_number, service_id, service_version_id, service_version_unit_option_id, quantity, unit_rate, reference_rate, subtotal)
    select $1, line_number, service_id, service_version_id, service_version_unit_option_id, quantity, unit_rate, reference_rate, subtotal
    from public.quote_items where quote_version_id = $2`, [version.id, source.id]);
  await assert.rejects(pdf.getQuotePdf({ quoteId }), { code: "QUOTE_PDF_PENDING" });
  assert.equal(s3.calls.put, 0, "GET no crea PDF heredado");
  assert.equal((await pdf.retryQuotePdf({ quoteId })).status, "available");
  const result = await quotes.getQuote(quoteId);
  assert.equal(result.currentVersion, 1);
  assert.equal(result.pdf.status, "available");
  assert.equal(s3.calls.put, 1);
});
