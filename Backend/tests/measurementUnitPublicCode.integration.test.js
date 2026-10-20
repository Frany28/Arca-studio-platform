import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { applyMigration, createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

// Código público de denominaciones (UNID-001…) contra PostgreSQL real. Opcional y aislada:
// ARCA_SERVICE_CATALOG_DB_TESTS=1 y ARCA_SERVICE_CATALOG_TEST_DATABASE_URL (solo localhost).
// Usa dos bases desechables: una con el historial completo y otra detenida antes de la migración
// del código, para comprobar su aplicación sobre registros preexistentes.
const enabled = process.env.ARCA_SERVICE_CATALOG_DB_TESTS === "1";
const skip = !enabled && "Requiere PostgreSQL local, ARCA_SERVICE_CATALOG_DB_TESTS=1 y ARCA_SERVICE_CATALOG_TEST_DATABASE_URL.";
const MIGRATION = "20261020150000_measurement_unit_denomination_public_code";
const CODE_PATTERN = /^UNID-\d{3,}$/;

let database;
let db;
let units;
let ids;

/**
 * Consulta la base completa con el cliente de preparación (fuera del pool de la aplicación).
 *
 * @param {string} sql - Sentencia SQL.
 * @param {Array<unknown>} [values] - Parámetros.
 * @returns {Promise<Array<object>>} Filas.
 */
async function rows(sql, values = []) {
  return (await database.client.query(sql, values)).rows;
}

/**
 * Crea una denominación con el servicio real como administrador.
 *
 * @param {string} denomination - Texto normalizado.
 * @param {string} [code] - Código de la unidad base.
 * @returns {Promise<object>} Denominación creada.
 */
function create(denomination, code = "square_meter") {
  return units.createDenomination({ payload: { denomination, measurementUnitId: ids.units[code] }, user: { id: ids.admin } });
}

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({ baseUrl: process.env.ARCA_SERVICE_CATALOG_TEST_DATABASE_URL, prefix: "arca_unit_codes" });
  const [role] = await rows("insert into public.roles (code, name) values ('admin', 'Administrador') returning id");
  const [admin] = await rows(`insert into public.users (role_id, email, first_name, last_name, password_hash)
    values ($1, 'codigos@arca.test', 'Admin', 'Códigos', '!integration-login-disabled!') returning id::int`, [role.id]);
  const unitRows = await rows("select id::int, code from public.measurement_units");
  ids = { admin: admin.id, units: Object.fromEntries(unitRows.map((unit) => [unit.code, unit.id])) };
  Object.assign(process.env, { DATABASE_POOL_MAX: "10", DATABASE_URL: database.databaseUrl, NODE_ENV: "test" });
  db = await import("../src/config/db.js");
  units = await import("../src/services/measurementUnitService.js");
});

after(async () => {
  await db?.pool.end().catch(() => {});
  if (database) await database.drop();
});

test("primer código y siguientes: UNID-001, UNID-002… con tres dígitos y devueltos al crear", { skip }, async () => {
  const first = await create("de construcción");
  const second = await create("a intervenir");
  const third = await create("de recorrido comercial");
  assert.deepEqual([first.publicCode, second.publicCode, third.publicCode], ["UNID-001", "UNID-002", "UNID-003"]);
  assert.deepEqual([first.label, second.label], ["m² de construcción", "m² a intervenir"]);
  assert.ok([first, second, third].every((item) => CODE_PATTERN.test(item.publicCode)));
});

test("concurrencia: altas simultáneas reciben códigos distintos sin colisiones", { skip }, async () => {
  const created = await Promise.all(Array.from({ length: 20 }, (_, index) => create(`concurrente ${index}`, "unit")));
  const codes = created.map((item) => item.publicCode);
  assert.equal(new Set(codes).size, 20);
  assert.ok(codes.every((code) => CODE_PATTERN.test(code)));
  const [duplicates] = await rows(`select count(*)::int total from (select public_code from public.measurement_unit_denominations
    group by public_code having count(*) > 1) d`);
  assert.equal(duplicates.total, 0);
});

test("el código se conserva al editar, desactivar y reactivar", { skip }, async () => {
  const [target] = (await units.getDenominationsPage({ search: "de construcción", measurementUnitId: ids.units.square_meter })).unitDenominations;
  assert.equal(target.publicCode, "UNID-001");
  const edited = await units.updateDenomination({ denominationId: target.id, payload: { denomination: "de construcción nueva" }, user: { id: ids.admin } });
  const off = await units.changeDenominationStatus({ denominationId: target.id, payload: { isActive: false }, user: { id: ids.admin } });
  const on = await units.changeDenominationStatus({ denominationId: target.id, payload: { isActive: true }, user: { id: ids.admin } });
  assert.deepEqual([edited.unitDenomination.publicCode, off.unitDenomination.publicCode, on.unitDenomination.publicCode], ["UNID-001", "UNID-001", "UNID-001"]);
  assert.equal((await units.getDenomination(target.id)).publicCode, "UNID-001");
});

