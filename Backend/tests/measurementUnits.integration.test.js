import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, test } from "node:test";

import pg from "pg";

import { createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

// Unidades base y denominaciones contra PostgreSQL real. Opcional y aislada:
// ARCA_SERVICE_CATALOG_DB_TESTS=1 y ARCA_SERVICE_CATALOG_TEST_DATABASE_URL (solo localhost).
// Crea una base propia, aplica el historial completo de migraciones y la carga inicial de
// unidades, y la elimina al terminar; nunca usa DATABASE_URL del proyecto.
// ARCA_SERVICE_CATALOG_TEST_CREATE_ROLES=1 comprueba además el REVOKE de la tabla nueva.
const enabled = process.env.ARCA_SERVICE_CATALOG_DB_TESTS === "1";
const createApiRoles = process.env.ARCA_SERVICE_CATALOG_TEST_CREATE_ROLES === "1";
const skip = !enabled && "Requiere PostgreSQL local, ARCA_SERVICE_CATALOG_DB_TESTS=1 y ARCA_SERVICE_CATALOG_TEST_DATABASE_URL.";
const SEED = new URL("../prisma/seeds/measurement_units.sql", import.meta.url);

let database;
let db;
let units;
let catalog;
let ids;
// Servicios que reutilizan pruebas posteriores, por id: el código lo genera el sistema
// (`SERV-001`), así que el `code` que reciben estos helpers no identifica la fila.
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
 * Crea una denominación con el servicio real como el administrador A.
 *
 * @param {string} code - Código estable de la unidad base.
 * @param {string} denomination - Texto ya normalizado (como lo entrega Zod).
 * @returns {Promise<object>} Denominación creada.
 */
function createDenomination(code, denomination) {
  return units.createDenomination({ payload: { denomination, measurementUnitId: ids.units[code] }, user: { id: ids.admin } });
}

/**
 * Crea un servicio con valores por defecto válidos mediante el servicio real del catálogo.
 *
 * @param {object} overrides - Campos del cuerpo validado que se sustituyen.
 * @returns {Promise<object>} Servicio creado.
 */
function createService(overrides) {
  return catalog.createService({
    payload: {
      changeNote: null, description: null, isActive: true, kind: "individual", measurementUnitId: ids.units.square_meter,
      name: "Servicio", referenceRate: "12.00", sortOrder: 0, unitDenominationId: null, ...overrides,
    },
    user: { id: ids.admin },
  });
}

/**
 * Devuelve las versiones de un servicio con los datos de unidad y denominación copiados.
 *
 * @param {number} serviceId - Servicio consultado.
 * @returns {Promise<Array<object>>} Versiones en orden.
 */
function versionsOf(serviceId) {
  return rows(`select version_number, unit_symbol, unit_denomination_id::int, unit_denomination, is_current
    from public.service_versions where service_id = $1 order by version_number`, [serviceId]);
}

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({
    baseUrl: process.env.ARCA_SERVICE_CATALOG_TEST_DATABASE_URL,
    createApiRoles,
    prefix: "arca_measurement_units",
  });
  await database.client.query(await readFile(SEED, "utf8"));
  const [role] = await rows("insert into public.roles (code, name) values ('admin', 'Administrador') returning id");
  const [admin] = await rows(`insert into public.users (role_id, email, first_name, last_name, password_hash)
    values ($1, 'unidades@arca.test', 'Admin', 'Unidades', '!integration-login-disabled!') returning id::int`, [role.id]);
  const unitRows = await rows("select id::int, code from public.measurement_units");
  ids = { admin: admin.id, units: Object.fromEntries(unitRows.map((unit) => [unit.code, unit.id])) };

  Object.assign(process.env, { DATABASE_POOL_MAX: "6", DATABASE_URL: database.databaseUrl, NODE_ENV: "test" });
  db = await import("../src/config/db.js");
  units = await import("../src/services/measurementUnitService.js");
  catalog = await import("../src/services/serviceCatalogService.js");
});

after(async () => {
  await db?.pool.end().catch(() => {});
  if (database) await database.drop();
});

