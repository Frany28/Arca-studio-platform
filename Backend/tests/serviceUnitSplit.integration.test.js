import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createIsolatedMigrationDatabase, applyMigration } from "./helpers/isolatedMigrationDatabase.js";

// Separación de servicios con unidades alternativas (scripts/split-service-units.mjs) contra
// PostgreSQL real. Opcional y aislada: ARCA_SERVICE_CATALOG_DB_TESTS=1 y
// ARCA_SERVICE_CATALOG_TEST_DATABASE_URL (solo localhost). Reproduce la forma del catálogo cargado
// antes de la unidad única (SERV-002 y SERV-003 con una alternativa, versión 1 con ambas unidades)
// con tarifas ficticias, separa con el servicio real y aplica después la migración de unidad única.
const enabled = process.env.ARCA_SERVICE_CATALOG_DB_TESTS === "1";
const createApiRoles = process.env.ARCA_SERVICE_CATALOG_TEST_CREATE_ROLES === "1";
const skip = !enabled && "Requiere PostgreSQL local, ARCA_SERVICE_CATALOG_DB_TESTS=1 y ARCA_SERVICE_CATALOG_TEST_DATABASE_URL.";
const SINGLE_UNIT_MIGRATION = "20261030120000_service_single_unit_option";

let database;
let db;
let loader;
let split;
let maintenance;
let catalog;
let admin;
let unit;
let applied;

/**
 * Catálogo revisado de prueba: una unidad por servicio, los originales con su nombre nuevo y las
 * variantes al final, colocadas junto a su original.
 *
 * @param {object} [overrides] - Cambios por orden de servicio.
 * @returns {object} Catálogo sin validar.
 */
function revisedCatalog(overrides = {}) {
  const services = [
    { denomination: "de construcción", description: "Planimetría 2D.", kind: "individual", name: "Anteproyecto de prueba", order: 1, referenceRate: "14.00", unit: "square_meter" },
    { description: "Modelo 3D.", kind: "individual", name: "Modelado de prueba — Por proyecto", order: 2, referenceRate: "320.00", unit: "project" },
    { description: "Video 4K.", kind: "individual", name: "Recorrido de prueba — Por minuto", order: 3, referenceRate: "275.00", unit: "minute" },
    { description: null, kind: "individual", name: "Permisos de prueba", order: 4, presentationLabel: "Global por Proyecto", referenceRate: "510.00", unit: "project" },
    { description: null, kind: "turnkey", name: "Llave en mano de prueba", order: 5, referenceRate: "610.00", unit: "square_meter" },
    { description: "Modelo 3D.", kind: "individual", name: "Modelado de prueba — Por espacio", order: 6, referenceRate: "320.00", sortOrder: 2, unit: "space" },
    { description: "Video 4K.", kind: "individual", name: "Recorrido de prueba — Por proyecto", order: 7, referenceRate: "275.00", sortOrder: 3, unit: "project" },
  ].map((service) => ({ ...service, ...overrides[service.order] }));
  return {
    catalogId: "prueba-tabulador-unidad-unica",
    changeNote: "Separación de unidades de prueba",
    denominations: [{ denomination: "de construcción", unit: "square_meter" }],
    expectedTotals: { denominations: 1, individual: 6, services: 7, turnkey: 1 },
    services,
    source: "Documento de prueba",
  };
}

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
 * Registra un servicio como lo dejó la carga anterior a la unidad única: id y código de la
 * secuencia, unidad opcionalmente con alternativa y versión 1 (el trigger copia sus unidades).
 *
 * @param {object} service - Datos del servicio.
 * @returns {Promise<number>} Id del servicio.
 */
