import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { applyMigration, createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

// Varias unidades por servicio contra PostgreSQL real. Opcional y aislada, como el catálogo:
// ARCA_SERVICE_CATALOG_DB_TESTS=1 y ARCA_SERVICE_CATALOG_TEST_DATABASE_URL (solo localhost).
// Aplica el historial hasta antes de la migración, prepara un servicio, una versión y un concepto
// cotizado con el modelo anterior, aplica la migración y ejecuta los servicios reales.
const enabled = process.env.ARCA_SERVICE_CATALOG_DB_TESTS === "1";
const createApiRoles = process.env.ARCA_SERVICE_CATALOG_TEST_CREATE_ROLES === "1";
const skip = !enabled && "Requiere PostgreSQL local, ARCA_SERVICE_CATALOG_DB_TESTS=1 y ARCA_SERVICE_CATALOG_TEST_DATABASE_URL.";
const MIGRATION = "20261027120000_service_unit_options";

let database;
let db;
let catalog;
let quotes;
let units;
let buildQuoteDocument;
let ids;
const tabulator = {};

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

  // Datos con el modelo anterior: un servicio con denominación, su versión 1 y un concepto cotizado.
  const [denomination] = await rows(`insert into public.measurement_unit_denominations (measurement_unit_id, denomination, created_by, updated_by)
    values ($1, 'de construcción', $2, $2) returning id::int`, [unit.square_meter, admin.id]);
  const [legacy] = await rows(`insert into public.services (code, name, kind, measurement_unit_id, unit_denomination_id, reference_rate, created_by, updated_by)
    values ('LEGADO', 'Anteproyecto (legado)', 'individual', $1, $2, 12.00, $3, $3) returning id::int`, [unit.square_meter, denomination.id, admin.id]);
  const [legacyVersion] = await rows(`insert into public.service_versions (
      service_id, version_number, code, name, kind, measurement_unit_id, unit_code, unit_name, unit_symbol, unit_allows_decimals,
      unit_denomination_id, unit_denomination, reference_rate, currency_code, is_active, sort_order, changed_by)
    select s.id, 1, s.code, s.name, s.kind, u.id, u.code, u.name, u.symbol, u.allows_decimals, d.id, d.denomination, s.reference_rate,
      s.currency_code, s.is_active, s.sort_order, $2
    from public.services s join public.measurement_units u on u.id = s.measurement_unit_id
    join public.measurement_unit_denominations d on d.id = s.unit_denomination_id where s.id = $1 returning id::int`, [legacy.id, admin.id]);
  const [quote] = await rows("insert into public.quotes (code, created_by, updated_by) values ('COT-900', $1, $1) returning id::int", [admin.id]);
  const [quoteVersion] = await rows(`insert into public.quote_versions (quote_id, version_number, client_id, client_name, project_id, project_name, services_total, created_by)
    values ($1, 1, $2, 'Cliente Tabulador', $3, 'Local 3.2', 2400.00, $4) returning id::int`, [quote.id, client.id, project.id, admin.id]);
  await rows(`insert into public.quote_items (quote_version_id, line_number, service_id, service_version_id, quantity, unit_rate, reference_rate, subtotal)
    values ($1, 1, $2, $3, 200, 12.00, 12.00, 2400.00)`, [quoteVersion.id, legacy.id, legacyVersion.id]);

  await applyMigration(database.client, MIGRATION);
  ids = { admin: admin.id, client: client.id, denomination: denomination.id, legacy: legacy.id, legacyVersion: legacyVersion.id, project: project.id, unit };

  Object.assign(process.env, { DATABASE_POOL_MAX: "5", DATABASE_URL: database.databaseUrl, NODE_ENV: "test" });
  db = await import("../src/config/db.js");
  catalog = await import("../src/services/serviceCatalogService.js");
  quotes = await import("../src/services/quoteService.js");
  units = await import("../src/services/measurementUnitService.js");
  ({ buildQuoteDocument } = await import("../src/domain/quoteDocument.js"));
});

after(async () => {
  await db?.pool.end().catch(() => {});
  if (database) await database.drop();
});