test("carga inicial: 48 unidades base idempotentes que no sobrescriben cambios administrativos", { skip }, async () => {
  const snapshot = () => rows("select id, code, name, symbol, allows_decimals, is_active, sort_order from public.measurement_units order by id");
  const firstLoad = await snapshot();
  assert.equal(firstLoad.length, 48);
  // Metro y metro lineal, y pieza y unidad, son filas distintas con símbolos propios.
  const pairs = await rows("select code, symbol, allows_decimals from public.measurement_units where code in ('meter', 'linear_meter', 'piece', 'unit') order by code");
  assert.deepEqual(pairs, [
    { allows_decimals: true, code: "linear_meter", symbol: "m.l." },
    { allows_decimals: true, code: "meter", symbol: "m" },
    { allows_decimals: false, code: "piece", symbol: "pza." },
    { allows_decimals: false, code: "unit", symbol: "und." },
  ]);
  const loaded = await rows("select code, symbol, allows_decimals from public.measurement_units order by sort_order");
  assert.deepEqual(loaded[0], { allows_decimals: true, code: "square_meter", symbol: "m²" });
  // Las 11 unidades originales conservan su símbolo.
  const symbols = Object.fromEntries(loaded.map((unit) => [unit.code, unit.symbol]));
  assert.deepEqual(
    ["square_meter", "linear_meter", "point", "unit", "project", "space", "hour", "minute", "week", "month", "global"].map((code) => symbols[code]),
    ["m²", "m.l.", "pt.", "und.", "proy.", "esp.", "hrs", "min", "sem.", "mes", "glb."],
  );
  // Segunda ejecución: no duplica ni modifica nada.
  await database.client.query(await readFile(SEED, "utf8"));
  assert.deepEqual(await snapshot(), firstLoad);
  // Un cambio administrativo posterior (estado y orden) sobrevive a una nueva ejecución.
  await rows("update public.measurement_units set is_active = false, sort_order = 999 where code = 'year'");
  await database.client.query(await readFile(SEED, "utf8"));
  const [year] = await rows("select is_active, sort_order from public.measurement_units where code = 'year'");
  assert.deepEqual(year, { is_active: false, sort_order: 999 });
  await rows("update public.measurement_units set is_active = true, sort_order = 606 where code = 'year'");
  assert.equal((await snapshot()).length, 48);
  const insertUnit = (code, name, symbol) => rows("insert into public.measurement_units (code, name, symbol) values ($1, $2, $3)", [code, name, symbol]);
  await assert.rejects(insertUnit("square_meter_2", "Metro cuadrado bis", "m2"), { code: "23505", constraint: "uq_measurement_units_symbol_key" });
  await assert.rejects(insertUnit("point_2", "Punto bis", "PT."), { code: "23505", constraint: "uq_measurement_units_symbol_key" });
  // Nombres equivalentes (mayúsculas o espacios exteriores) se rechazan por el índice de nombres.
  await assert.rejects(insertUnit("hour_2", " hora", "h"), { code: "23505", constraint: "uq_measurement_units_name_key" });
  await assert.rejects(insertUnit("hour_3", "HORA", "h"), { code: "23505", constraint: "uq_measurement_units_name_key" });
  await assert.rejects(insertUnit("long_unit", "Unidad larga", "abcdefghijk"), { code: "23514" });
  await assert.rejects(insertUnit("spaced_unit", "Unidad espaciada", " u."), { code: "23514" });
});

test("migración: RLS en denominaciones y sin privilegios peligrosos para los roles de la API", { skip }, async () => {
  const [table] = await rows("select relrowsecurity from pg_class where oid = 'public.measurement_unit_denominations'::regclass");
  assert.equal(table.relrowsecurity, true);
  if (!createApiRoles) return;
  const grants = await rows(`select a.privilege_type from pg_class c cross join lateral aclexplode(c.relacl) a
    where c.oid = 'public.measurement_unit_denominations'::regclass and a.grantee <> 0
      and a.grantee::regrole::text in ('anon', 'authenticated', 'service_role')
      and a.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')`);
  assert.deepEqual(grants, []);
  const [execute] = await rows("select has_function_privilege('anon', 'public.prevent_denomination_unit_change()', 'EXECUTE') as allowed");
  assert.equal(execute.allowed, false);
});

test("unidades base: solo activas por defecto e inactivas bajo petición explícita", { skip }, async () => {
  await rows("update public.measurement_units set is_active = false where code = 'minute'");
  const active = await units.getMeasurementUnits({});
  assert.ok(!active.measurementUnits.some((unit) => unit.code === "minute"));
  assert.equal(active.measurementUnits.length, 47);
  const all = await units.getMeasurementUnits({ includeInactive: true });
  assert.equal(all.measurementUnits.length, 48);
  assert.deepEqual(all.measurementUnits[0], { allowsDecimals: true, code: "square_meter", id: ids.units.square_meter, isActive: true, name: "Metro cuadrado", sortOrder: 101, symbol: "m²" });
  // El Dropdown recibe las 48 opciones en el orden de presentación por categorías.
  assert.deepEqual(all.measurementUnits.map((unit) => unit.symbol), [
    "m²", "cm²", "pie²", "ha", "km²",
    "m.l.", "m", "mm", "cm", "km", "pulg.", "pie",
    "m³", "cm³", "L", "gal",
    "kg", "g", "t",
    "und.", "pza.", "pt.", "jgo.", "par", "paq.", "caja", "saco", "rollo", "lote",
    "hrs", "min", "día", "sem.", "mes", "año",
    "h-h", "d-h",
    "proy.", "esp.", "vis.", "inf.", "plano", "render", "glb.",
    "kWh", "kW", "kVA", "TR",
  ]);
  const sortOrders = all.measurementUnits.map((unit) => unit.sortOrder);
  assert.deepEqual(sortOrders, [...sortOrders].sort((a, b) => a - b));
});

test("tabulador 3.2: las unidades de sus 19 servicios existen y llave en mano sigue aceptando m²", { skip }, async () => {
  const tabulatorCodes = ["square_meter", "linear_meter", "point", "project", "space", "month"];
  const available = await rows("select code, is_active from public.measurement_units where code = any($1)", [tabulatorCodes]);
  assert.deepEqual(available.map((unit) => unit.code).sort(), [...tabulatorCodes].sort());
  assert.ok(available.every((unit) => unit.is_active));
  const turnkey = await createService({ code: "LLAVE-TABULADOR", kind: "turnkey", referenceRate: "850.00" });
  assert.equal(turnkey.measurementUnit.code, "square_meter");
  await assert.rejects(createService({ code: "LLAVE-HECTAREA", kind: "turnkey", measurementUnitId: ids.units.hectare }),
    (error) => error.code === "VALIDATION_ERROR" && /llave en mano/.test(error.fields.measurementUnitId));
});