async function insertLoadedService({ alternative, denominationId = null, description = null, kind = "individual", label = null, name, rate, unitCode }) {
  await rows("begin");
  const [{ id }] = await rows("select nextval(pg_get_serial_sequence('public.services', 'id'))::int as id");
  await rows(`insert into public.services (id, code, name, description, kind, measurement_unit_id, unit_denomination_id, reference_rate, sort_order, created_by, updated_by)
    values ($1, $9, $2, $3, $4, $5, $6, $7, $10, $8, $8)`,
  [id, name, description, kind, unit[unitCode], denominationId, rate, admin.id, `SERV-${String(id).padStart(3, "0")}`, id]);
  if (label) await rows("update public.service_unit_options set presentation_label = $2 where service_id = $1", [id, label]);
  if (alternative) {
    await rows("insert into public.service_unit_options (service_id, position, measurement_unit_id, reference_rate) values ($1, 2, $2, $3)",
      [id, unit[alternative.unitCode], alternative.rate]);
  }
  await rows(`insert into public.service_versions (
      service_id, version_number, code, name, description, kind, measurement_unit_id, unit_code, unit_name, unit_symbol, unit_allows_decimals,
      unit_denomination_id, unit_denomination, reference_rate, currency_code, is_active, sort_order, change_note, changed_by)
    select s.id, 1, s.code, s.name, s.description, s.kind, u.id, u.code, u.name, u.symbol, u.allows_decimals, d.id, d.denomination,
      s.reference_rate, s.currency_code, s.is_active, s.sort_order, 'Carga inicial', $2
    from public.services s join public.measurement_units u on u.id = s.measurement_unit_id
    left join public.measurement_unit_denominations d on d.id = s.unit_denomination_id where s.id = $1`, [id, admin.id]);
  await rows("commit");
  return id;
}

/**
 * Cuenta las filas que puede escribir la separación, para comprobar que un plan o un rechazo no escriben.
 *
 * @returns {Promise<object>} Conteos.
 */
async function writeCounts() {
  const [row] = await rows(`select (select count(*) from public.services)::int as services,
    (select count(*) from public.service_versions)::int as versions,
    (select count(*) from public.service_unit_options)::int as units,
    (select count(*) from public.audit_logs)::int as audits`);
  return row;
}

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({
    baseUrl: process.env.ARCA_SERVICE_CATALOG_TEST_DATABASE_URL,
    createApiRoles,
    prefix: "arca_unit_split",
    stopBefore: SINGLE_UNIT_MIGRATION,
  });
  const [role] = await rows("insert into public.roles (code, name) values ('admin', 'Administrador') returning id");
  [admin] = await rows(`insert into public.users (role_id, email, first_name, last_name, password_hash)
    values ($1, 'separacion@arca.test', 'Admin', 'Separación', '!integration-login-disabled!') returning id::int`, [role.id]);
  unit = Object.fromEntries((await rows("select id::int, code from public.measurement_units")).map((row) => [row.code, row.id]));
  const [denomination] = await rows(`insert into public.measurement_unit_denominations (measurement_unit_id, denomination, created_by, updated_by)
    values ($1, 'de construcción', $2, $2) returning id::int`, [unit.square_meter, admin.id]);

  const first = await insertLoadedService({ denominationId: denomination.id, description: "Planimetría 2D.", name: "Anteproyecto de prueba", rate: "14.00", unitCode: "square_meter" });
  await insertLoadedService({ alternative: { rate: null, unitCode: "space" }, description: "Modelo 3D.", name: "Modelado de prueba", rate: "320.00", unitCode: "project" });
  await insertLoadedService({ alternative: { rate: "275.00", unitCode: "project" }, description: "Video 4K.", name: "Recorrido de prueba", rate: "275.00", unitCode: "minute" });
  await insertLoadedService({ label: "Global por Proyecto", name: "Permisos de prueba", rate: "510.00", unitCode: "project" });
  await insertLoadedService({ kind: "turnkey", name: "Llave en mano de prueba", rate: "610.00", unitCode: "square_meter" });

  // Una cotización con un servicio no afectado: forma parte del historial que no debe cambiar.
  const [client] = await rows("insert into public.clients (name, email) values ('Cliente', 'cliente-separacion@arca.test') returning id::int");
  const [project] = await rows(`insert into public.projects (client_id, created_by, name, start_date, project_type, location, public_slug)
    values ($1, $2, 'Local', current_date, (select enum_range(null::public.project_type))[1], 'Caracas', 'local-separacion') returning id::int`, [client.id, admin.id]);
  const [quote] = await rows("insert into public.quotes (code, created_by, updated_by) values ('COT-001', $1, $1) returning id::int", [admin.id]);
  const [quoteVersion] = await rows(`insert into public.quote_versions (quote_id, version_number, client_id, client_name, project_id, project_name, services_total, created_by)
    values ($1, 1, $2, 'Cliente', $3, 'Local', 2800.00, $4) returning id::int`, [quote.id, client.id, project.id, admin.id]);
  await rows(`insert into public.quote_items (quote_version_id, line_number, service_id, service_version_id, service_version_unit_option_id, quantity, unit_rate, reference_rate, subtotal)
    select $1, 1, v.service_id, v.id, o.id, 200, 14.00, 14.00, 2800.00
    from public.service_versions v join public.service_version_unit_options o on o.service_version_id = v.id where v.service_id = $2`, [quoteVersion.id, first]);

  Object.assign(process.env, { DATABASE_POOL_MAX: "5", DATABASE_URL: database.databaseUrl, NODE_ENV: "test" });
  db = await import("../src/config/db.js");
  loader = await import("../src/services/officialServiceCatalogLoadService.js");
  split = await import("../src/services/serviceUnitSplitService.js");
  maintenance = await import("../src/repositories/catalogMaintenanceRepository.js");
  catalog = loader.parseOfficialCatalog(revisedCatalog());
});