test("PostgreSQL rechaza escribir el código, incluso por SQL directo", { skip }, async () => {
  const [target] = await rows("select id::int from public.measurement_unit_denominations where public_code = 'UNID-002'");
  await assert.rejects(rows("update public.measurement_unit_denominations set public_code = 'UNID-777' where id = $1", [target.id]), { code: "428C9" });
  await assert.rejects(rows(`insert into public.measurement_unit_denominations (measurement_unit_id, denomination, public_code)
    values ($1, 'con código manual', 'UNID-888')`, [ids.units.global]), { code: "428C9" });
  const [unchanged] = await rows("select public_code from public.measurement_unit_denominations where id = $1", [target.id]);
  assert.equal(unchanged.public_code, "UNID-002");
});

test("búsqueda por código y presencia del código en listado y detalle", { skip }, async () => {
  const exact = await units.getDenominationsPage({ search: "UNID-003" });
  assert.deepEqual(exact.unitDenominations.map((item) => [item.publicCode, item.label]), [["UNID-003", "m² de recorrido comercial"]]);
  const partial = await units.getDenominationsPage({ search: "unid-00", limit: 100 });
  assert.ok(partial.unitDenominations.length >= 3 && partial.unitDenominations.every((item) => item.publicCode.startsWith("UNID-00")));
  // Los filtros existentes se combinan con la búsqueda por código.
  assert.deepEqual((await units.getDenominationsPage({ search: "UNID-003", measurementUnitId: ids.units.unit })).unitDenominations, []);
  const all = await units.getDenominationsPage({ limit: 100 });
  assert.ok(all.unitDenominations.every((item) => CODE_PATTERN.test(item.publicCode)));
  const detail = await units.getDenomination(exact.unitDenominations[0].id);
  assert.equal(detail.publicCode, "UNID-003");
});

test("más de 999 registros: el código crece sin truncarse ni repetirse (UNID-1000, UNID-1001…)", { skip }, async () => {
  await rows(`insert into public.measurement_unit_denominations (measurement_unit_id, denomination)
    select $1, 'lote masivo ' || n from generate_series(1, 1005) as n`, [ids.units.lot]);
  const codes = await rows("select id::int, public_code from public.measurement_unit_denominations where id in (999, 1000, 1001) order by id");
  assert.deepEqual(codes.map((row) => row.public_code), ["UNID-999", "UNID-1000", "UNID-1001"]);
  const [summary] = await rows(`select count(*)::int total, count(distinct public_code)::int distinct_codes,
    bool_and(public_code = 'UNID-' || lpad(id::text, greatest(3, length(id::text)), '0')) derived_from_id
    from public.measurement_unit_denominations`);
  assert.equal(summary.total, summary.distinct_codes);
  assert.equal(summary.derived_from_id, true);
  const viaService = await create("después de mil", "global");
  assert.match(viaService.publicCode, /^UNID-\d{4}$/);
});

test("migración sobre registros preexistentes: calcula sus códigos sin cambiar otros datos", { skip }, async () => {
  const legacy = await createIsolatedMigrationDatabase({
    baseUrl: process.env.ARCA_SERVICE_CATALOG_TEST_DATABASE_URL, prefix: "arca_unit_codes_legacy", stopBefore: MIGRATION,
  });
  try {
    const q = async (sql, values = []) => (await legacy.client.query(sql, values)).rows;
    const [unit] = await q("select id from public.measurement_units where code = 'square_meter'");
    await q(`insert into public.measurement_unit_denominations (measurement_unit_id, denomination, is_active) values
      ($1, 'de construcción', true), ($1, 'a intervenir', false), ($1, 'exterior', true)`, [unit.id]);
    const before = await q("select id, denomination, is_active, updated_at from public.measurement_unit_denominations order by id");
    await applyMigration(legacy.client, MIGRATION);
    const afterRows = await q("select id, denomination, is_active, updated_at, public_code from public.measurement_unit_denominations order by id");
    assert.deepEqual(afterRows.map((row) => row.public_code), ["UNID-001", "UNID-002", "UNID-003"]);
    assert.deepEqual(afterRows.map(({ public_code: _code, ...rest }) => rest), before);
    // Las altas posteriores continúan la misma secuencia.
    const [next] = await q("insert into public.measurement_unit_denominations (measurement_unit_id, denomination) values ($1, 'proyectado') returning public_code", [unit.id]);
    assert.equal(next.public_code, "UNID-004");
  } finally {
    await legacy.drop();
  }
});

test("migración sobre tabla vacía: la columna existe, es única y obligatoria", { skip }, async () => {
  const empty = await createIsolatedMigrationDatabase({ baseUrl: process.env.ARCA_SERVICE_CATALOG_TEST_DATABASE_URL, prefix: "arca_unit_codes_empty" });
  try {
    const [column] = (await empty.client.query(`select is_nullable, is_generated, generation_expression, character_maximum_length len
      from information_schema.columns where table_schema = 'public' and table_name = 'measurement_unit_denominations' and column_name = 'public_code'`)).rows;
    assert.equal(column.is_nullable, "NO");
    assert.equal(column.is_generated, "ALWAYS");
    assert.equal(column.len, 24);
    assert.match(column.generation_expression, /UNID-/);
    const [constraint] = (await empty.client.query("select contype from pg_constraint where conname = 'uq_measurement_unit_denominations_public_code'")).rows;
    assert.equal(constraint.contype, "u");
    assert.equal((await empty.client.query("select count(*)::int n from public.measurement_unit_denominations")).rows[0].n, 0);
  } finally {
    await empty.drop();
  }
});