test("denominaciones: creación, etiqueta, duplicados equivalentes y unidades base no válidas", { skip }, async () => {
  const created = await createDenomination("square_meter", "de construcción");
  assert.equal(created.label, "m² de construcción");
  assert.equal(created.activeServiceCount, 0);
  assert.equal(created.measurementUnit.code, "square_meter");
  for (const equivalent of ["De Construcción", "DE CONSTRUCCIÓN", "ｄｅ construcción"]) {
    await assert.rejects(createDenomination("square_meter", equivalent), { code: "MEASUREMENT_UNIT_DENOMINATION_ALREADY_EXISTS", status: 409 }, equivalent);
  }
  // El mismo texto en otra unidad base es otra denominación.
  assert.equal((await createDenomination("linear_meter", "de construcción")).label, "m.l. de construcción");
  for (const [text, code] of [["de recorrido comercial", "square_meter"], ["de canalización", "linear_meter"], ["eléctrico", "point"], ["de supervisión", "hour"]]) {
    await createDenomination(code, text);
  }
  await assert.rejects(createDenomination("minute", "de llamada"), (error) => error.code === "VALIDATION_ERROR" && error.fields.measurementUnitId === "La unidad de medida está inactiva.");
  await assert.rejects(units.createDenomination({ payload: { denomination: "x", measurementUnitId: 999999 }, user: { id: ids.admin } }),
    (error) => error.code === "VALIDATION_ERROR" && error.fields.measurementUnitId === "La unidad de medida no existe.");
  const results = await Promise.allSettled([createDenomination("space", "de exhibición"), createDenomination("space", "De exhibición")]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "MEASUREMENT_UNIT_DENOMINATION_ALREADY_EXISTS");
});

test("denominaciones: edición y activación con cambios efectivos y sin cambios", { skip }, async () => {
  const target = await createDenomination("week", "de diseño");
  assert.equal((await units.updateDenomination({ denominationId: target.id, payload: { denomination: "de diseño" }, user: { id: ids.admin } })).changed, false);
  const edited = await units.updateDenomination({ denominationId: target.id, payload: { denomination: "de diseño integral" }, user: { id: ids.admin } });
  assert.deepEqual([edited.changed, edited.unitDenomination.label], [true, "sem. de diseño integral"]);
  await createDenomination("week", "de obra");
  await assert.rejects(units.updateDenomination({ denominationId: target.id, payload: { denomination: "De Obra" }, user: { id: ids.admin } }), { code: "MEASUREMENT_UNIT_DENOMINATION_ALREADY_EXISTS" });
  const off = await units.changeDenominationStatus({ denominationId: target.id, payload: { isActive: false }, user: { id: ids.admin } });
  assert.deepEqual([off.changed, off.unitDenomination.isActive], [true, false]);
  assert.equal((await units.changeDenominationStatus({ denominationId: target.id, payload: { isActive: false }, user: { id: ids.admin } })).changed, false);
  assert.equal((await units.changeDenominationStatus({ denominationId: target.id, payload: { isActive: true }, user: { id: ids.admin } })).unitDenomination.isActive, true);
});

test("servicios: denominación de la misma base, llave en mano por m² y copia histórica en versiones", { skip }, async () => {
  const [construction] = (await units.getDenominationsPage({ measurementUnitId: ids.units.square_meter, search: "construcción" })).unitDenominations;
  const [canalization] = (await units.getDenominationsPage({ search: "canalización" })).unitDenominations;
  const turnkey = await createService({ code: "LLAVE-PREMIUM", kind: "turnkey", referenceRate: "900.00", unitDenominationId: construction.id });
  created.llavePremium = turnkey.id;
  assert.deepEqual(turnkey.unitDenomination, { denomination: "de construcción", id: construction.id, isActive: true });
  assert.equal(turnkey.unitLabel, "m² de construcción");
  assert.deepEqual(await versionsOf(turnkey.id), [{ is_current: true, unit_denomination: "de construcción", unit_denomination_id: construction.id, unit_symbol: "m²", version_number: 1 }]);
  // La denominación de otra base se rechaza en el servicio y, como última barrera, en PostgreSQL.
  await assert.rejects(createService({ code: "MEZCLA", unitDenominationId: canalization.id }),
    (error) => error.code === "VALIDATION_ERROR" && /no pertenece/.test(error.fields.unitDenominationId));
  await assert.rejects(rows("update public.services set unit_denomination_id = $1 where id = $2", [canalization.id, turnkey.id]),
    { code: "23503", constraint: "fk_services_unit_denomination" });
  // La regla llave en mano depende del código de la base, no de la denominación.
  await assert.rejects(createService({ code: "LLAVE-ML", kind: "turnkey", measurementUnitId: ids.units.linear_meter, unitDenominationId: canalization.id }),
    (error) => error.code === "VALIDATION_ERROR" && /llave en mano/.test(error.fields.measurementUnitId));
  const [inactive] = (await units.getDenominationsPage({ search: "integral" })).unitDenominations;
  await units.changeDenominationStatus({ denominationId: inactive.id, payload: { isActive: false }, user: { id: ids.admin } });
  await assert.rejects(createService({ code: "SEMANAL", measurementUnitId: ids.units.week, unitDenominationId: inactive.id }),
    (error) => error.code === "VALIDATION_ERROR" && error.fields.unitDenominationId === "La denominación está inactiva.");
});