after(async () => {
  await db?.pool.end().catch(() => {});
  if (database) await database.drop();
});

test("plan: versiona los originales, predice SERV-006 y SERV-007 y no escribe ni consume la secuencia", { skip }, async () => {
  const before = await writeCounts();
  const plan = await split.planServiceUnitSplit(catalog, { runId: "dry" });
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.ready, true);
  assert.deepEqual(plan.updates.map((step) => [step.code, step.currentVersion, step.nextVersion, step.fromName, step.toName, step.removedUnits]), [
    ["SERV-002", 1, 2, "Modelado de prueba", "Modelado de prueba — Por proyecto", 1],
    ["SERV-003", 1, 2, "Recorrido de prueba", "Recorrido de prueba — Por minuto", 1],
  ]);
  assert.deepEqual(plan.creations.map((step) => [step.expectedCode, step.name, step.referenceRate, step.sortOrder]), [
    ["SERV-006", "Modelado de prueba — Por espacio", "320.00", 2],
    ["SERV-007", "Recorrido de prueba — Por proyecto", "275.00", 3],
  ]);
  assert.deepEqual(plan.quoteReferences, { affectedQuoteItems: 0, quoteItems: 1, quoteVersions: 1, quotes: 1 });
  assert.equal(plan.pendingWrites, 4);
  assert.deepEqual(await writeCounts(), before);
  assert.equal(await maintenance.readNextSerialId("public.services", "id"), 6);
});

test("plan: la separación no cambia tarifas ni unidades; cualquier otra diferencia la bloquea", { skip }, async () => {
  const changedRate = loader.parseOfficialCatalog(revisedCatalog({ 2: { referenceRate: "330.00" } }));
  const plan = await split.planServiceUnitSplit(changedRate, { runId: "rate" });
  assert.equal(plan.ready, false);
  assert.match(plan.blockers.join("\n"), /SERV-002: la separación solo cambia el nombre y retira las unidades alternativas; además difiere en: referenceRate/);
  const otherUnit = loader.parseOfficialCatalog(revisedCatalog({ 3: { unit: "hour" } }));
  assert.match((await split.planServiceUnitSplit(otherUnit, { runId: "unit" })).blockers.join("\n"), /SERV-003: .*difiere en: measurementUnitId/);
});

test("concurrencia: con otra operación del catálogo en curso no se escribe nada", { skip }, async () => {
  const lock = await maintenance.tryAcquireCatalogLoadLock();
  try {
    const before = await writeCounts();
    await assert.rejects(split.applyServiceUnitSplit(catalog, { catalogSha256: "a".repeat(64), runId: "lock", user: admin }), { code: "CATALOG_LOAD_IN_PROGRESS" });
    assert.deepEqual(await writeCounts(), before);
  } finally {
    await lock.release();
  }
});

