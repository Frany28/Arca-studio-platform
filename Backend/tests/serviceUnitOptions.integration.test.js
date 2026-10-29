import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { applyMigration, createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

// Unidad de medida de los servicios contra PostgreSQL real. Opcional y aislada, como el catálogo:
// ARCA_SERVICE_CATALOG_DB_TESTS=1 y ARCA_SERVICE_CATALOG_TEST_DATABASE_URL (solo localhost).
// Recorre el historial: un servicio y un concepto del modelo inicial, la migración de unidades
// alternativas con servicios que las usaron (y una cotización con una alternativa), la separación
// con el servicio real y la migración de unidad única. Importes ficticios.
const enabled = process.env.ARCA_SERVICE_CATALOG_DB_TESTS === "1";
const createApiRoles = process.env.ARCA_SERVICE_CATALOG_TEST_CREATE_ROLES === "1";
const skip = !enabled && "Requiere PostgreSQL local, ARCA_SERVICE_CATALOG_DB_TESTS=1 y ARCA_SERVICE_CATALOG_TEST_DATABASE_URL.";
const MIGRATION = "20261027120000_service_unit_options";
const SINGLE_UNIT_MIGRATION = "20261030120000_service_single_unit_option";

let database;
let db;
let catalog;
let quotes;
let buildQuoteDocument;
let ids;
const services = {};

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
 * Crea un servicio con el servicio real del catálogo como el administrador de la prueba.
 *
 * @param {object} payload - Cuerpo validado (sin los valores por defecto).
 * @returns {Promise<object>} Servicio creado.
 */
function createService(payload) {
  return catalog.createService({
    payload: { changeNote: null, description: null, isActive: true, kind: "individual", sortOrder: 0, ...payload },
    user: { id: ids.admin },
  });
}

/**
 * Edita un servicio con el servicio real del catálogo como el administrador de la prueba.
 *
 * @param {number} serviceId - Servicio editado.
 * @param {object} payload - Cuerpo validado de la edición.
 * @returns {Promise<{ service: object, changed: boolean, changedFields: Array<string> }>} Resultado.
 */
function updateService(serviceId, payload) {
  return catalog.updateService({ payload, serviceId, user: { id: ids.admin } });
}

/**
 * Unidades copiadas en cada versión de un servicio: [versión, posición, símbolo, texto, tarifa].
 *
 * @param {number} serviceId - Servicio consultado.
 * @returns {Promise<Array<Array<unknown>>>} Copias en orden.
 */
async function versionOptionsOf(serviceId) {
  return (await rows(`select v.version_number, o.position, o.unit_symbol, o.presentation_label, o.reference_rate
    from public.service_version_unit_options o join public.service_versions v on v.id = o.service_version_id
    where v.service_id = $1 order by v.version_number, o.position`, [serviceId]))
    .map((row) => [row.version_number, row.position, row.unit_symbol, row.presentation_label, row.reference_rate]);
}

/**
 * Unidades vigentes de un servicio: [posición, símbolo, texto, tarifa].
 *
 * @param {number} serviceId - Servicio consultado.
 * @returns {Promise<Array<Array<unknown>>>} Unidades en orden.
 */
async function currentOptionsOf(serviceId) {
  return (await rows(`select o.position, u.symbol, o.presentation_label, o.reference_rate
    from public.service_unit_options o join public.measurement_units u on u.id = o.measurement_unit_id
    where o.service_id = $1 order by o.position`, [serviceId]))
    .map((row) => [row.position, row.symbol, row.presentation_label, row.reference_rate]);
}

/**
 * Registra, como lo hacía el backend con varias unidades, un servicio con una unidad alternativa
 * y su versión 1 (el trigger copia ambas unidades en la versión).
 *
 * @param {object} service - Datos del servicio.
 * @returns {Promise<{ id: number, versionId: number }>} Servicio y versión 1.
 */
async function insertServiceWithAlternative({ alternative, code, name, rate, unitId }) {
  await rows("begin");
  const [service] = await rows(`insert into public.services (code, name, kind, measurement_unit_id, reference_rate, sort_order, created_by, updated_by)
    values ($1, $2, 'individual', $3, $4, 0, $5, $5) returning id::int`, [code, name, unitId, rate, ids.admin]);
  await rows("insert into public.service_unit_options (service_id, position, measurement_unit_id, reference_rate) values ($1, 2, $2, $3)",
    [service.id, alternative.unitId, alternative.rate]);
  const [version] = await rows(`insert into public.service_versions (
      service_id, version_number, code, name, kind, measurement_unit_id, unit_code, unit_name, unit_symbol, unit_allows_decimals,
      reference_rate, currency_code, is_active, sort_order, changed_by)
    select s.id, 1, s.code, s.name, s.kind, u.id, u.code, u.name, u.symbol, u.allows_decimals, s.reference_rate, s.currency_code,
      s.is_active, s.sort_order, $2
    from public.services s join public.measurement_units u on u.id = s.measurement_unit_id where s.id = $1 returning id::int`, [service.id, ids.admin]);
  await rows("commit");
  return { id: service.id, versionId: version.id };
}

/**
 * Cuerpo validado de una cotización del cliente y proyecto de la prueba.
 *
 * @param {Array<object>} items - Conceptos.
 * @returns {object} Cuerpo como lo deja quoteCreateSchema.
 */
function quoteBody(items) {
  return { clientId: ids.client, items, notes: null, projectId: ids.project };
}

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({
    baseUrl: process.env.ARCA_SERVICE_CATALOG_TEST_DATABASE_URL,
    createApiRoles,
    prefix: "arca_unit_options",
    stopBefore: MIGRATION,
  });
  const [role] = await rows("insert into public.roles (code, name) values ('admin', 'Administrador') returning id");
  const [admin] = await rows(`insert into public.users (role_id, email, first_name, last_name, password_hash)
    values ($1, 'unidades-alt@arca.test', 'Admin', 'Unidades', '!integration-login-disabled!') returning id::int`, [role.id]);
  const [client] = await rows("insert into public.clients (name, email) values ('Cliente Tabulador', 'tabulador@arca.test') returning id::int");
  const [project] = await rows(`insert into public.projects (client_id, created_by, name, start_date, project_type, location, public_slug)
    values ($1, $2, 'Local 3.2', current_date, (select enum_range(null::public.project_type))[1], 'Caracas', 'local-3-2-units') returning id::int`, [client.id, admin.id]);
  const unitRows = await rows("select id::int, code from public.measurement_units");
  const unit = Object.fromEntries(unitRows.map((row) => [row.code, row.id]));

  // Datos con el modelo inicial: un servicio con denominación, su versión 1 y un concepto cotizado.
  const [denomination] = await rows(`insert into public.measurement_unit_denominations (measurement_unit_id, denomination, created_by, updated_by)
    values ($1, 'de construcción', $2, $2) returning id::int`, [unit.square_meter, admin.id]);
  const [legacy] = await rows(`insert into public.services (code, name, kind, measurement_unit_id, unit_denomination_id, reference_rate, created_by, updated_by)
    values ('LEGADO', 'Anteproyecto (legado)', 'individual', $1, $2, 14.00, $3, $3) returning id::int`, [unit.square_meter, denomination.id, admin.id]);
  const [legacyVersion] = await rows(`insert into public.service_versions (
      service_id, version_number, code, name, kind, measurement_unit_id, unit_code, unit_name, unit_symbol, unit_allows_decimals,
      unit_denomination_id, unit_denomination, reference_rate, currency_code, is_active, sort_order, changed_by)
    select s.id, 1, s.code, s.name, s.kind, u.id, u.code, u.name, u.symbol, u.allows_decimals, d.id, d.denomination, s.reference_rate,
      s.currency_code, s.is_active, s.sort_order, $2
    from public.services s join public.measurement_units u on u.id = s.measurement_unit_id
    join public.measurement_unit_denominations d on d.id = s.unit_denomination_id where s.id = $1 returning id::int`, [legacy.id, admin.id]);
  const [quote] = await rows("insert into public.quotes (code, created_by, updated_by) values ('COT-900', $1, $1) returning id::int", [admin.id]);
  const [quoteVersion] = await rows(`insert into public.quote_versions (quote_id, version_number, client_id, client_name, project_id, project_name, services_total, created_by)
    values ($1, 1, $2, 'Cliente Tabulador', $3, 'Local 3.2', 2800.00, $4) returning id::int`, [quote.id, client.id, project.id, admin.id]);
  await rows(`insert into public.quote_items (quote_version_id, line_number, service_id, service_version_id, quantity, unit_rate, reference_rate, subtotal)
    values ($1, 1, $2, $3, 200, 14.00, 14.00, 2800.00)`, [quoteVersion.id, legacy.id, legacyVersion.id]);

  await applyMigration(database.client, MIGRATION);
  ids = { admin: admin.id, client: client.id, denomination: denomination.id, legacy: legacy.id, legacyVersion: legacyVersion.id, project: project.id, unit };

  // Servicios con unidades alternativas y una cotización que usó una alternativa, como antes de la unidad única.
  services.modeling = await insertServiceWithAlternative({
    alternative: { rate: null, unitId: unit.space }, code: "SERV-901", name: "Modelado 3D & Renders", rate: "320.00", unitId: unit.project,
  });
  services.tour = await insertServiceWithAlternative({
    alternative: { rate: "275.00", unitId: unit.project }, code: "SERV-902", name: "Recorrido Virtual / VR", rate: "275.00", unitId: unit.minute,
  });
  const [tourQuote] = await rows("insert into public.quotes (code, created_by, updated_by) values ('COT-901', $1, $1) returning id::int", [admin.id]);
  const [tourQuoteVersion] = await rows(`insert into public.quote_versions (quote_id, version_number, client_id, client_name, project_id, project_name, services_total, created_by)
    values ($1, 1, $2, 'Cliente Tabulador', $3, 'Local 3.2', 250.00, $4) returning id::int`, [tourQuote.id, client.id, project.id, admin.id]);
  await rows(`insert into public.quote_items (quote_version_id, line_number, service_id, service_version_id, service_version_unit_option_id, quantity, unit_rate, reference_rate, subtotal)
    select $1, 1, $2, $3, o.id, 1, 250.00, o.reference_rate, 250.00
    from public.service_version_unit_options o where o.service_version_id = $3 and o.position = 2`, [tourQuoteVersion.id, services.tour.id, services.tour.versionId]);
  ids.tourQuote = tourQuote.id;

  Object.assign(process.env, { DATABASE_POOL_MAX: "5", DATABASE_URL: database.databaseUrl, NODE_ENV: "test" });
  db = await import("../src/config/db.js");
  catalog = await import("../src/services/serviceCatalogService.js");
  quotes = await import("../src/services/quoteService.js");
  ({ buildQuoteDocument } = await import("../src/domain/quoteDocument.js"));
});

