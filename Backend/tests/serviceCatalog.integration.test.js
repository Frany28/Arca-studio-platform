import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

// Catálogo de servicios contra PostgreSQL real. Opcional y aislada: ARCA_SERVICE_CATALOG_DB_TESTS=1 y
// ARCA_SERVICE_CATALOG_TEST_DATABASE_URL (solo localhost). Crea una base propia, aplica el historial
// completo de migraciones y la elimina al terminar; nunca usa DATABASE_URL del proyecto.
// ARCA_SERVICE_CATALOG_TEST_CREATE_ROLES=1 crea los roles anon/authenticated/service_role como en
// Supabase para comprobar el REVOKE de la migración (solo en un clúster desechable).
const enabled = process.env.ARCA_SERVICE_CATALOG_DB_TESTS === "1";
const createApiRoles = process.env.ARCA_SERVICE_CATALOG_TEST_CREATE_ROLES === "1";
const skip = !enabled && "Requiere PostgreSQL local, ARCA_SERVICE_CATALOG_DB_TESTS=1 y ARCA_SERVICE_CATALOG_TEST_DATABASE_URL.";
const CATALOG_TABLES = ["measurement_units", "services", "service_versions"];

let database;
let ids;

/**
 * Ejecuta una consulta parametrizada en la base aislada.
 *
 * @param {string} sql - Sentencia SQL.
 * @param {Array<unknown>} [values] - Parámetros.
 * @returns {Promise<import("pg").QueryResult>} Resultado.
 */
function query(sql, values = []) {
  return database.client.query(sql, values);
}

/**
 * Inserta una versión del servicio de prueba copiando los datos actuales del servicio y su unidad.
 *
 * @param {number} versionNumber - Número de versión.
 * @param {object} [overrides] - Columnas que se sustituyen en la copia.
 * @returns {Promise<import("pg").QueryResult>} Resultado del INSERT.
 */
function insertServiceVersion(versionNumber, overrides = {}) {
  const values = { changedBy: ids.userId, isCurrent: true, serviceId: ids.serviceId, ...overrides };
  return query(`
    insert into public.service_versions (
      service_id, version_number, code, name, description, kind, measurement_unit_id, unit_code, unit_name,
      unit_symbol, unit_allows_decimals, reference_rate, currency_code, is_active, sort_order, changed_by, is_current
    )
    select s.id, $2, s.code, s.name, s.description, s.kind, u.id, u.code, u.name, u.symbol, u.allows_decimals,
      s.reference_rate, s.currency_code, s.is_active, s.sort_order, $3, $4
    from public.services s join public.measurement_units u on u.id = s.measurement_unit_id
    where s.id = $1
    returning id
  `, [values.serviceId, versionNumber, values.changedBy, values.isCurrent]);
}

before(async () => {
  if (!enabled) return;
  database = await createIsolatedMigrationDatabase({
    baseUrl: process.env.ARCA_SERVICE_CATALOG_TEST_DATABASE_URL,
    createApiRoles,
    prefix: "arca_service_catalog",
  });
  const role = await query("insert into public.roles (code, name) values ('admin', 'Administrador') returning id");
  const user = await query(`
    insert into public.users (role_id, email, first_name, last_name, password_hash)
    values ($1, 'catalogo@arca.test', 'Catálogo', 'Pruebas', '!integration-login-disabled!') returning id
  `, [role.rows[0].id]);
  // El historial de migraciones ya carga el catálogo de unidades base (incluido m²).
  const unit = await query("select id from public.measurement_units where code = 'square_meter'");
  const service = await query(`
    insert into public.services (code, name, kind, measurement_unit_id, reference_rate, sort_order, created_by, updated_by)
    values ('ANTEPROYECTO', 'Anteproyecto arquitectónico', 'individual', $1, 12.00, 1, $2, $2) returning id
  `, [unit.rows[0].id, user.rows[0].id]);
  ids = { serviceId: service.rows[0].id, unitId: unit.rows[0].id, userId: user.rows[0].id };
  await insertServiceVersion(1);
});

after(async () => {
  if (database) await database.drop();
});

test("migración: tablas con RLS, índices y valores por defecto esperados", { skip }, async () => {
  const tables = await query("select relname, relrowsecurity from pg_class where relname = any($1) order by relname", [CATALOG_TABLES]);
  assert.deepEqual(tables.rows.map((row) => [row.relname, row.relrowsecurity]), [
    ["measurement_units", true], ["service_versions", true], ["services", true],
  ]);
  const indexes = await query("select indexname from pg_indexes where indexname = any($1) order by indexname", [[
    "services_catalog_order_idx", "uq_service_versions_current", "uq_service_versions_service_version",
  ]]);
  assert.equal(indexes.rowCount, 3);
  const service = await query("select currency_code, is_active, kind, reference_rate from public.services where id = $1", [ids.serviceId]);
  assert.deepEqual(service.rows[0], { currency_code: "USD", is_active: true, kind: "individual", reference_rate: "12.00" });
});

test("versionado: la versión histórica conserva la tarifa aunque cambie el servicio", { skip }, async () => {
  await query("update public.service_versions set is_current = false where service_id = $1 and is_current", [ids.serviceId]);
  await query("update public.services set reference_rate = 15.50, updated_at = now() where id = $1", [ids.serviceId]);
  await insertServiceVersion(2);

  const versions = await query(
    "select version_number, reference_rate, unit_symbol, is_current from public.service_versions where service_id = $1 order by version_number",
    [ids.serviceId],
  );
  assert.deepEqual(versions.rows, [
    { is_current: false, reference_rate: "12.00", unit_symbol: "m²", version_number: 1 },
    { is_current: true, reference_rate: "15.50", unit_symbol: "m²", version_number: 2 },
  ]);
});

