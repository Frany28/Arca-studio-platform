import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

// Cotizaciones contra PostgreSQL real. Opcional y aislada, como el catálogo de servicios:
// ARCA_SERVICE_CATALOG_DB_TESTS=1 y ARCA_SERVICE_CATALOG_TEST_DATABASE_URL (solo localhost).
// Crea una base propia con el historial completo de migraciones y la elimina al terminar; nunca
// usa DATABASE_URL del proyecto. Ejecuta los servicios y repositorios reales.
const enabled = process.env.ARCA_SERVICE_CATALOG_DB_TESTS === "1";
const skip = !enabled && "Requiere PostgreSQL local, ARCA_SERVICE_CATALOG_DB_TESTS=1 y ARCA_SERVICE_CATALOG_TEST_DATABASE_URL.";

let database;
let db;
let quotes;
let catalog;
let ids;

/**
 * Consulta la base aislada con el cliente de preparación (fuera del pool de la aplicación).
 *
 * @param {string} sql - Sentencia SQL.
 * @param {Array<unknown>} [values] - Parámetros.
 * @returns {Promise<Array<object>>} Filas.
 */
async function rows(sql, values = []) {
  return (await database.client.query(sql, values)).rows;
}

/**
 * Crea un servicio del tabulador con el servicio real y devuelve su id.
 *
 * @param {object} overrides - Campos del cuerpo validado.
 * @returns {Promise<number>} Id del servicio.
 */
async function createService(overrides) {
  const service = await catalog.createService({
    payload: { changeNote: null, description: null, isActive: true, measurementUnitId: ids.squareMeter, name: "Servicio", referenceRate: "14.00", sortOrder: 0, ...overrides },
    user: { id: ids.admin },
  });
  return service.id;
}

/**
 * Cuerpo validado de una cotización del cliente y proyecto de la prueba.
 *
 * @param {Array<object>} items - Conceptos.
 * @param {object} [overrides] - Campos que se sustituyen.
 * @returns {object} Cuerpo como lo deja quoteCreateSchema.
 */
function quoteBody(items, overrides = {}) {
  return { clientId: ids.client, items, notes: null, projectId: ids.project, ...overrides };
}

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({ baseUrl: process.env.ARCA_SERVICE_CATALOG_TEST_DATABASE_URL, prefix: "arca_quotes" });
  const [role] = await rows("insert into public.roles (code, name) values ('admin', 'Administrador') returning id");
  const [admin] = await rows(`insert into public.users (role_id, email, first_name, last_name, password_hash)
    values ($1, 'admin@arca.test', 'Admin', 'Cotizaciones', '!integration-login-disabled!') returning id::int`, [role.id]);
  const [client] = await rows("insert into public.clients (name, email) values ('Leonel Pérez', 'leonel@arca.test') returning id::int");
  const [project] = await rows(`insert into public.projects (client_id, created_by, name, start_date, project_type, location, public_slug)
    values ($1, $2, 'Apto. 910', current_date, (select enum_range(null::public.project_type))[1], 'Caracas', 'apto-910-quotes') returning id::int`, [client.id, admin.id]);
  const units = await rows("select id::int, code from public.measurement_units where code in ('square_meter', 'point')");
  const unitId = Object.fromEntries(units.map((unit) => [unit.code, unit.id]));
  ids = { admin: admin.id, client: client.id, point: unitId.point, project: project.id, squareMeter: unitId.square_meter };

  Object.assign(process.env, { DATABASE_POOL_MAX: "5", DATABASE_URL: database.databaseUrl, NODE_ENV: "test" });
  db = await import("../src/config/db.js");
  quotes = await import("../src/services/quoteService.js");
  catalog = await import("../src/services/serviceCatalogService.js");
});

after(async () => {
  await db?.pool.end().catch(() => {});
  if (database) await database.drop();
});