test("migración: la unidad actual de servicios, versiones y conceptos pasa a la posición 1 sin perder la protección", { skip }, async () => {
  assert.deepEqual(await rows(`select position, measurement_unit_id::int, unit_denomination_id::int, reference_rate
    from public.service_unit_options where service_id = $1`, [ids.legacy]), [
    { measurement_unit_id: ids.unit.square_meter, position: 1, reference_rate: "12.00", unit_denomination_id: ids.denomination },
  ]);
  assert.deepEqual(await versionOptionsOf(ids.legacy), [[1, 1, "m²", null, "12.00"]]);
  const [item] = await rows(`select i.service_version_unit_option_id = o.id as linked from public.quote_items i
    join public.service_version_unit_options o on o.service_version_id = i.service_version_id and o.position = 1`);
  assert.equal(item.linked, true, "El concepto cotizado apunta a la unidad principal de su versión");
  // El trigger de conceptos se reactivó dentro de la migración y RLS cubre las tablas nuevas.
  const [trigger] = await rows("select tgenabled from pg_trigger where tgname = 'quote_items_immutable'");
  assert.equal(trigger.tgenabled, "O");
  await assert.rejects(rows("update public.quote_items set quantity = 1"), { code: "55000" });
  const rls = await rows("select relname, relrowsecurity from pg_class where relname in ('service_unit_options', 'service_version_unit_options') order by relname");
  assert.deepEqual(rls.map((row) => row.relrowsecurity), [true, true]);
  // El servicio heredado se sigue leyendo con su etiqueta y una sola unidad.
  const service = await catalog.getService(ids.legacy);
  assert.deepEqual([service.unitLabel, service.unitOptions.length, service.unitOptions[0].referenceRate], ["m² de construcción", 1, "12.00"]);
});

test("tabulador 3.2: varias unidades sin inventar tarifas y texto comercial «Global por Proyecto»", { skip }, async () => {
  tabulator.modeling = await createService({
    description: "Modelo 3D + 3 a 5 renders hiperrealistas.", name: "Modelado 3D & Renders", referenceRate: "450.00",
    unitOptions: [{ measurementUnitId: ids.unit.project, referenceRate: "450.00" }, { measurementUnitId: ids.unit.space, referenceRate: null }],
  });
  tabulator.virtualTour = await createService({
    description: "Video renderizado 4K o experiencia inmersiva VR.", name: "Recorrido Virtual / VR", referenceRate: "600.00",
    unitOptions: [{ measurementUnitId: ids.unit.minute }, { measurementUnitId: ids.unit.project }],
  });
  tabulator.permits = await createService({
    description: "Tratamiento de variables urbanas, bomberos y alcaldía.", name: "Permisología & Legal", referenceRate: "800.00",
    unitOptions: [{ measurementUnitId: ids.unit.project, presentationLabel: "Global por Proyecto" }],
  });
  const summary = (service) => service.unitOptions.map((option) => [option.label, option.referenceRate, option.ratePending]);
  assert.deepEqual(summary(tabulator.modeling), [["proy.", "450.00", false], ["esp.", null, true]]);
  assert.deepEqual(summary(tabulator.virtualTour), [["min", null, true], ["proy.", null, true]]);
  // Una sola unidad usa la tarifa del servicio; el texto comercial es la etiqueta principal.
  assert.deepEqual(summary(tabulator.permits), [["Global por Proyecto", "800.00", false]]);
  assert.equal(tabulator.permits.unitLabel, "Global por Proyecto");
  // La tarifa de referencia del servicio se conserva tal como la indica el tabulador.
  assert.deepEqual([tabulator.modeling.referenceRate, tabulator.virtualTour.referenceRate], ["450.00", "600.00"]);
  // services conserva la unidad principal y la versión 1 copia todas las unidades.
  const [primary] = await rows("select measurement_unit_id::int from public.services where id = $1", [tabulator.virtualTour.id]);
  assert.equal(primary.measurement_unit_id, ids.unit.minute);
  assert.deepEqual(await versionOptionsOf(tabulator.modeling.id), [[1, 1, "proy.", null, "450.00"], [1, 2, "esp.", null, null]]);
  // El filtro por unidad encuentra también las alternativas.
  const bySpace = await catalog.getServicesPage({ measurementUnitId: ids.unit.space });
  assert.deepEqual(bySpace.services.map((service) => service.id), [tabulator.modeling.id]);
});