test("versionado: cambiar o retirar la denominación crea versiones y exige coherencia al cambiar de base", { skip }, async () => {
  const id = created.llavePremium;
  const [commercial] = (await units.getDenominationsPage({ search: "recorrido" })).unitDenominations;
  const moved = await catalog.updateService({ payload: { expectedVersion: 1, unitDenominationId: commercial.id }, serviceId: id, user: { id: ids.admin } });
  assert.deepEqual([moved.changedFields, moved.service.unitLabel, moved.service.currentVersion], [["unitDenominationId"], "m² de recorrido comercial", 2]);
  const cleared = await catalog.updateService({ payload: { expectedVersion: 2, unitDenominationId: null }, serviceId: id, user: { id: ids.admin } });
  assert.deepEqual([cleared.service.unitLabel, cleared.service.unitDenomination], ["m²", null]);
  assert.deepEqual((await versionsOf(id)).map((v) => [v.version_number, v.unit_denomination]), [[1, "de construcción"], [2, "de recorrido comercial"], [3, null]]);

  const [electric] = (await units.getDenominationsPage({ search: "eléctrico" })).unitDenominations;
  const points = await createService({ code: "PUNTOS", measurementUnitId: ids.units.point, referenceRate: "45.00", unitDenominationId: electric.id });
  await assert.rejects(
    catalog.updateService({ payload: { expectedVersion: 1, measurementUnitId: ids.units.unit }, serviceId: points.id, user: { id: ids.admin } }),
    (error) => error.code === "VALIDATION_ERROR" && /otra unidad/.test(error.fields.unitDenominationId),
  );
  const rebased = await catalog.updateService({ payload: { expectedVersion: 1, measurementUnitId: ids.units.unit, unitDenominationId: null }, serviceId: points.id, user: { id: ids.admin } });
  assert.equal(rebased.service.unitLabel, "und.");
  assert.equal((await catalog.getServicesPage({ unitDenominationId: electric.id })).services.length, 0);
});

test("protección: una denominación usada por servicios activos no se edita ni se desactiva", { skip }, async () => {
  const [supervision] = (await units.getDenominationsPage({ search: "supervisión" })).unitDenominations;
  const service = await createService({ code: "SUPERVISION", measurementUnitId: ids.units.hour, referenceRate: "35.00", unitDenominationId: supervision.id });
  assert.equal((await units.getDenomination(supervision.id)).activeServiceCount, 1);
  for (const change of [
    () => units.updateDenomination({ denominationId: supervision.id, payload: { denomination: "de inspección" }, user: { id: ids.admin } }),
    () => units.changeDenominationStatus({ denominationId: supervision.id, payload: { isActive: false }, user: { id: ids.admin } }),
  ]) {
    await assert.rejects(change(), { code: "MEASUREMENT_UNIT_IN_USE", status: 409 });
  }
  // Con el servicio inactivo se puede editar; la versión guardada conserva el texto histórico.
  await catalog.changeServiceStatus({ payload: { changeNote: null, expectedVersion: 1, isActive: false }, serviceId: service.id, user: { id: ids.admin } });
  const edited = await units.updateDenomination({ denominationId: supervision.id, payload: { denomination: "de inspección" }, user: { id: ids.admin } });
  assert.equal(edited.unitDenomination.label, "hrs de inspección");
  assert.deepEqual((await versionsOf(service.id)).map((v) => v.unit_denomination), ["de supervisión", "de supervisión"]);
  assert.equal((await catalog.getService(service.id)).unitLabel, "hrs de inspección");
});

test("concurrencia: desactivar y asignar a la vez nunca deja un servicio activo con una denominación inactiva", { skip }, async () => {
  for (let round = 0; round < 6; round += 1) {
    const target = await createDenomination("project", `de concurso ${round}`);
    const [deactivation, assignment] = await Promise.allSettled([
      units.changeDenominationStatus({ denominationId: target.id, payload: { isActive: false }, user: { id: ids.admin } }),
      createService({ code: `CONCURSO-${round}`, measurementUnitId: ids.units.project, referenceRate: "100.00", unitDenominationId: target.id }),
    ]);
    const outcome = [deactivation.status, assignment.status].join("/");
    if (outcome === "fulfilled/rejected") assert.equal(assignment.reason.fields.unitDenominationId, "La denominación está inactiva.");
    else if (outcome === "rejected/fulfilled") assert.equal(deactivation.reason.code, "MEASUREMENT_UNIT_IN_USE");
    else assert.fail(`Resultado inesperado ${outcome}: ${deactivation.reason?.code ?? ""} ${assignment.reason?.code ?? ""}`);
  }
  const [violations] = await rows(`select count(*)::int total from public.services s
    join public.measurement_unit_denominations d on d.id = s.unit_denomination_id where s.is_active and not d.is_active`);
  assert.equal(violations.total, 0);
});

/**
 * Crea un servicio con denominación y lo desactiva, dejándolo en la versión 2, como punto de
 * partida de las pruebas de reactivación.
 *
 * @param {string} code - Código del servicio.
 * @param {string} unitCode - Código estable de la unidad base.
 * @param {object} [denomination] - Denominación asignada, o ninguna.
 * @returns {Promise<object>} Servicio inactivo.
 */
async function createInactiveService(code, unitCode, denomination) {
  const service = await createService({ code, measurementUnitId: ids.units[unitCode], unitDenominationId: denomination?.id ?? null });
  return (await catalog.changeServiceStatus({ payload: { changeNote: null, expectedVersion: 1, isActive: false }, serviceId: service.id, user: { id: ids.admin } })).service;
}

/**
 * Reactiva un servicio con la ruta de estado del servicio real.
 *
 * @param {object} service - Servicio con su versión vigente.
 * @returns {Promise<object>} Resultado de la edición.
 */