after(async () => {
  await db?.pool.end().catch(() => {});
  if (database) await database.drop();
});

test("migración de unidades: la unidad de servicios, versiones y conceptos iniciales pasa a la posición 1", { skip }, async () => {
  assert.deepEqual(await rows(`select position, measurement_unit_id::int, unit_denomination_id::int, reference_rate
    from public.service_unit_options where service_id = $1`, [ids.legacy]), [
    { measurement_unit_id: ids.unit.square_meter, position: 1, reference_rate: "14.00", unit_denomination_id: ids.denomination },
  ]);
  assert.deepEqual(await versionOptionsOf(ids.legacy), [[1, 1, "m²", null, "14.00"]]);
  const [item] = await rows(`select i.service_version_unit_option_id = o.id as linked from public.quote_items i
    join public.service_version_unit_options o on o.service_version_id = i.service_version_id and o.position = 1
    where i.service_id = $1`, [ids.legacy]);
  assert.equal(item.linked, true, "El concepto cotizado apunta a la unidad de su versión");
  const [trigger] = await rows("select tgenabled from pg_trigger where tgname = 'quote_items_immutable'");
  assert.equal(trigger.tgenabled, "O");
  await assert.rejects(rows("update public.quote_items set quantity = 1"), { code: "55000" });
  const service = await catalog.getService(ids.legacy);
  assert.deepEqual([service.unitLabel, service.presentationLabel, "unitOptions" in service], ["m² de construcción", null, false]);
});