test("versionado: confirmar una tarifa crea la versión 2 y la 1 conserva la pendiente; las copias son inmutables", { skip }, async () => {
  const updated = await catalog.updateService({
    payload: { expectedVersion: 1, unitOptions: [
      { measurementUnitId: ids.unit.project, referenceRate: "450.00" }, { measurementUnitId: ids.unit.space, referenceRate: "380.00" },
    ] },
    serviceId: tabulator.modeling.id,
    user: { id: ids.admin },
  });
  assert.deepEqual([updated.changed, updated.changedFields, updated.service.currentVersion], [true, ["unitOptions"], 2]);
  assert.deepEqual(await versionOptionsOf(tabulator.modeling.id), [
    [1, 1, "proy.", null, "450.00"], [1, 2, "esp.", null, null], [2, 1, "proy.", null, "450.00"], [2, 2, "esp.", null, "380.00"],
  ]);
  await assert.rejects(rows("update public.service_version_unit_options set reference_rate = 1"), { code: "55000" });
  await assert.rejects(rows("delete from public.service_version_unit_options"), { code: "55000" });
  // Intercambiar la principal y la alternativa no choca con la unicidad y mueve la unidad del servicio.
  const swapped = await catalog.updateService({
    payload: { expectedVersion: 2, unitOptions: [
      { measurementUnitId: ids.unit.space, referenceRate: "380.00" }, { measurementUnitId: ids.unit.project, referenceRate: "450.00" },
    ] },
    serviceId: tabulator.modeling.id,
    user: { id: ids.admin },
  });
  assert.deepEqual([swapped.service.measurementUnit.code, swapped.service.unitLabel], ["space", "esp."]);
  // Repetir una unidad se rechaza antes de escribir.
  await assert.rejects(
    catalog.updateService({
      payload: { expectedVersion: 3, unitOptions: [{ measurementUnitId: ids.unit.space }, { measurementUnitId: ids.unit.space }] },
      serviceId: tabulator.modeling.id,
      user: { id: ids.admin },
    }),
    (error) => error.code === "VALIDATION_ERROR" && Boolean(error.fields["unitOptions.1.measurementUnitId"]),
  );
});

test("coherencia en PostgreSQL: escrituras directas sincronizan la principal y una lista incompleta no se confirma", { skip }, async () => {
  // Un alta directa (contrato anterior) registra su unidad en la posición 1.
  const [direct] = await rows(`insert into public.services (code, name, measurement_unit_id, reference_rate)
    values ('DIRECTO', 'Directo', $1, 20.00) returning id::int`, [ids.unit.linear_meter]);
  const option = async (serviceId) => rows(`select position, measurement_unit_id::int, presentation_label, reference_rate
    from public.service_unit_options where service_id = $1 order by position`, [serviceId]);
  assert.deepEqual(await option(direct.id), [{ measurement_unit_id: ids.unit.linear_meter, position: 1, presentation_label: null, reference_rate: "20.00" }]);
  // Con una sola unidad, la tarifa del servicio y el cambio de unidad se sincronizan (y se retira el texto comercial).
  await rows("update public.service_unit_options set presentation_label = 'Metro lineal comercial' where service_id = $1", [direct.id]);
  await rows("update public.services set measurement_unit_id = $2, reference_rate = 25.00 where id = $1", [direct.id, ids.unit.meter]);
  assert.deepEqual(await option(direct.id), [{ measurement_unit_id: ids.unit.meter, position: 1, presentation_label: null, reference_rate: "25.00" }]);
  // Con varias unidades, la tarifa del tabulador no altera las de las unidades.
  await rows("update public.services set reference_rate = 650.00 where id = $1", [tabulator.virtualTour.id]);
  assert.deepEqual((await option(tabulator.virtualTour.id)).map((row) => row.reference_rate), [null, null]);
  await rows("update public.services set reference_rate = 600.00 where id = $1", [tabulator.virtualTour.id]);

  // Reglas diferidas: sin unidades, con huecos o con una principal distinta no se confirma.
  for (const sql of [
    "delete from public.service_unit_options where service_id = $1",
    "update public.service_unit_options set position = 3 where service_id = $1 and position = 2",
  ]) {
    await rows("begin");
    await rows(sql, [tabulator.virtualTour.id]);
    await assert.rejects(rows("commit"), { code: "23514" }, sql);
  }
  await assert.rejects(
    rows("insert into public.service_unit_options (service_id, position, measurement_unit_id) values ($1, 3, $2)", [tabulator.virtualTour.id, ids.unit.minute]),
    { code: "23505", constraint: "uq_service_unit_options_unit" },
  );
  await assert.rejects(
    rows("insert into public.service_unit_options (service_id, position, measurement_unit_id) values ($1, 11, $2)", [tabulator.virtualTour.id, ids.unit.hour]),
    { code: "23514" },
  );
  // Una denominación de otra base no puede asignarse a una unidad (FK compuesta).
  await assert.rejects(
    rows("insert into public.service_unit_options (service_id, position, measurement_unit_id, unit_denomination_id) values ($1, 3, $2, $3)",
      [tabulator.virtualTour.id, ids.unit.hour, ids.denomination]),
    { code: "23503", constraint: "fk_service_unit_options_unit_denomination" },
  );
});