function reactivate(service) {
  return catalog.changeServiceStatus({ payload: { changeNote: null, expectedVersion: service.currentVersion, isActive: true }, serviceId: service.id, user: { id: ids.admin } });
}

test("reactivación (M-1): con unidad y denominación activas se reactiva y crea una versión", { skip }, async () => {
  const denomination = await createDenomination("drawing", "de detalle");
  const service = await createInactiveService("REACT-OK", "drawing", denomination);
  const result = await reactivate(service);
  assert.equal(result.changed, true);
  assert.equal(result.service.isActive, true);
  assert.equal(result.service.unitLabel, "plano de detalle");
  assert.deepEqual((await versionsOf(service.id)).map((v) => [v.version_number, v.unit_denomination, v.is_current]),
    [[1, "de detalle", false], [2, "de detalle", false], [3, "de detalle", true]]);
  // Sin denominación también se reactiva.
  const plain = await createInactiveService("REACT-OK-BASE", "drawing");
  assert.equal((await reactivate(plain)).service.isActive, true);
});

test("reactivación (M-1): una denominación inactiva impide reactivar sin modificar el servicio ni versionar", { skip }, async () => {
  const denomination = await createDenomination("drawing", "de fachada");
  const service = await createInactiveService("REACT-DEN-OFF", "drawing", denomination);
  // Sin servicios activos la denominación se puede desactivar: es el escenario del hallazgo.
  await units.changeDenominationStatus({ denominationId: denomination.id, payload: { isActive: false }, user: { id: ids.admin } });
  const before = await versionsOf(service.id);
  await assert.rejects(reactivate(service), (error) => error.code === "VALIDATION_ERROR" && error.fields.unitDenominationId === "La denominación está inactiva.");
  // La edición general con isActive también pasa por la misma regla.
  await assert.rejects(catalog.updateService({ payload: { expectedVersion: 2, isActive: true, referenceRate: "99.00" }, serviceId: service.id, user: { id: ids.admin } }),
    (error) => error.fields?.unitDenominationId === "La denominación está inactiva.");
  const after = await catalog.getService(service.id);
  assert.equal(after.isActive, false);
  assert.equal(after.referenceRate, "12.00");
  assert.equal(after.currentVersion, 2);
  assert.deepEqual(await versionsOf(service.id), before);
  // Una versión esperada obsoleta sigue respondiendo primero 409, sin consultar la denominación.
  await assert.rejects(catalog.changeServiceStatus({ payload: { changeNote: null, expectedVersion: 1, isActive: true }, serviceId: service.id, user: { id: ids.admin } }), { code: "SERVICE_VERSION_CONFLICT" });
  // Reactivada la denominación, el servicio vuelve a poder reactivarse con la versión 3.
  await units.changeDenominationStatus({ denominationId: denomination.id, payload: { isActive: true }, user: { id: ids.admin } });
  assert.equal((await reactivate(after)).service.currentVersion, 3);
  // Desactivar un servicio no exige que su denominación esté activa.
  const other = await createInactiveService("REACT-DEN-OFF-2", "drawing", await createDenomination("drawing", "de corte"));
  assert.equal(other.isActive, false);
});

test("reactivación (M-1): una unidad base inactiva impide reactivar, con y sin denominación", { skip }, async () => {
  const denomination = await createDenomination("report", "de avance");
  const withDenomination = await createInactiveService("REACT-UNIT-OFF", "report", denomination);
  const withoutDenomination = await createInactiveService("REACT-UNIT-OFF-2", "report");
  await rows("update public.measurement_units set is_active = false where code = 'report'");
  try {
    for (const service of [withDenomination, withoutDenomination]) {
      await assert.rejects(reactivate(service), (error) => error.fields?.measurementUnitId === "La unidad de medida está inactiva.");
      const current = await catalog.getService(service.id);
      assert.equal(current.isActive, false);
      assert.equal(current.currentVersion, 2);
      assert.equal((await versionsOf(service.id)).length, 2);
    }
  } finally {
    await rows("update public.measurement_units set is_active = true where code = 'report'");
  }
  assert.equal((await reactivate(withDenomination)).service.isActive, true);
});

test("reactivación (M-1): reactivar y desactivar la denominación a la vez nunca deja un servicio activo con ella inactiva", { skip }, async () => {
  for (let round = 0; round < 8; round += 1) {
    const target = await createDenomination("render", `de carrera ${round}`);
    const service = await createInactiveService(`REACT-RACE-${round}`, "render", target);
    const [deactivation, reactivation] = await Promise.allSettled([
      units.changeDenominationStatus({ denominationId: target.id, payload: { isActive: false }, user: { id: ids.admin } }),
      reactivate(service),
    ]);
    const outcome = [deactivation.status, reactivation.status].join("/");
    if (outcome === "fulfilled/rejected") assert.equal(reactivation.reason.fields.unitDenominationId, "La denominación está inactiva.");
    else if (outcome === "rejected/fulfilled") assert.equal(deactivation.reason.code, "MEASUREMENT_UNIT_IN_USE");
    else assert.fail(`Resultado inesperado ${outcome}: ${deactivation.reason?.code ?? ""} ${reactivation.reason?.code ?? ""}`);
    const versions = await versionsOf(service.id);
    assert.equal(versions.length, reactivation.status === "fulfilled" ? 3 : 2);
  }
  const [violations] = await rows(`select count(*)::int total from public.services s
    join public.measurement_unit_denominations d on d.id = s.unit_denomination_id where s.is_active and not d.is_active`);
  assert.equal(violations.total, 0);
});