test("unidad única: alta y edición con una unidad, texto comercial conservado y versionado", { skip }, async () => {
  services.permits = await createService({
    description: "Variables urbanas, bomberos y alcaldía.", measurementUnitId: ids.unit.project, name: "Permisología & Legal",
    presentationLabel: "Global por Proyecto", referenceRate: "510.00",
  });
  assert.deepEqual([services.permits.unitLabel, services.permits.presentationLabel, services.permits.measurementUnit.code], ["Global por Proyecto", "Global por Proyecto", "project"]);
  assert.deepEqual(await currentOptionsOf(services.permits.id), [[1, "proy.", "Global por Proyecto", "510.00"]]);
  // Editar el nombre o la tarifa conserva el texto comercial y versiona una sola unidad.
  const renamed = await updateService(services.permits.id, { expectedVersion: 1, name: "Permisología & Legal (global)", referenceRate: "520.00" });
  assert.deepEqual([renamed.changedFields, renamed.service.unitLabel], [["name", "referenceRate"], "Global por Proyecto"]);
  // Cambiar la unidad sin texto nuevo lo retira (describía la unidad anterior).
  const otherUnit = await updateService(services.permits.id, { expectedVersion: 2, measurementUnitId: ids.unit.month });
  assert.deepEqual([otherUnit.changedFields, otherUnit.service.unitLabel], [["measurementUnitId", "presentationLabel"], "mes"]);
  assert.deepEqual(await versionOptionsOf(services.permits.id), [
    [1, 1, "proy.", "Global por Proyecto", "510.00"], [2, 1, "proy.", "Global por Proyecto", "520.00"], [3, 1, "mes", null, "520.00"],
  ]);
  // Un servicio independiente por cada forma de cobro, con nombres diferenciados.
  services.space = await createService({ measurementUnitId: ids.unit.space, name: "Modelado 3D & Renders — Por espacio", referenceRate: "320.00", sortOrder: 2 });
  assert.deepEqual([services.space.unitLabel, services.space.referenceRate, services.space.sortOrder], ["esp.", "320.00", 2]);
  const bySpace = await catalog.getServicesPage({ measurementUnitId: ids.unit.space });
  assert.deepEqual(bySpace.services.map((service) => service.id), [services.space.id], "El filtro usa la unidad del servicio");
});