test("vigencia única: no puede haber dos versiones vigentes ni números repetidos", { skip }, async () => {
  await assert.rejects(insertServiceVersion(99), { code: "23505" });
  await assert.rejects(insertServiceVersion(1, { isCurrent: false }), { code: "23505" });
});

test("historial inmutable: no se modifican valores, no se reactiva ni se elimina una versión", { skip }, async () => {
  const where = "where service_id = $1 and version_number = 1";
  await assert.rejects(query(`update public.service_versions set reference_rate = 1 ${where}`, [ids.serviceId]), { code: "55000" });
  await assert.rejects(query(`update public.service_versions set is_current = true ${where}`, [ids.serviceId]), { code: "55000" });
  await assert.rejects(query(`delete from public.service_versions ${where}`, [ids.serviceId]), { code: "55000" });
  const unchanged = await query(`select reference_rate, is_current from public.service_versions ${where}`, [ids.serviceId]);
  assert.deepEqual(unchanged.rows[0], { is_current: false, reference_rate: "12.00" });
});

test("integridad referencial: servicios, unidades y usuarios referenciados no se eliminan", { skip }, async () => {
  // ON DELETE RESTRICT responde 23001 (restrict_violation); 23503 corresponde a referencias inexistentes.
  await assert.rejects(query("delete from public.services where id = $1", [ids.serviceId]), { code: "23001" });
  await assert.rejects(query("delete from public.measurement_units where id = $1", [ids.unitId]), { code: "23001" });
  await assert.rejects(query("delete from public.users where id = $1", [ids.userId]), { code: "23001" });
  await assert.rejects(query(`
    insert into public.services (code, name, measurement_unit_id, reference_rate) values ('SIN-UNIDAD', 'Sin unidad', 999999, 1)
  `), { code: "23503" });
  // Desactivar una unidad o un servicio no elimina nada.
  await query("update public.measurement_units set is_active = false where id = $1", [ids.unitId]);
  await query("update public.services set is_active = false where id = $1", [ids.serviceId]);
  assert.equal((await query("select count(*)::int as total from public.service_versions")).rows[0].total, 2);
});

test("restricciones: tarifa, moneda, códigos, nombres, escala y tipo de servicio", { skip }, async () => {
  const insertService = (code, rate, extra = {}) => query(`
    insert into public.services (code, name, kind, measurement_unit_id, reference_rate, currency_code, sort_order)
    values ($1, $2, $3, $4, $5, $6, $7)
  `, [code, extra.name ?? "Servicio", extra.kind ?? "individual", ids.unitId, rate, extra.currency ?? "USD", extra.sortOrder ?? 0]);

  await insertService("LLAVE-EN-MANO-PREMIUM", "900.00", { kind: "turnkey" });
  await insertService("TARIFA-MAXIMA", "999999999999.99");
  await insertService("BONIFICADO", "0");
  await assert.rejects(insertService("LLAVE-EN-MANO-PREMIUM", "1"), { code: "23505" });
  await assert.rejects(insertService("NEGATIVO", "-0.01"), { code: "23514" });
  await assert.rejects(insertService("DESBORDE", "1000000000000"), { code: "22003" });
  await assert.rejects(insertService("EN-EUROS", "1", { currency: "EUR" }), { code: "23514" });
  await assert.rejects(insertService("minusculas", "1"), { code: "23514" });
  await assert.rejects(insertService("CON ESPACIO", "1"), { code: "23514" });
  await assert.rejects(insertService("SIN-NOMBRE", "1", { name: "   " }), { code: "23514" });
  await assert.rejects(insertService("ORDEN-NEGATIVO", "1", { sortOrder: -1 }), { code: "23514" });
  await assert.rejects(insertService("TIPO-INVALIDO", "1", { kind: "bundle" }), { code: "22P02" });
  await assert.rejects(query(`
    insert into public.measurement_units (code, name, symbol) values ('Metro Lineal', 'Metro lineal', 'ml')
  `), { code: "23514" });
  await assert.rejects(query(`
    insert into public.measurement_units (code, name, symbol) values ('square_meter', 'Duplicada', 'm2')
  `), { code: "23505" });
  await assert.rejects(insertServiceVersion(3, { changedBy: 999999, isCurrent: false }), { code: "23503" });
});

test("privilegios: los roles de la API no conservan privilegios peligrosos ni EXECUTE del trigger", { skip: skip || (!createApiRoles && "Requiere ARCA_SERVICE_CATALOG_TEST_CREATE_ROLES=1.") }, async () => {
  const grants = await query(`
    select c.relname, a.grantee::regrole::text as grantee, a.privilege_type
    from pg_class c cross join lateral aclexplode(c.relacl) a
    where c.relname = any($1) and a.grantee <> 0
      and a.grantee::regrole::text in ('anon', 'authenticated', 'service_role')
      and a.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
  `, [CATALOG_TABLES]);
  assert.deepEqual(grants.rows, []);
  const execute = await query("select has_function_privilege('anon', 'public.prevent_service_version_mutation()', 'EXECUTE') as allowed");
  assert.equal(execute.rows[0].allowed, false);
});