/**
 * Cambia la unidad base de una denominación (conservando su texto) con el servicio real.
 *
 * @param {object} denomination - Denominación leída.
 * @param {string} unitCode - Código estable de la nueva unidad base.
 * @returns {Promise<{ unitDenomination: object, changed: boolean }>} Resultado de la edición.
 */
function changeBase(denomination, unitCode) {
  return units.updateDenomination({
    denominationId: denomination.id,
    payload: { denomination: denomination.denomination, measurementUnitId: ids.units[unitCode] ?? unitCode },
    user: { id: ids.admin },
  });
}

/**
 * Abre una conexión propia a la base aislada para sostener una transacción concurrente.
 *
 * @returns {Promise<import("pg").Client>} Cliente conectado; quien lo abre debe cerrarlo.
 */
async function openClient() {
  const client = new pg.Client({ connectionString: database.databaseUrl, ssl: false });
  await client.connect();
  return client;
}

/**
 * Convierte una promesa en su resultado de allSettled sin dejar rechazos sin manejar mientras
 * la prueba confirma la transacción que la mantiene en espera.
 *
 * @param {Promise<unknown>} promise - Operación concurrente.
 * @returns {Promise<PromiseSettledResult<unknown>>} Resultado.
 */
function settle(promise) {
  return promise.then((value) => ({ status: "fulfilled", value }), (reason) => ({ status: "rejected", reason }));
}

/**
 * Espera hasta que otra sesión de la base aislada esté bloqueada esperando un lock de fila, para
 * garantizar el orden de las operaciones en las pruebas de concurrencia.
 *
 * @returns {Promise<void>}
 * @throws {Error} Si nadie espera un bloqueo en 5 segundos.
 */
async function waitForLockWait() {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const [{ waiting }] = await rows("select count(*)::int waiting from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'");
    if (waiting > 0) return;
    await delay(20);
  }
  throw new Error("Ninguna sesión llegó a esperar el bloqueo.");
}

/**
 * Inserta por SQL directo, en la transacción del cliente dado, un servicio con su versión vigente
 * que referencian la denominación, como lo haría cualquier escritor ajeno a la API.
 *
 * @param {import("pg").Client} client - Cliente con la transacción abierta.
 * @param {{ code: string, unitCode: string, denomination: object }} service - Datos del servicio.
 * @returns {Promise<void>}
 */
async function insertReferencingService(client, { code, denomination, unitCode }) {
  const inserted = await client.query(`insert into public.services
    (code, name, kind, measurement_unit_id, unit_denomination_id, reference_rate, created_by, updated_by)
    values ($1, 'Servicio SQL', 'individual', $2, $3, 5, $4, $4) returning id`, [code, ids.units[unitCode], denomination.id, ids.admin]);
  await insertVersionReference(client, { denomination, isCurrent: true, serviceId: inserted.rows[0].id, versionNumber: 1 });
}

/**
 * Inserta por SQL directo una versión que referencia la denominación copiando el servicio y su
 * unidad, en la transacción del cliente dado.
 *
 * @param {import("pg").Client} client - Cliente con la transacción abierta.
 * @param {{ denomination: object, isCurrent: boolean, serviceId: number, versionNumber: number }} version - Datos.
 * @returns {Promise<void>}
 */
async function insertVersionReference(client, { denomination, isCurrent, serviceId, versionNumber }) {
  await client.query(`insert into public.service_versions (
      service_id, version_number, code, name, description, kind, measurement_unit_id, unit_code, unit_name, unit_symbol,
      unit_allows_decimals, unit_denomination_id, unit_denomination, reference_rate, currency_code, is_active, sort_order, changed_by, is_current)
    select s.id, $2, s.code, s.name, s.description, s.kind, u.id, u.code, u.name, u.symbol, u.allows_decimals, $3, $4,
      s.reference_rate, s.currency_code, s.is_active, s.sort_order, $5, $6
    from public.services s join public.measurement_units u on u.id = s.measurement_unit_id where s.id = $1`,
  [serviceId, versionNumber, denomination.id, denomination.denomination, ids.admin, isCurrent]);
}

test("unidad base: sin referencias cambia conservando id, código público, texto y estado", { skip }, async () => {
  const target = await createDenomination("visit", "de inspección técnica");
  assert.equal(target.baseUnitEditable, true);
  const same = await changeBase(target, "visit");
  assert.equal(same.changed, false);
  const moved = await changeBase(target, "lot");
  assert.equal(moved.changed, true);
  assert.deepEqual(
    [moved.unitDenomination.id, moved.unitDenomination.publicCode, moved.unitDenomination.label, moved.unitDenomination.measurementUnit.code],
    [target.id, target.publicCode, "lote de inspección técnica", "lot"],
  );
  assert.deepEqual([moved.unitDenomination.isActive, moved.unitDenomination.baseUnitEditable], [true, true]);
  // Texto y base en la misma edición.
  const both = await units.updateDenomination({ denominationId: target.id, payload: { denomination: "de inspección final", measurementUnitId: ids.units.visit }, user: { id: ids.admin } });
  assert.equal(both.unitDenomination.label, "vis. de inspección final");
  // Una denominación inactiva también puede cambiar de base y sigue inactiva.
  await units.changeDenominationStatus({ denominationId: target.id, payload: { isActive: false }, user: { id: ids.admin } });
  const inactive = await changeBase(both.unitDenomination, "lot");
  assert.deepEqual([inactive.unitDenomination.isActive, inactive.unitDenomination.measurementUnit.code], [false, "lot"]);
  // SQL directo: sin referencias el trigger lo permite y public_code no cambia.
  await rows("update public.measurement_unit_denominations set measurement_unit_id = $1 where id = $2", [ids.units.visit, target.id]);
  const [stored] = await rows("select public_code, measurement_unit_id::int from public.measurement_unit_denominations where id = $1", [target.id]);
  assert.deepEqual(stored, { measurement_unit_id: ids.units.visit, public_code: target.publicCode });
});

