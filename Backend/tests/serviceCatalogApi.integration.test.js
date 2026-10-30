import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

// Backend del catálogo de servicios contra PostgreSQL real. Opcional y aislada:
// ARCA_SERVICE_CATALOG_DB_TESTS=1 y ARCA_SERVICE_CATALOG_TEST_DATABASE_URL (solo localhost).
// Crea una base propia con el historial completo de migraciones y la elimina al terminar;
// nunca usa DATABASE_URL del proyecto. Ejecuta el servicio y el repositorio reales.
const enabled = process.env.ARCA_SERVICE_CATALOG_DB_TESTS === "1";
const skip = !enabled && "Requiere PostgreSQL local, ARCA_SERVICE_CATALOG_DB_TESTS=1 y ARCA_SERVICE_CATALOG_TEST_DATABASE_URL.";
const GENERATED_CODE = /^SERV-\d{3,}$/;

let database;
let catalog;
let db;
let ids;
// Servicios creados por las pruebas y reutilizados por las siguientes (por id: el código lo genera el sistema).
const created = {};

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
  return rows(`select version_number, code, kind, reference_rate, is_active, is_current, unit_symbol, changed_by::int, change_note
    from public.service_versions where service_id = $1 order by version_number`, [serviceId]);
}

/**
 * Código que el sistema compone para un id (SERV- y al menos tres dígitos).
 *
 * @param {number} id - Id del servicio.
 * @returns {string} Código esperado.
 */
function expectedCode(id) {
  return `SERV-${String(id).padStart(3, "0")}`;
}

/**
 * Crea un servicio mediante el servicio real con un cuerpo como el que deja serviceCreateSchema
 * (sin código). Sin `kind` el servicio aplica `individual`, como el esquema cuando se omite.
 *
 * @param {object} [overrides] - Campos del cuerpo validado que se sustituyen.
 * @param {number} [userId] - Administrador responsable.
 * @returns {Promise<object>} Servicio creado.
 */
