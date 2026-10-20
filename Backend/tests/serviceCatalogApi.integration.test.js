import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

// Backend del catálogo de servicios contra PostgreSQL real. Opcional y aislada:
// ARCA_SERVICE_CATALOG_DB_TESTS=1 y ARCA_SERVICE_CATALOG_TEST_DATABASE_URL (solo localhost).
// Crea una base propia con el historial completo de migraciones y la elimina al terminar;
// nunca usa DATABASE_URL del proyecto. Ejecuta el servicio y el repositorio reales.
const enabled = process.env.ARCA_SERVICE_CATALOG_DB_TESTS === "1";
const skip = !enabled && "Requiere PostgreSQL local, ARCA_SERVICE_CATALOG_DB_TESTS=1 y ARCA_SERVICE_CATALOG_TEST_DATABASE_URL.";

let database;
let catalog;
let db;
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
 * Devuelve las versiones de un servicio en orden, con los campos relevantes para las pruebas.
 *
 * @param {number} serviceId - Servicio consultado.
 * @returns {Promise<Array<object>>} Versiones.
 */
function versionsOf(serviceId) {
  return rows(`select version_number, reference_rate, is_active, is_current, unit_symbol, changed_by::int, change_note
    from public.service_versions where service_id = $1 order by version_number`, [serviceId]);
}

/**
 * Crea un servicio con valores por defecto válidos mediante el servicio real.
 *
 * @param {object} [overrides] - Campos del cuerpo validado que se sustituyen.
 * @param {number} [userId] - Administrador responsable.
 * @returns {Promise<object>} Servicio creado.
 */
function create(overrides = {}, userId = ids.adminA) {
  return catalog.createService({
    payload: {
      changeNote: null, code: "SRV", description: null, isActive: true, kind: "individual",
      measurementUnitId: ids.squareMeter, name: "Servicio", referenceRate: "12.00", sortOrder: 0, ...overrides,
    },
    user: { id: userId },
  });
}

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({
    baseUrl: process.env.ARCA_SERVICE_CATALOG_TEST_DATABASE_URL,
    prefix: "arca_service_catalog_api",
  });
  const [role] = await rows("insert into public.roles (code, name) values ('admin', 'Administrador') returning id");
  const admins = await rows(`
    insert into public.users (role_id, email, first_name, last_name, password_hash) values
      ($1, 'admin-a@arca.test', 'Admin', 'A', '!integration-login-disabled!'),
      ($1, 'admin-b@arca.test', 'Admin', 'B', '!integration-login-disabled!')
    returning id::int`, [role.id]);
  const units = await rows(`
    insert into public.measurement_units (code, name, symbol, allows_decimals, is_active, sort_order) values
      ('square_meter', 'Metro cuadrado', 'm²', true, true, 1),
      ('point', 'Punto', 'pto', false, true, 2),
      ('legacy_unit', 'Unidad retirada', 'ret', true, false, 3)
    returning id::int, code`);
  const unitId = Object.fromEntries(units.map((unit) => [unit.code, unit.id]));
  ids = { adminA: admins[0].id, adminB: admins[1].id, legacy: unitId.legacy_unit, point: unitId.point, squareMeter: unitId.square_meter };

  Object.assign(process.env, { DATABASE_POOL_MAX: "5", DATABASE_URL: database.databaseUrl, NODE_ENV: "test" });
  db = await import("../src/config/db.js");
  catalog = await import("../src/services/serviceCatalogService.js");
});

after(async () => {
  await db?.pool.end().catch(() => {});
  if (database) await database.drop();
});

test("alta: crea el servicio y su versión 1 con la unidad copiada en la misma transacción", { skip }, async () => {
  const service = await create({ code: "ANTEPROYECTO", name: "Anteproyecto arquitectónico", changeNote: "Tabulador 3.2", sortOrder: 1 });
  assert.equal(service.currentVersion, 1);
  assert.equal(service.referenceRate, "12.00");
  assert.equal(service.currency, "USD");
  assert.equal(service.measurementUnit.code, "square_meter");
  assert.deepEqual(await versionsOf(service.id), [
    { change_note: "Tabulador 3.2", changed_by: ids.adminA, is_active: true, is_current: true, reference_rate: "12.00", unit_symbol: "m²", version_number: 1 },
  ]);
  const llave = await create({ code: "LLAVE-PREMIUM", kind: "turnkey", referenceRate: "900.00", sortOrder: 2 });
  assert.equal(llave.kind, "turnkey");
});