test("alta y edición: COT- con el id, importes del motor y versiones inmutables", { skip }, async () => {
  const anteproyecto = await createService({ name: "Anteproyecto arquitectónico" });
  const puntos = await createService({ measurementUnitId: ids.point, name: "Puntos eléctricos", referenceRate: "47.00" });
  const created = await quotes.createQuote({
    payload: quoteBody([{ quantity: "200.000", serviceId: anteproyecto, unitRate: "14.00" }, { quantity: "35.000", serviceId: puntos, unitRate: "47.00" }]),
    user: { id: ids.admin },
  });
  assert.equal(created.code, `COT-${String(created.id).padStart(3, "0")}`);
  assert.equal(created.servicesTotal, "4445.00");

  const updated = await quotes.updateQuote({
    payload: { ...quoteBody([{ quantity: "100.000", serviceId: anteproyecto, unitRate: "14.00" }]), expectedVersion: 1 },
    quoteId: created.id,
    user: { id: ids.admin },
  });
  assert.equal(updated.quote.currentVersion, 2);
  assert.deepEqual(await rows("select version_number, is_current from public.quote_versions where quote_id = $1 order by version_number", [created.id]),
    [{ is_current: false, version_number: 1 }, { is_current: true, version_number: 2 }]);

  await assert.rejects(rows("update public.quote_versions set notes = 'x' where quote_id = $1", [created.id]), { code: "55000" });
  await assert.rejects(rows("delete from public.quote_items"), { code: "55000" });
  await assert.rejects(rows(`insert into public.quote_items (quote_version_id, line_number, service_id, service_version_id, service_version_unit_option_id, quantity, unit_rate, reference_rate, subtotal)
    select v.id, 9, i.service_id, i.service_version_id, i.service_version_unit_option_id, 1, 10, 10, 11 from public.quote_versions v join public.quote_items i on i.quote_version_id = v.id
    where v.quote_id = $1 and v.is_current limit 1`, [created.id]), { code: "23514" }, "El CHECK rechaza un subtotal mal calculado");
});

test("modalidad: un servicio cotizado no cambia de kind; uno sin cotizar sí", { skip }, async () => {
  const quoted = await createService({ name: "Cotizado" });
  const free = await createService({ name: "Libre" });
  await quotes.createQuote({ payload: quoteBody([{ quantity: "1.000", serviceId: quoted, unitRate: "1.00" }]), user: { id: ids.admin } });
  await assert.rejects(
    catalog.updateService({ payload: { expectedVersion: 1, kind: "turnkey" }, serviceId: quoted, user: { id: ids.admin } }),
    { code: "SERVICE_MODALITY_IN_USE" },
  );
  const changed = await catalog.updateService({ payload: { expectedVersion: 1, kind: "turnkey" }, serviceId: free, user: { id: ids.admin } });
  assert.equal(changed.service.kind, "turnkey");
  assert.equal((await catalog.getService(quoted)).kindLocked, true);
});

test("carrera: un concepto y un cambio de kind concurrentes; gana uno y el otro ve el resultado", { skip }, async () => {
  const contested = await createService({ name: "Disputado" });
  const [quoteResult, kindResult] = await Promise.allSettled([
    quotes.createQuote({ payload: quoteBody([{ quantity: "1.000", serviceId: contested, unitRate: "1.00" }]), user: { id: ids.admin } }),
    catalog.updateService({ payload: { expectedVersion: 1, kind: "turnkey" }, serviceId: contested, user: { id: ids.admin } }),
  ]);
  assert.equal(quoteResult.status, "fulfilled", "La cotización espera al cambio y cotiza la versión nueva, o gana");
  if (kindResult.status === "rejected") {
    assert.equal(kindResult.reason.code, "SERVICE_MODALITY_IN_USE");
  } else {
    const [item] = await rows("select sv.kind from public.quote_items i join public.service_versions sv on sv.id = i.service_version_id where i.service_id = $1", [contested]);
    assert.equal(item.kind, "turnkey", "Si gana el cambio, el concepto cotiza la versión nueva");
  }
});

test("listado: orden por total con cursor estable y filtro por intervalo de fechas", { skip }, async () => {
  const service = await createService({ name: "Listado" });
  for (const rate of ["5.00", "1.00", "3.00"]) {
    await quotes.createQuote({ payload: quoteBody([{ quantity: "1.000", serviceId: service, unitRate: rate }]), user: { id: ids.admin } });
  }
  const seen = [];
  let cursor;
  do {
    const page = await quotes.getQuotesPage({ cursor, direction: "desc", limit: 2, sort: "total" });
    seen.push(...page.quotes.map((quote) => quote.servicesTotal));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.deepEqual(seen, [...seen].sort((left, right) => Number(right) - Number(left)), "Orden descendente por total");
  assert.equal(seen.length, (await quotes.getQuoteSummary()).total, "El cursor recorre todas las cotizaciones una vez");
  const future = await quotes.getQuotesPage({ createdFrom: new Date(Date.now() + 86_400_000).toISOString(), direction: "asc", sort: "code" });
  assert.deepEqual(future.quotes, []);
});