function create(overrides = {}, userId = ids.adminA) {
  return catalog.createService({
    payload: {
      changeNote: null, description: null, isActive: true,
      measurementUnitId: ids.squareMeter, name: "Servicio", referenceRate: "14.00", sortOrder: 0, ...overrides,
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
  // m² y punto vienen del catálogo que carga el historial de migraciones; solo se añade una
  // unidad inactiva propia de la prueba.
  await rows(`insert into public.measurement_units (code, name, symbol, allows_decimals, is_active, sort_order)
    values ('legacy_unit', 'Unidad retirada', 'ret', true, false, 9999)`);
  const units = await rows("select id::int, code from public.measurement_units where code in ('square_meter', 'point', 'legacy_unit')");
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

test("alta: sin código ni tipo genera SERV- con el id, es individual y la versión 1 copia ambos", { skip }, async () => {
  const service = await create({ name: "Anteproyecto arquitectónico", changeNote: "Tabulador 3.2", sortOrder: 1 });
  created.anteproyecto = service.id;
  assert.equal(service.code, expectedCode(service.id));
  assert.equal(service.kind, "individual");
  assert.equal(service.currentVersion, 1);
  assert.equal(service.referenceRate, "14.00");
  assert.equal(service.currency, "USD");
  assert.equal(service.measurementUnit.code, "square_meter");
  assert.deepEqual(await versionsOf(service.id), [
    { change_note: "Tabulador 3.2", changed_by: ids.adminA, code: service.code, is_active: true, is_current: true, kind: "individual", reference_rate: "14.00", unit_symbol: "m²", version_number: 1 },
  ]);
});

test("llave en mano: el alta elegida por el administrador conserva el tipo, admite cualquier unidad activa y genera el código", { skip }, async () => {
  const llave = await create({ kind: "turnkey", name: "Llave premium", referenceRate: "940.00", sortOrder: 2 });
  created.llave = llave.id;
  assert.equal(llave.kind, "turnkey");
  assert.match(llave.code, GENERATED_CODE);
  assert.equal(llave.currentVersion, 1);
  assert.deepEqual((await versionsOf(llave.id)).map((version) => [version.version_number, version.kind]), [[1, "turnkey"]]);
  // La modalidad no restringe la unidad: llave en mano también se crea con puntos.
  const porPunto = await create({ kind: "turnkey", name: "Llave por punto", measurementUnitId: ids.point });
  created.llavePunto = porPunto.id;
  assert.equal(porPunto.kind, "turnkey");
  assert.equal(porPunto.measurementUnit.id, ids.point);
  // Una unidad inactiva sigue rechazándose en cualquier modalidad.
  await assert.rejects(create({ kind: "turnkey", name: "Llave retirada", measurementUnitId: ids.legacy }),
    (error) => error.code === "VALIDATION_ERROR" && error.fields.measurementUnitId === "La unidad de medida está inactiva.");
});

test("concurrencia: veinte altas simultáneas reciben códigos únicos y permanentes con su versión 1", { skip }, async () => {
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => create(
    { name: `Simultáneo ${index}`, referenceRate: `${index}.50` },
    index % 2 ? ids.adminB : ids.adminA,
  )));
  const codes = results.map((service) => service.code);
  assert.equal(new Set(codes).size, 20, "Sin códigos repetidos");
  assert.ok(results.every((service) => service.code === expectedCode(service.id)), "Cada código deriva de su propio id");
  const versions = await rows(`select v.code, s.code as service_code from public.service_versions v
    join public.services s on s.id = v.service_id where v.service_id = any($1::bigint[])`, [results.map((service) => service.id)]);
  assert.equal(versions.length, 20);
  assert.ok(versions.every((version) => version.code === version.service_code));
});

test("códigos: un fallo no reutiliza el id y un código heredado igual al generado se salta", { skip }, async () => {
  // Una alta fallida consume un id de la secuencia: el siguiente servicio no lo reutiliza.
  const [{ next: beforeFailure }] = await rows("select last_value + 1 as next from public.services_id_seq");
  await assert.rejects(create({ measurementUnitId: 999999 }), { code: "VALIDATION_ERROR" });
  const afterFailure = await create({ name: "Tras un fallo" });
  assert.ok(afterFailure.id >= Number(beforeFailure), "La numeración no retrocede");

  // Un servicio heredado (escrito a mano cuando la API aceptaba códigos) con el código que
  // correspondería al próximo id: el sistema reserva el siguiente y no lo toca.
  const [{ last }] = await rows("select last_value::int as last from public.services_id_seq");
  const legacyCode = expectedCode(last + 2);
  const [legacy] = await rows(`insert into public.services (code, name, kind, measurement_unit_id, reference_rate, created_by, updated_by)
    values ($1, 'Servicio heredado', 'individual', $2, 5, $3, $3) returning id::int`, [legacyCode, ids.squareMeter, ids.adminA]);
  const { insertServiceVersionSnapshot } = await import("../src/repositories/serviceCatalogRepository.js");
  await insertServiceVersionSnapshot(database.client, { changeNote: null, serviceId: legacy.id, userId: ids.adminA, versionNumber: 1 });
  const next = await create({ name: "Después del heredado" });
  assert.notEqual(next.code, legacyCode);
  assert.equal(next.code, expectedCode(next.id));
  assert.equal((await rows("select count(*)::int total from public.services where code = $1", [legacyCode]))[0].total, 1);
  assert.equal((await rows("select name from public.services where id = $1", [legacy.id]))[0].name, "Servicio heredado");
});

test("alta: unidad inexistente o inactiva no deja registros", { skip }, async () => {
  const before = (await rows("select count(*)::int total from public.services"))[0].total;
  const cases = [
    [{ measurementUnitId: 999999 }, "La unidad de medida no existe."],
    [{ measurementUnitId: ids.legacy }, "La unidad de medida está inactiva."],
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

test("edición: sin cambios no crea versión; un cambio de tarifa crea la versión 2 y conserva el código", { skip }, async () => {
  const id = created.anteproyecto;
  const original = await catalog.getService(id);
  const unchanged = await catalog.updateService({
    payload: { expectedVersion: 1, name: "Anteproyecto arquitectónico", referenceRate: "14.00", changeNote: "Sin cambios" },
    serviceId: id, user: { id: ids.adminB },
  });
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.service.currentVersion, 1);
  assert.equal((await versionsOf(id)).length, 1);

  const updated = await catalog.updateService({
    payload: { expectedVersion: 1, name: "Anteproyecto renombrado", referenceRate: "15.50", changeNote: "Ajuste 2026" }, serviceId: id, user: { id: ids.adminB },
  });
  assert.equal(updated.changed, true);
  // Con una sola unidad, su tarifa es la del servicio: la unidad también se versiona.
  assert.deepEqual(updated.changedFields.sort(), ["name", "referenceRate"]);
  assert.equal(updated.service.code, original.code, "La edición conserva el código");
  assert.equal(updated.service.currentVersion, 2);
  assert.deepEqual((await versionsOf(id)).map((v) => [v.version_number, v.code, v.reference_rate, v.is_current, v.changed_by]), [
    [1, original.code, "14.00", false, ids.adminA],
    [2, original.code, "15.50", true, ids.adminB],
  ]);
  const [{ updated_by: updatedBy }] = await rows("select updated_by::int from public.services where id = $1", [id]);
  assert.equal(updatedBy, ids.adminB);
});

test("estado: desactivar y activar crean versiones, conservan el código y el inactivo sigue consultable", { skip }, async () => {
  const id = created.anteproyecto;
  const { code } = await catalog.getService(id);
  const off = await catalog.changeServiceStatus({ payload: { expectedVersion: 2, isActive: false, changeNote: null }, serviceId: id, user: { id: ids.adminA } });
  assert.equal(off.service.isActive, false);
  assert.equal(off.service.currentVersion, 3);
  assert.equal(off.service.code, code, "Desactivar no libera ni cambia el código");
  const inactive = await catalog.getServicesPage({ status: "inactive" });
  assert.deepEqual(inactive.services.map((service) => service.id), [id]);
  const repeated = await catalog.changeServiceStatus({ payload: { expectedVersion: 3, isActive: false, changeNote: null }, serviceId: id, user: { id: ids.adminA } });
  assert.equal(repeated.changed, false);
  const on = await catalog.changeServiceStatus({ payload: { expectedVersion: 3, isActive: true, changeNote: null }, serviceId: id, user: { id: ids.adminA } });
  assert.equal(on.service.currentVersion, 4);
  assert.equal(on.service.code, code);
  assert.deepEqual((await versionsOf(id)).map((v) => [v.version_number, v.is_active, v.is_current, v.code]), [
    [1, true, false, code], [2, true, false, code], [3, false, false, code], [4, true, true, code],
  ]);
});

test("concurrencia: versión esperada desactualizada y dos administradores simultáneos", { skip }, async () => {
  const id = created.anteproyecto;
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
  const id = created.anteproyecto;
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

test("edición: unidad inactiva se rechaza; cambiar a llave en mano conserva la unidad y el tipo existente se conserva", { skip }, async () => {
  const service = await create({ name: "Puntos eléctricos", measurementUnitId: ids.point, referenceRate: "47.00", sortOrder: 3 });
  created.puntos = service.id;
  await assert.rejects(
    catalog.updateService({ payload: { expectedVersion: 1, measurementUnitId: ids.legacy }, serviceId: service.id, user: { id: ids.adminA } }),
    (error) => error.code === "VALIDATION_ERROR" && error.fields.measurementUnitId === "La unidad de medida está inactiva.",
  );
  // Cambiar solo la modalidad conserva la unidad de puntos: la modalidad no la restringe.
  const turnkey = await catalog.updateService({ payload: { expectedVersion: 1, kind: "turnkey" }, serviceId: service.id, user: { id: ids.adminA } });
  assert.deepEqual(turnkey.changedFields, ["kind"]);
  assert.equal(turnkey.service.measurementUnit.id, ids.point);
  const moved = await catalog.updateService({
    payload: { expectedVersion: 2, measurementUnitId: ids.squareMeter }, serviceId: service.id, user: { id: ids.adminA },
  });
  assert.deepEqual(moved.changedFields, ["measurementUnitId"]);
  assert.equal(moved.service.code, service.code);
  assert.deepEqual((await versionsOf(service.id)).map((v) => v.unit_symbol), ["pt.", "pt.", "m²"]);
  // Editar otro campo de un servicio llave en mano no cambia su tipo.
  const llave = await catalog.getService(created.llave);
  const renamed = await catalog.updateService({ payload: { expectedVersion: llave.currentVersion, name: "Llave premium 2026" }, serviceId: llave.id, user: { id: ids.adminA } });
  assert.equal(renamed.service.kind, "turnkey");
});

test("listado: búsqueda literal por nombre o código generado, filtros y paginación por cursor", { skip }, async () => {
  const anteproyecto = await catalog.getService(created.anteproyecto);
  assert.deepEqual((await catalog.getServicesPage({ search: "anteproyecto" })).services.map((service) => service.id), [created.anteproyecto]);
  assert.deepEqual((await catalog.getServicesPage({ search: anteproyecto.code })).services.map((service) => service.id), [created.anteproyecto]);
  // % y _ se buscan literalmente, no como comodines.
  assert.deepEqual((await catalog.getServicesPage({ search: "%" })).services, []);
  assert.deepEqual((await catalog.getServicesPage({ search: "_" })).services, []);
  assert.deepEqual((await catalog.getServicesPage({ kind: "turnkey" })).services.map((s) => s.id).sort((a, b) => a - b), [created.llave, created.llavePunto, created.puntos].sort((a, b) => a - b));
  assert.ok((await catalog.getServicesPage({ measurementUnitId: ids.point })).services.every((s) => s.measurementUnit.id === ids.point));

  const all = await rows("select id::int, sort_order from public.services order by sort_order, id");
  const seen = [];
  let cursor;
  do {
    const page = await catalog.getServicesPage({ cursor, limit: 7 });
    assert.ok(page.services.length <= 7);
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
  await assert.rejects(rows("delete from public.services where id = $1", [created.anteproyecto]), (error) => {
    assert.equal(error.code, "23001");
    assert.equal(translateServiceCatalogError(error).code, "SERVICE_REFERENCE_CONFLICT");
    return true;
  });
  await assert.rejects(rows("delete from public.measurement_units where id = $1", [ids.squareMeter]), { code: "23001" });
});