test("cotización: solo unidades con tarifa confirmada, con su referencia, y el PDF usa el texto comercial", { skip }, async () => {
  const modelingQuote = (unitOptionPosition) => quotes.createQuote({
    payload: quoteBody([{ quantity: "1", serviceId: tabulator.modeling.id, unitOptionPosition, unitRate: "380.00" }]),
    user: { id: ids.admin },
  });
  // Recorrido VR: ninguna de sus unidades tiene tarifa confirmada.
  for (const unitOptionPosition of [1, 2]) {
    await assert.rejects(
      quotes.createQuote({ payload: quoteBody([{ quantity: "1", serviceId: tabulator.virtualTour.id, unitOptionPosition, unitRate: "600.00" }]), user: { id: ids.admin } }),
      (error) => /pendiente de validación comercial/.test(error.fields?.["items.0.unitOptionPosition"]),
    );
  }
  await assert.rejects(modelingQuote(undefined), (error) => /Elige la unidad/.test(error.fields?.["items.0.unitOptionPosition"]));
  const created = await modelingQuote(1);
  assert.deepEqual([created.items[0].unit.label, created.items[0].referenceRate], ["esp.", "380.00"]);

  const permits = await quotes.createQuote({
    payload: quoteBody([{ quantity: "1", serviceId: tabulator.permits.id, unitRate: "800.00" }]),
    user: { id: ids.admin },
  });
  assert.equal(buildQuoteDocument(permits).items[0].unitLabel, "Global por Proyecto");
  // La unidad cotizada debe pertenecer a la misma versión del servicio (FK compuesta): se añade el
  // servicio heredado a la cotización de Permisología con una unidad copiada de otra versión.
  const [foreign] = await rows("select id::int from public.service_version_unit_options where service_version_id <> $1 limit 1", [ids.legacyVersion]);
  await assert.rejects(
    rows(`insert into public.quote_items (quote_version_id, line_number, service_id, service_version_id, service_version_unit_option_id, quantity, unit_rate, reference_rate, subtotal)
      select quote_version_id, 9, $2, $3, $1, 1, 1, 1, 1 from public.quote_items where service_id = $4 limit 1`,
    [foreign.id, ids.legacy, ids.legacyVersion, tabulator.permits.id]),
    { code: "23503", constraint: "fk_quote_items_service_version_unit_option" },
  );
});

test("denominaciones: usada solo como unidad alternativa cuenta como en uso y su base no cambia", { skip }, async () => {
  const exhibit = await units.createDenomination({ payload: { denomination: "de exhibición", measurementUnitId: ids.unit.space }, user: { id: ids.admin } });
  await createService({
    name: "Stand", referenceRate: "300.00",
    unitOptions: [{ measurementUnitId: ids.unit.square_meter, referenceRate: "300.00" }, { measurementUnitId: ids.unit.space, unitDenominationId: exhibit.id }],
  });
  const read = await units.getDenomination(exhibit.id);
  assert.deepEqual([read.activeServiceCount, read.baseUnitEditable], [1, false]);
  await assert.rejects(
    units.updateDenomination({ denominationId: exhibit.id, payload: { measurementUnitId: ids.unit.project }, user: { id: ids.admin } }),
    { code: "MEASUREMENT_UNIT_BASE_IN_USE" },
  );
  await assert.rejects(
    units.changeDenominationStatus({ denominationId: exhibit.id, payload: { isActive: false }, user: { id: ids.admin } }),
    (error) => /IN_USE/.test(error.code),
  );
  // PostgreSQL también lo impide aunque se salte el backend.
  await assert.rejects(rows("update public.measurement_unit_denominations set measurement_unit_id = $1 where id = $2", [ids.unit.project, exhibit.id]), { code: "55000" });
});