test("migración de unidad única: aborta mientras queden alternativas y la separación conserva el historial", { skip }, async () => {
  await assert.rejects(applyMigration(database.client, SINGLE_UNIT_MIGRATION), { code: "55000" });
  // La migración es una sola transacción: el fallo no deja ninguna restricción a medias.
  await rows("rollback");
  assert.deepEqual(await rows("select 1 from pg_constraint where conname = 'chk_service_unit_options_single'"), []);
  // El comando de separación se bloquea si una cotización incluye un servicio por separar.
  const split = await import("../src/services/serviceUnitSplitService.js");
  const { parseOfficialCatalog } = await import("../src/services/officialServiceCatalogLoadService.js");
  const minimalCatalog = parseOfficialCatalog({
    catalogId: "prueba", changeNote: "Prueba", denominations: [], expectedTotals: { denominations: 0, individual: 1, services: 1, turnkey: 0 },
    services: [{ description: null, kind: "individual", name: "Servicio", order: 1, referenceRate: "1.00", unit: "project" }], source: "Prueba",
  });
  const blocked = await split.planServiceUnitSplit(minimalCatalog, { runId: "quotes" });
  assert.equal(blocked.ready, false);
  assert.match(blocked.blockers.join("\n"), /1 conceptos de cotización incluyen servicios que se separarían/);
  const historyBefore = await rows("select count(*)::int as count from public.service_version_unit_options");
  // La separación versiona el original: la versión nueva copia una sola unidad y la 1 conserva las dos.
  for (const [service, name] of [[services.modeling, "Modelado 3D & Renders — Por proyecto"], [services.tour, "Recorrido Virtual / VR — Por minuto"]]) {
    const result = await updateService(service.id, { changeNote: "Separación de unidades", expectedVersion: 1, name });
    assert.deepEqual([result.changedFields, result.service.currentVersion, result.service.name], [["name"], 2, name]);
  }
  assert.deepEqual(await currentOptionsOf(services.tour.id), [[1, "min", null, "275.00"]]);
  assert.deepEqual(await versionOptionsOf(services.tour.id), [[1, 1, "min", null, "275.00"], [1, 2, "proy.", null, "275.00"], [2, 1, "min", null, "275.00"]]);
  assert.deepEqual(await versionOptionsOf(services.modeling.id), [[1, 1, "proy.", null, "320.00"], [1, 2, "esp.", null, null], [2, 1, "proy.", null, "320.00"]]);
  const [historyAfter] = await rows("select count(*)::int as count from public.service_version_unit_options");
  assert.equal(historyAfter.count, historyBefore[0].count + 2, "Solo se añaden las copias de las versiones nuevas");

  await applyMigration(database.client, SINGLE_UNIT_MIGRATION);
  const constraints = await rows(`select conname, convalidated from pg_constraint
    where conname like 'chk_service%unit_options_single' or conname like 'chk_service%unit_options_rate_confirmed' order by conname`);
  assert.deepEqual(constraints.map((row) => [row.conname, row.convalidated]), [
    ["chk_service_unit_options_rate_confirmed", true], ["chk_service_unit_options_single", true],
    ["chk_service_version_unit_options_rate_confirmed", false], ["chk_service_version_unit_options_single", false],
  ]);
  // Cualquier escritor queda limitado a una unidad vigente con tarifa, también en versiones nuevas.
  await assert.rejects(
    rows("insert into public.service_unit_options (service_id, position, measurement_unit_id, reference_rate) values ($1, 2, $2, 1)", [services.tour.id, ids.unit.hour]),
    { code: "23514", constraint: "chk_service_unit_options_single" },
  );
  const [currentVersion] = await rows("select id::int from public.service_versions where service_id = $1 and is_current", [services.tour.id]);
  await assert.rejects(
    rows(`insert into public.service_version_unit_options (service_version_id, position, measurement_unit_id, unit_code, unit_name, unit_symbol, unit_allows_decimals, reference_rate)
      values ($1, 2, $2, 'hour', 'Hora', 'hrs', true, 1)`, [currentVersion.id, ids.unit.hour]),
    { code: "23514", constraint: "chk_service_version_unit_options_single" },
  );
  await assert.rejects(rows("delete from public.service_version_unit_options where position = 2"), { code: "55000" });
  // La sincronización y el versionado siguen funcionando con la restricción.
  const edited = await updateService(services.tour.id, { expectedVersion: 2, referenceRate: "280.00" });
  assert.deepEqual(await currentOptionsOf(services.tour.id), [[1, "min", null, "280.00"]]);
  assert.equal(edited.service.currentVersion, 3);
});