test("unidad base: un servicio activo, inactivo o solo una versión histórica impiden cambiarla (409)", { skip }, async () => {
  const active = await createDenomination("box", "de embalaje");
  created.cajaActiva = (await createService({ code: "CAJA-ACTIVA", measurementUnitId: ids.units.box, unitDenominationId: active.id })).id;
  const inactive = await createDenomination("box", "de archivo");
  const inactiveService = await createInactiveService("CAJA-INACTIVA", "box", inactive);
  const historic = await createDenomination("box", "de muestras");
  const historicService = await createService({ code: "CAJA-HISTORICA", measurementUnitId: ids.units.box, unitDenominationId: historic.id });
  await catalog.updateService({ payload: { expectedVersion: 1, unitDenominationId: null }, serviceId: historicService.id, user: { id: ids.admin } });
  assert.equal((await catalog.getServicesPage({ unitDenominationId: historic.id })).services.length, 0);

  for (const [denomination, service] of [[active, null], [inactive, inactiveService], [historic, historicService]]) {
    const current = await units.getDenomination(denomination.id);
    assert.equal(current.baseUnitEditable, false, denomination.denomination);
    const versions = service ? await versionsOf(service.id) : null;
    await assert.rejects(changeBase(current, "bag"), { code: "MEASUREMENT_UNIT_BASE_IN_USE", status: 409 }, denomination.denomination);
    assert.deepEqual(await units.getDenomination(denomination.id), current);
    if (service) assert.deepEqual(await versionsOf(service.id), versions);
    // PostgreSQL impone la misma regla ante SQL directo.
    await assert.rejects(rows("update public.measurement_unit_denominations set measurement_unit_id = $1 where id = $2", [ids.units.bag, denomination.id]), { code: "55000" });
  }
  // Con servicios activos, cambiar texto y base responde primero el uso por servicios activos.
  await assert.rejects(units.updateDenomination({ denominationId: active.id, payload: { denomination: "de embalaje fino", measurementUnitId: ids.units.bag }, user: { id: ids.admin } }),
    { code: "MEASUREMENT_UNIT_IN_USE" });
  // Con un servicio inactivo el texto sí se edita, pero la base no.
  assert.equal((await units.updateDenomination({ denominationId: inactive.id, payload: { denomination: "de archivo muerto" }, user: { id: ids.admin } })).changed, true);
});

test("unidad base: la nueva base inexistente o inactiva responde 400 y un duplicado en destino 409", { skip }, async () => {
  const target = await createDenomination("bag", "de cemento");
  await assert.rejects(changeBase(target, 999999), (error) => error.code === "VALIDATION_ERROR" && error.fields.measurementUnitId === "La unidad de medida no existe.");
  await rows("update public.measurement_units set is_active = false where code = 'roll'");
  try {
    await assert.rejects(changeBase(target, "roll"), (error) => error.code === "VALIDATION_ERROR" && error.fields.measurementUnitId === "La unidad de medida está inactiva.");
  } finally {
    await rows("update public.measurement_units set is_active = true where code = 'roll'");
  }
  await createDenomination("package", "De Cemento");
  await assert.rejects(changeBase(target, "package"), { code: "MEASUREMENT_UNIT_DENOMINATION_ALREADY_EXISTS", status: 409 });
  assert.deepEqual(await units.getDenomination(target.id), target);
});

test("concurrencia (base primero): una asignación en espera falla y PostgreSQL rechaza la referencia por SQL", { skip }, async () => {
  const holder = await openClient();
  const writer = await openClient();
  try {
    for (const assignWithApi of [true, false]) {
      const target = await createDenomination("pair", assignWithApi ? "de guantes" : "de botas");
      await holder.query("begin");
      await holder.query("update public.measurement_unit_denominations set measurement_unit_id = $1 where id = $2", [ids.units.set, target.id]);
      let assignment;
      if (assignWithApi) {
        assignment = settle(createService({ code: "PAR-ESPERA", measurementUnitId: ids.units.pair, unitDenominationId: target.id }));
      } else {
        await writer.query("begin");
        assignment = settle(insertReferencingService(writer, { code: "PAR-SQL", denomination: target, unitCode: "pair" }));
      }
      await waitForLockWait();
      await holder.query("commit");
      const result = await assignment;
      assert.equal(result.status, "rejected");
      if (assignWithApi) assert.match(result.reason.fields.unitDenominationId, /no pertenece/);
      else {
        assert.deepEqual([result.reason.code, result.reason.constraint], ["23503", "fk_services_unit_denomination"]);
        await writer.query("rollback");
      }
      assert.equal((await units.getDenomination(target.id)).measurementUnit.code, "set");
    }
  } finally {
    await holder.end();
    await writer.end();
  }
});