test("aplicación: versiones 2 y altas por el backend, auditadas, con el historial intacto", { skip }, async () => {
  const sha = "b".repeat(64);
  applied = await split.applyServiceUnitSplit(catalog, { catalogSha256: sha, runId: "run1", user: admin });
  assert.deepEqual(applied.completed.map((item) => [item.type, item.code, item.version ?? null]), [
    ["service_version", "SERV-002", 2], ["service_version", "SERV-003", 2], ["service", "SERV-006", null], ["service", "SERV-007", null],
  ]);
  assert.equal(applied.verification.ok, true, applied.verification.issues.join("\n"));
  assert.ok(applied.verification.history, "Compara el historial con la huella del plan");

  // La versión 1 conserva las dos unidades; la 2 copia solo la del servicio, con el nombre nuevo.
  const copies = await rows(`select s.code, v.version_number, v.name, o.position, u.code as unit, o.reference_rate, v.is_current, v.change_note
    from public.service_version_unit_options o join public.service_versions v on v.id = o.service_version_id
    join public.services s on s.id = v.service_id join public.measurement_units u on u.id = o.measurement_unit_id
    where s.code in ('SERV-002', 'SERV-006') order by s.id, v.version_number, o.position`);
  assert.deepEqual(copies.map((row) => [row.code, row.version_number, row.name, row.position, row.unit, row.reference_rate, row.is_current]), [
    ["SERV-002", 1, "Modelado de prueba", 1, "project", "320.00", false],
    ["SERV-002", 1, "Modelado de prueba", 2, "space", null, false],
    ["SERV-002", 2, "Modelado de prueba — Por proyecto", 1, "project", "320.00", true],
    ["SERV-006", 1, "Modelado de prueba — Por espacio", 1, "space", "320.00", true],
  ]);
  assert.ok(copies.filter((row) => row.is_current).every((row) => /· carga run1$/.test(row.change_note)));
  // Cada servicio con una sola unidad vigente; las variantes junto a su original.
  assert.deepEqual(await rows("select service_id::int from public.service_unit_options group by service_id having count(*) <> 1"), []);
  const ordered = await rows("select code from public.services order by sort_order, id");
  assert.deepEqual(ordered.map((row) => row.code), ["SERV-001", "SERV-002", "SERV-006", "SERV-003", "SERV-007", "SERV-004", "SERV-005"]);
  const [sequence] = await rows("select last_value::int from public.services_id_seq");
  assert.equal(sequence.last_value, 7, "La secuencia solo avanzó con las dos altas");
  // Texto comercial y servicios no afectados sin cambios.
  const [permits] = await rows("select o.presentation_label, (select count(*)::int from public.service_versions v where v.service_id = s.id) as versions from public.services s join public.service_unit_options o on o.service_id = s.id where s.code = 'SERV-004'");
  assert.deepEqual([permits.presentation_label, permits.versions], ["Global por Proyecto", 1]);

  const audits = await rows("select action, user_id::int, user_agent, new_values from public.audit_logs order by id");
  assert.deepEqual(audits.map((row) => row.action), [
    "service_catalog.unit_split.service_versioned", "service_catalog.unit_split.service_versioned",
    "service_catalog.official_load.service_created", "service_catalog.official_load.service_created",
  ]);
  assert.ok(audits.every((row) => row.user_id === admin.id && row.user_agent === "maintenance:split-service-units" && row.new_values.catalogSha256 === sha));
  assert.deepEqual(audits[0].new_values.fromName, "Modelado de prueba");
});

test("idempotencia: repetir la separación no escribe nada y la verificación con la huella sigue correcta", { skip }, async () => {
  const before = await writeCounts();
  const plan = await split.planServiceUnitSplit(catalog, { runId: "again" });
  assert.deepEqual([plan.ready, plan.pendingWrites], [true, 0]);
  const again = await split.applyServiceUnitSplit(catalog, { catalogSha256: "c".repeat(64), runId: "run2", user: admin });
  assert.deepEqual([again.completed.length, again.verification.ok], [0, true]);
  assert.deepEqual(await writeCounts(), before);
  const verification = await split.verifyServiceUnitSplit(catalog, { historyBefore: applied.plan.history });
  assert.equal(verification.ok, true, verification.issues.join("\n"));
  assert.deepEqual(verification.notes.filter((note) => /versión 2/.test(note)).length, 2);
});

test("migración de unidad única: se aplica después de la separación y fija una unidad por servicio", { skip }, async () => {
  await applyMigration(database.client, SINGLE_UNIT_MIGRATION);
  await assert.rejects(
    rows("insert into public.service_unit_options (service_id, position, measurement_unit_id, reference_rate) select id, 2, $1, 1 from public.services where code = 'SERV-002'", [unit.hour]),
    { code: "23514", constraint: "chk_service_unit_options_single" },
  );
  // Tras la migración, el catálogo verificado sigue intacto.
  const verification = await split.verifyServiceUnitSplit(catalog, { historyBefore: applied.plan.history });
  assert.equal(verification.ok, true, verification.issues.join("\n"));
});

test("historial alterado: la verificación detecta una versión copiada distinta de la huella", { skip }, async () => {
  const altered = structuredClone(applied.plan.history);
  altered.versionUnits.digest = "0".repeat(32);
  const verification = await split.verifyServiceUnitSplit(catalog, { historyBefore: altered });
  assert.equal(verification.ok, false);
  assert.match(verification.issues.join("\n"), /El historial de unidades copiadas en versiones cambió/);
});