test("cotización: la unidad del servicio con tarifa editable; lo cotizado conserva su unidad, tarifa y etiqueta en el PDF", { skip }, async () => {
  // La cotización anterior conserva la alternativa (proyecto) y su tarifa, también al editarla.
  const historical = await quotes.getQuote(ids.tourQuote);
  assert.deepEqual([historical.items[0].unit.label, historical.items[0].unit.position, historical.items[0].unitRate], ["proy.", 2, "250.00"]);
  assert.equal(buildQuoteDocument(historical).items[0].unitLabel, "proy.");
  const reedited = await quotes.updateQuote({
    payload: { ...quoteBody([{ quantity: "2", serviceId: services.tour.id, unitRate: "250.00" }]), expectedVersion: 1 },
    quoteId: ids.tourQuote,
    user: { id: ids.admin },
  });
  const [kept] = reedited.quote.items;
  assert.deepEqual([kept.unit.label, kept.unit.position, kept.referenceRate, kept.subtotal], ["proy.", 2, "275.00", "500.00"]);
  const [original] = await rows(`select i.unit_rate, i.subtotal from public.quote_items i join public.quote_versions v on v.id = i.quote_version_id
    where v.quote_id = $1 and v.version_number = 1`, [ids.tourQuote]);
  assert.deepEqual([original.unit_rate, original.subtotal], ["250.00", "250.00"], "La versión 1 de la cotización no cambia");

  // Una cotización nueva usa la unidad única de la versión vigente y la tarifa aplicada elegida.
  const created = await quotes.createQuote({
    payload: quoteBody([
      { quantity: "3", serviceId: services.tour.id, unitRate: "260.00" },
      { quantity: "1", serviceId: services.space.id, unitRate: "320.00" },
    ]),
    user: { id: ids.admin },
  });
  assert.deepEqual(created.items.map((item) => [item.unit.label, item.unit.position, item.referenceRate, item.unitRate, item.subtotal]), [
    ["min", 1, "280.00", "260.00", "780.00"], ["esp.", 1, "320.00", "320.00", "320.00"],
  ]);
  assert.equal(created.servicesTotal, "1100.00");

  // El texto comercial copiado en la versión cotizada es la etiqueta del documento.
  const inspection = await createService({
    measurementUnitId: ids.unit.month, name: "Inspección Técnica Obra", presentationLabel: "Honorario Mensual", referenceRate: "510.00",
  });
  const inspectionQuote = await quotes.createQuote({ payload: quoteBody([{ quantity: "2", serviceId: inspection.id, unitRate: "510.00" }]), user: { id: ids.admin } });
  assert.deepEqual(buildQuoteDocument(inspectionQuote).items.map((item) => [item.unitLabel, item.subtotal]), [["Honorario Mensual", "$1,020.00"]]);
  // La unidad cotizada debe pertenecer a la misma versión del servicio (FK compuesta).
  const [foreign] = await rows("select id::int from public.service_version_unit_options where service_version_id <> $1 limit 1", [ids.legacyVersion]);
  await assert.rejects(
    rows(`insert into public.quote_items (quote_version_id, line_number, service_id, service_version_id, service_version_unit_option_id, quantity, unit_rate, reference_rate, subtotal)
      select quote_version_id, 9, $2, $3, $1, 1, 1, 1, 1 from public.quote_items where service_id = $4 limit 1`,
    [foreign.id, ids.legacy, ids.legacyVersion, services.space.id]),
    { code: "23503", constraint: "fk_quote_items_service_version_unit_option" },
  );
});