test("alta: unidad inexistente, inactiva o incompatible con llave en mano no deja registros", { skip }, async () => {
  const before = (await rows("select count(*)::int total from public.services"))[0].total;
  const cases = [
    [{ code: "SIN-UNIDAD", measurementUnitId: 999999 }, "La unidad de medida no existe."],
    [{ code: "UNIDAD-RETIRADA", measurementUnitId: ids.legacy }, "La unidad de medida está inactiva."],
    [{ code: "LLAVE-POR-PUNTO", kind: "turnkey", measurementUnitId: ids.point }, "Las modalidades llave en mano requieren una unidad de superficie en metros cuadrados."],
  ];
  for (const [overrides, message] of cases) {
    await assert.rejects(create(overrides), (error) => {
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.equal(error.fields.measurementUnitId, message);
      return true;
    });
  }
  assert.equal((await rows("select count(*)::int total from public.services"))[0].total, before);
});

test("alta: un código duplicado responde 409 y conserva un único servicio", { skip }, async () => {
  await assert.rejects(create({ code: "ANTEPROYECTO" }), { code: "SERVICE_CODE_ALREADY_EXISTS", status: 409 });
  const results = await Promise.allSettled([create({ code: "SIMULTANEO" }), create({ code: "SIMULTANEO" }, ids.adminB)]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "SERVICE_CODE_ALREADY_EXISTS");
  assert.equal((await rows("select count(*)::int total from public.services where code = 'SIMULTANEO'"))[0].total, 1);
});

test("edición: sin cambios efectivos no crea versión; un cambio de tarifa crea la versión 2", { skip }, async () => {
  const [{ id }] = await rows("select id::int from public.services where code = 'ANTEPROYECTO'");
  const unchanged = await catalog.updateService({
    payload: { expectedVersion: 1, name: "Anteproyecto arquitectónico", referenceRate: "12.00", changeNote: "Sin cambios" },
    serviceId: id, user: { id: ids.adminB },
  });
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.service.currentVersion, 1);
  assert.equal((await versionsOf(id)).length, 1);

  const updated = await catalog.updateService({
    payload: { expectedVersion: 1, referenceRate: "15.50", changeNote: "Ajuste 2026" }, serviceId: id, user: { id: ids.adminB },
  });
  assert.equal(updated.changed, true);
  assert.deepEqual(updated.changedFields, ["referenceRate"]);
  assert.equal(updated.service.referenceRate, "15.50");
  assert.equal(updated.service.currentVersion, 2);
  assert.deepEqual((await versionsOf(id)).map((v) => [v.version_number, v.reference_rate, v.is_current, v.changed_by]), [
    [1, "12.00", false, ids.adminA],
    [2, "15.50", true, ids.adminB],
  ]);
  const [{ updated_by: updatedBy }] = await rows("select updated_by::int from public.services where id = $1", [id]);
  assert.equal(updatedBy, ids.adminB);
});

test("estado: desactivar y activar crean versiones y el servicio inactivo sigue consultable", { skip }, async () => {
  const [{ id }] = await rows("select id::int from public.services where code = 'ANTEPROYECTO'");
  const off = await catalog.changeServiceStatus({ payload: { expectedVersion: 2, isActive: false, changeNote: null }, serviceId: id, user: { id: ids.adminA } });
  assert.equal(off.service.isActive, false);
  assert.equal(off.service.currentVersion, 3);
  assert.equal((await catalog.getService(id)).isActive, false);
  const inactive = await catalog.getServicesPage({ status: "inactive" });
  assert.deepEqual(inactive.services.map((service) => service.code), ["ANTEPROYECTO"]);
  const repeated = await catalog.changeServiceStatus({ payload: { expectedVersion: 3, isActive: false, changeNote: null }, serviceId: id, user: { id: ids.adminA } });
  assert.equal(repeated.changed, false);
  const on = await catalog.changeServiceStatus({ payload: { expectedVersion: 3, isActive: true, changeNote: null }, serviceId: id, user: { id: ids.adminA } });
  assert.equal(on.service.currentVersion, 4);
  assert.deepEqual((await versionsOf(id)).map((v) => [v.version_number, v.is_active, v.is_current]), [
    [1, true, false], [2, true, false], [3, false, false], [4, true, true],
  ]);
});

test("concurrencia: versión esperada desactualizada y dos administradores simultáneos", { skip }, async () => {
  const [{ id }] = await rows("select id::int from public.services where code = 'ANTEPROYECTO'");
  await assert.rejects(
    catalog.updateService({ payload: { expectedVersion: 2, name: "Viejo" }, serviceId: id, user: { id: ids.adminA } }),
    { code: "SERVICE_VERSION_CONFLICT", status: 409 },
  );
  const results = await Promise.allSettled([
    catalog.updateService({ payload: { expectedVersion: 4, referenceRate: "20.00" }, serviceId: id, user: { id: ids.adminA } }),
    catalog.updateService({ payload: { expectedVersion: 4, referenceRate: "30.00" }, serviceId: id, user: { id: ids.adminB } }),
  ]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "SERVICE_VERSION_CONFLICT");
  const winner = fulfilled[0].value.service;
  assert.equal(winner.currentVersion, 5);
  const versions = await versionsOf(id);
  assert.equal(versions.length, 5);
  assert.deepEqual(versions.filter((v) => v.is_current).map((v) => [v.version_number, v.reference_rate]), [[5, winner.referenceRate]]);
});