test("concurrencia (referencia primero): un cambio de base en espera ve la referencia confirmada y falla", { skip }, async () => {
  const holder = await openClient();
  const writer = await openClient();
  try {
    const carrier = { id: created.cajaActiva };
    const scenarios = [
      ["servicio, cambio por la API", "de herrajes", true, false],
      ["servicio, UPDATE directo contra el trigger", "de bisagras", false, false],
      ["solo versión histórica, cambio por la API", "de tornillos", true, true],
      ["solo versión histórica, UPDATE directo contra el trigger", "de clavos", false, true],
    ];
    for (const [label, text, changeWithApi, versionOnly] of scenarios) {
      const target = await createDenomination("box", text);
      await holder.query("begin");
      if (versionOnly) {
        const [{ next }] = await rows("select max(version_number)::int + 1 next from public.service_versions where service_id = $1", [carrier.id]);
        await insertVersionReference(holder, { denomination: target, isCurrent: false, serviceId: carrier.id, versionNumber: next });
      } else {
        await insertReferencingService(holder, { code: `CAJA-${target.id}`, denomination: target, unitCode: "box" });
      }
      const change = changeWithApi
        ? settle(changeBase(target, "bag"))
        : settle(writer.query("update public.measurement_unit_denominations set measurement_unit_id = $1 where id = $2", [ids.units.bag, target.id]));
      await waitForLockWait();
      await holder.query("commit");
      const result = await change;
      assert.equal(result.status, "rejected", label);
      assert.equal(result.reason.code, changeWithApi ? "MEASUREMENT_UNIT_BASE_IN_USE" : "55000", label);
      assert.equal((await units.getDenomination(target.id)).measurementUnit.code, "box", label);
    }
  } finally {
    await holder.end();
    await writer.end();
  }
});

test("concurrencia: cambiar la base y asignar a la vez nunca deja referencias de otra base", { skip }, async () => {
  for (let round = 0; round < 6; round += 1) {
    const target = await createDenomination("package", `de carrera de base ${round}`);
    const [change, assignment] = await Promise.allSettled([
      changeBase(target, "lot"),
      createService({ code: `PAQUETE-${round}`, measurementUnitId: ids.units.package, unitDenominationId: target.id }),
    ]);
    const outcome = [change.status, assignment.status].join("/");
    if (outcome === "fulfilled/rejected") assert.match(assignment.reason.fields.unitDenominationId, /no pertenece/);
    else if (outcome === "rejected/fulfilled") assert.equal(change.reason.code, "MEASUREMENT_UNIT_BASE_IN_USE");
    else assert.fail(`Resultado inesperado ${outcome}: ${change.reason?.code ?? ""} ${assignment.reason?.code ?? ""}`);
  }
  const [mismatch] = await rows(`select
    (select count(*) from public.services s join public.measurement_unit_denominations d on d.id = s.unit_denomination_id
      where s.measurement_unit_id <> d.measurement_unit_id)::int services,
    (select count(*) from public.service_versions v join public.measurement_unit_denominations d on d.id = v.unit_denomination_id
      where v.measurement_unit_id <> d.measurement_unit_id)::int versions`);
  assert.deepEqual(mismatch, { services: 0, versions: 0 });
});

test("listado de denominaciones: filtros, búsqueda literal y paginación por cursor estable", { skip }, async () => {
  const all = (await units.getDenominationsPage({ limit: 100 })).unitDenominations;
  const seen = [];
  let cursor;
  do {
    const page = await units.getDenominationsPage({ cursor, limit: 2 });
    assert.ok(page.unitDenominations.length <= 2);
    seen.push(...page.unitDenominations.map((item) => item.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(seen, all.map((item) => item.id));
  // Orden: unidad base (sort_order) y después texto.
  const order = all.map((item) => [item.measurementUnit.sortOrder, item.denomination]);
  assert.deepEqual(order, [...order].sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)));
  assert.ok((await units.getDenominationsPage({ measurementUnitId: ids.units.square_meter })).unitDenominations.every((item) => item.measurementUnit.code === "square_meter"));
  assert.ok((await units.getDenominationsPage({ status: "inactive" })).unitDenominations.every((item) => !item.isActive));
  assert.deepEqual((await units.getDenominationsPage({ search: "%" })).unitDenominations, []);
  assert.ok((await units.getDenominationsPage({ search: "m.l." })).unitDenominations.every((item) => item.measurementUnit.symbol === "m.l."));
});

test("integridad: base fija con historial, sin borrados de referencias y texto normalizado en PostgreSQL", { skip }, async () => {
  // «de construcción» solo conserva referencias en versiones de LLAVE-PREMIUM.
  const [denomination] = await rows("select id::int from public.measurement_unit_denominations where denomination = 'de construcción' and measurement_unit_id = $1", [ids.units.square_meter]);
  await assert.rejects(rows("update public.measurement_unit_denominations set measurement_unit_id = $1 where id = $2", [ids.units.global, denomination.id]), { code: "55000" });
  await assert.rejects(rows("delete from public.measurement_unit_denominations where id = $1", [denomination.id]), { code: "23001" });
  await assert.rejects(rows("delete from public.measurement_units where id = $1", [ids.units.square_meter]), { code: "23001" });
  for (const text of [" de obra", "de  obra", ""]) {
    await assert.rejects(rows("insert into public.measurement_unit_denominations (measurement_unit_id, denomination) values ($1, $2)", [ids.units.global, text]), { code: "23514" }, JSON.stringify(text));
  }
  const [summary] = await rows(`select count(*)::int services,
    count(*) filter (where (select count(*) from public.service_versions v where v.service_id = s.id and v.is_current) = 1)::int with_one_current
    from public.services s`);
  assert.equal(summary.with_one_current, summary.services);
});
