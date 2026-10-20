import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

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
  const [{ id }] = await rows("select id::int from public.services where code = 'LLAVE-PREMIUM'");
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

test("integridad: base inmutable, sin borrados de referencias y texto normalizado en PostgreSQL", { skip }, async () => {
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