test("reversión: un fallo a mitad de la edición no deja cambios ni pierde la versión vigente", { skip }, async () => {
  const [{ id }] = await rows("select id::int from public.services where code = 'ANTEPROYECTO'");
  const before = await catalog.getService(id);
  const versionsBefore = await versionsOf(id);
  // Un responsable inexistente viola la FK al actualizar: toda la transacción se revierte.
  await assert.rejects(
    catalog.updateService({ payload: { expectedVersion: before.currentVersion, referenceRate: "99.00" }, serviceId: id, user: { id: 999999 } }),
    { code: "SERVICE_REFERENCE_CONFLICT", status: 409 },
  );
  assert.deepEqual(await catalog.getService(id), before);
  assert.deepEqual(await versionsOf(id), versionsBefore);
});

test("edición: cambiar a una unidad inactiva o a llave en mano con unidad incompatible se rechaza", { skip }, async () => {
  const service = await create({ code: "PUNTOS", measurementUnitId: ids.point, referenceRate: "45.00", sortOrder: 3 });
  await assert.rejects(
    catalog.updateService({ payload: { expectedVersion: 1, measurementUnitId: ids.legacy }, serviceId: service.id, user: { id: ids.adminA } }),
    (error) => error.code === "VALIDATION_ERROR" && error.fields.measurementUnitId === "La unidad de medida está inactiva.",
  );
  await assert.rejects(
    catalog.updateService({ payload: { expectedVersion: 1, kind: "turnkey" }, serviceId: service.id, user: { id: ids.adminA } }),
    (error) => error.code === "VALIDATION_ERROR" && /llave en mano/.test(error.fields.measurementUnitId),
  );
  const moved = await catalog.updateService({
    payload: { expectedVersion: 1, kind: "turnkey", measurementUnitId: ids.squareMeter }, serviceId: service.id, user: { id: ids.adminA },
  });
  assert.deepEqual(moved.changedFields, ["kind", "measurementUnitId"]);
  assert.deepEqual((await versionsOf(service.id)).map((v) => v.unit_symbol), ["pto", "m²"]);
});

test("listado: búsqueda literal, filtros y paginación por cursor en orden estable", { skip }, async () => {
  const search = await catalog.getServicesPage({ search: "anteproyecto" });
  assert.deepEqual(search.services.map((service) => service.code), ["ANTEPROYECTO"]);
  assert.deepEqual((await catalog.getServicesPage({ search: "llave-" })).services.map((service) => service.code), ["LLAVE-PREMIUM"]);
  // % y _ se buscan literalmente, no como comodines.
  assert.deepEqual((await catalog.getServicesPage({ search: "%" })).services, []);
  assert.deepEqual((await catalog.getServicesPage({ search: "_" })).services, []);
  assert.deepEqual((await catalog.getServicesPage({ kind: "turnkey" })).services.map((s) => s.code).sort(), ["LLAVE-PREMIUM", "PUNTOS"]);
  assert.ok((await catalog.getServicesPage({ measurementUnitId: ids.point })).services.every((s) => s.measurementUnit.id === ids.point));

  const all = await rows("select id::int, sort_order from public.services order by sort_order, id");
  const seen = [];
  let cursor;
  do {
    const page = await catalog.getServicesPage({ cursor, limit: 2 });
    assert.ok(page.services.length <= 2);
    seen.push(...page.services.map((service) => service.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(seen, all.map((row) => row.id));
});

test("integridad: cada servicio conserva exactamente una versión vigente y no se borran referencias", { skip }, async () => {
  const [summary] = await rows(`select count(*)::int services,
    count(*) filter (where (select count(*) from public.service_versions v where v.service_id = s.id and v.is_current) = 1)::int with_one_current
    from public.services s`);
  assert.equal(summary.with_one_current, summary.services);
  const { translateServiceCatalogError } = await import("../src/services/serviceCatalogErrors.js");
  await assert.rejects(rows("delete from public.services where code = 'ANTEPROYECTO'"), (error) => {
    assert.equal(error.code, "23001");
    assert.equal(translateServiceCatalogError(error).code, "SERVICE_REFERENCE_CONFLICT");
    return true;
  });
  await assert.rejects(rows("delete from public.measurement_units where id = $1", [ids.squareMeter]), { code: "23001" });
});
