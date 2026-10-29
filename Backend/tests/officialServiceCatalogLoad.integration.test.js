import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

import bcrypt from "bcrypt";

import { applyMigration, createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

// Carga del catálogo oficial contra PostgreSQL real. Opcional y aislada, como el catálogo:
// ARCA_SERVICE_CATALOG_DB_TESTS=1 y ARCA_SERVICE_CATALOG_TEST_DATABASE_URL (solo localhost).
// La base empieza sin la migración de varias unidades para comprobar que la carga la exige. Usa
// el archivo privado del tabulador si ARCA_OFFICIAL_CATALOG_FILE lo indica; si no, un catálogo
// de prueba con las mismas variantes (denominación, varias unidades, pendiente, texto comercial).
const enabled = process.env.ARCA_SERVICE_CATALOG_DB_TESTS === "1";
const createApiRoles = process.env.ARCA_SERVICE_CATALOG_TEST_CREATE_ROLES === "1";
const skip = !enabled && "Requiere PostgreSQL local, ARCA_SERVICE_CATALOG_DB_TESTS=1 y ARCA_SERVICE_CATALOG_TEST_DATABASE_URL.";
const MIGRATION = "20261027120000_service_unit_options";
const PASSWORD = "Carga-Catalogo-2026!";

let database;
let db;
let loader;
let credentials;
let catalogService;
let unitService;
let maintenance;
let rawCatalog;
let catalog;
let admin;
let usesOfficialFile;

/**
 * Catálogo de prueba con las variantes del tabulador 3.2.
 *
 * @returns {object} Catálogo sin validar.
 */
function sampleCatalog() {
  return {
    catalogId: "prueba-tabulador",
    changeNote: "Carga de prueba del tabulador",
    denominations: [{ denomination: "de construcción", unit: "square_meter" }, { denomination: "eléctrico", unit: "point" }],
    expectedTotals: { denominations: 2, individual: 4, services: 5, turnkey: 1 },
    services: [
      { description: "Planimetría 2D.", kind: "individual", name: "Anteproyecto de prueba", order: 1, referenceRate: "12.00", units: [{ denomination: "de construcción", unit: "square_meter" }] },
      { description: "Modelo 3D.", kind: "individual", name: "Modelado de prueba", order: 2, referenceRate: "450.00", units: [{ referenceRate: "450.00", unit: "project" }, { referenceRate: null, unit: "space" }] },
      { description: null, kind: "individual", name: "Recorrido de prueba", order: 3, referenceRate: "600.00", units: [{ referenceRate: null, unit: "minute" }, { referenceRate: null, unit: "project" }] },
      { description: null, kind: "individual", name: "Permisos de prueba", order: 4, referenceRate: "800.00", units: [{ presentationLabel: "Global por Proyecto", unit: "project" }] },
      { description: null, kind: "turnkey", name: "Llave en mano de prueba", order: 5, referenceRate: "550.00", units: [{ unit: "square_meter" }] },
    ],
    source: "Documento de prueba",
  };
}

/**
 * Los primeros `count` servicios del catálogo, con los totales ajustados (simula una carga
 * interrumpida después de esos servicios).
 *
 * @param {number} count - Servicios incluidos.
 * @returns {object} Catálogo validado parcial.
 */
function partialCatalog(count) {
  const services = rawCatalog.services.slice(0, count);
  return loader.parseOfficialCatalog({
    ...rawCatalog,
    expectedTotals: {
      ...rawCatalog.expectedTotals,
      individual: services.filter((service) => service.kind === "individual").length,
      services: count,
      turnkey: services.filter((service) => service.kind === "turnkey").length,
    },
    services,
  });
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
 * Cuenta las filas que escribe la carga, para comprobar que un plan o un rechazo no escriben.
 *
 * @returns {Promise<object>} Conteos de servicios, versiones, denominaciones y auditoría.
 */
async function writeCounts() {
  const [row] = await rows(`select (select count(*) from public.services)::int as services,
    (select count(*) from public.service_versions)::int as versions,
    (select count(*) from public.measurement_unit_denominations)::int as denominations,
    (select count(*) from public.audit_logs)::int as audits`);
  return row;
}

before(async () => {
  if (!enabled) return;
  usesOfficialFile = Boolean(process.env.ARCA_OFFICIAL_CATALOG_FILE);
  rawCatalog = usesOfficialFile ? JSON.parse(await readFile(process.env.ARCA_OFFICIAL_CATALOG_FILE, "utf8")) : sampleCatalog();
  database = await createIsolatedMigrationDatabase({
    baseUrl: process.env.ARCA_SERVICE_CATALOG_TEST_DATABASE_URL,
    createApiRoles,
    prefix: "arca_official_catalog",
    stopBefore: MIGRATION,
  });
  const roles = await rows("insert into public.roles (code, name) values ('admin', 'Administrador'), ('client', 'Cliente') returning id, code");
  const roleId = Object.fromEntries(roles.map((role) => [role.code, role.id]));
  const hash = await bcrypt.hash(PASSWORD, 4);
  const users = await rows(`insert into public.users (role_id, email, first_name, last_name, password_hash, status) values
      ($1, 'carga@arca.test', 'Admin', 'Carga', $3, 'active'),
      ($2, 'cliente@arca.test', 'Cliente', 'Prueba', $3, 'active'),
      ($1, 'inactivo@arca.test', 'Admin', 'Inactivo', $3, 'inactive')
    returning id::int, email`, [roleId.admin, roleId.client, hash]);
  admin = users.find((user) => user.email === "carga@arca.test");

  Object.assign(process.env, { DATABASE_POOL_MAX: "5", DATABASE_URL: database.databaseUrl, NODE_ENV: "test" });
  db = await import("../src/config/db.js");
  loader = await import("../src/services/officialServiceCatalogLoadService.js");
  credentials = await import("../src/services/credentialService.js");
  catalogService = await import("../src/services/serviceCatalogService.js");
  unitService = await import("../src/services/measurementUnitService.js");
  maintenance = await import("../src/repositories/catalogMaintenanceRepository.js");
  catalog = loader.parseOfficialCatalog(rawCatalog);
});

after(async () => {
  await db?.pool.end().catch(() => {});
  if (database) await database.drop();
});

test("migración: sin varias unidades por servicio, o sin registrarla en Prisma, la carga se bloquea", { skip }, async () => {
  const plan = await loader.planOfficialCatalogLoad(catalog, { runId: "pre" });
  assert.equal(plan.ready, false);
  assert.match(plan.blockers.join("\n"), /aplica la migración 20261027120000_service_unit_options/);
  await applyMigration(database.client, MIGRATION);
  const unregistered = await loader.planOfficialCatalogLoad(catalog, { runId: "pre" });
  assert.deepEqual(unregistered.blockers, ["La migración 20261027120000_service_unit_options no figura como terminada en _prisma_migrations."]);
  // Registro equivalente al de `prisma migrate deploy`.
  await rows(`insert into public._prisma_migrations (id, checksum, finished_at, migration_name, applied_steps_count)
    values (gen_random_uuid()::text, 'test', now(), $1, 1)`, [MIGRATION]);
});

test("identidad: solo un administrador activo con sus propias credenciales", { skip }, async () => {
  await assert.rejects(credentials.authenticateMaintenanceAdmin({ email: "carga@arca.test", password: "otra" }), { code: "MAINTENANCE_INVALID_CREDENTIALS" });
  await assert.rejects(credentials.authenticateMaintenanceAdmin({ email: "nadie@arca.test", password: PASSWORD }), { code: "MAINTENANCE_INVALID_CREDENTIALS" });
  await assert.rejects(credentials.authenticateMaintenanceAdmin({ email: "cliente@arca.test", password: PASSWORD }), { code: "MAINTENANCE_FORBIDDEN" });
  await assert.rejects(credentials.authenticateMaintenanceAdmin({ email: "inactivo@arca.test", password: PASSWORD }), { code: "MAINTENANCE_ACCOUNT_NOT_ACTIVE" });
  const user = await credentials.authenticateMaintenanceAdmin({ email: " CARGA@arca.test ", password: PASSWORD });
  assert.deepEqual(user, { email: "carga@arca.test", id: admin.id, name: "Admin Carga" });
});

test("dry-run: predice SERV-001.. y UNID-001.. sin escribir ni consumir secuencias", { skip }, async () => {
  const before = await writeCounts();
  const plan = await loader.planOfficialCatalogLoad(catalog, { runId: "dry" });
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.ready, true);
  assert.equal(plan.pendingWrites, catalog.denominations.length + catalog.services.length);
  assert.deepEqual(plan.services.map((step) => step.expectedCode), catalog.services.map((service) => `SERV-${String(service.order).padStart(3, "0")}`));
  assert.deepEqual(plan.denominations.map((step) => step.publicCode), catalog.denominations.map((_, index) => `UNID-${String(index + 1).padStart(3, "0")}`));
  const modeling = plan.services[1];
  assert.deepEqual(modeling.units.map((unit) => [unit.label, unit.referenceRate, unit.pending]), [["proy.", "450.00", false], ["esp.", null, true]]);
  assert.deepEqual(await writeCounts(), before);
  assert.equal(await maintenance.readNextSerialId("public.services", "id"), 1);
  assert.equal(await maintenance.readNextSerialId("public.measurement_unit_denominations", "id"), 1);
});

test("concurrencia: con otra carga en curso no se escribe nada", { skip }, async () => {
  const lock = await maintenance.tryAcquireCatalogLoadLock();
  try {
    const before = await writeCounts();
    await assert.rejects(loader.applyOfficialCatalogLoad(catalog, { catalogSha256: "a".repeat(64), runId: "lock", user: admin }), { code: "CATALOG_LOAD_IN_PROGRESS" });
    assert.deepEqual(await writeCounts(), before);
  } finally {
    await lock.release();
  }
});

test("denominación existente escrita de otra forma: bloquea hasta que un administrador la corrige", { skip }, async () => {
  const [first] = catalog.denominations;
  const unit = (await rows("select id::int from public.measurement_units where code = $1", [first.unit]))[0];
  const variant = await unitService.createDenomination({ payload: { denomination: first.denomination.toUpperCase(), measurementUnitId: unit.id }, user: admin });
  const before = await writeCounts();
  const error = await loader.applyOfficialCatalogLoad(catalog, { catalogSha256: "b".repeat(64), runId: "blk", user: admin }).catch((caught) => caught);
  assert.equal(error.code, "CATALOG_LOAD_BLOCKED");
  assert.match(error.catalogLoad.plan.blockers.join("\n"), /UNID-001 está escrita como/);
  assert.deepEqual(error.catalogLoad.completed, []);
  assert.deepEqual(await writeCounts(), before);
  // La corrección es administrativa (edición normal); después la carga la reutiliza.
  await unitService.updateDenomination({ denominationId: variant.id, payload: { denomination: first.denomination }, user: admin });
  const plan = await loader.planOfficialCatalogLoad(catalog, { runId: "fix" });
  assert.deepEqual([plan.ready, plan.denominations[0].action, plan.denominations[0].publicCode], [true, "reuse", "UNID-001"]);
});

test("carga interrumpida y reanudada: cada servicio con su código, versión 1, autoría y auditoría", { skip }, async () => {
  const sha = "c".repeat(64);
  const first = await loader.applyOfficialCatalogLoad(partialCatalog(2), { catalogSha256: sha, runId: "run1", user: admin });
  assert.deepEqual(first.completed.filter((item) => item.type === "service").map((item) => item.code), ["SERV-001", "SERV-002"]);
  assert.equal(first.verification.ok, true, first.verification.issues.join("\n"));

  // Reanudación con el catálogo completo: reconoce lo creado y continúa en SERV-003.
  const resumed = await loader.applyOfficialCatalogLoad(catalog, { catalogSha256: sha, runId: "run2", user: admin });
  assert.deepEqual(resumed.plan.services.slice(0, 2).map((step) => step.action), ["exists", "exists"]);
  assert.deepEqual(resumed.completed.filter((item) => item.type === "service").map((item) => item.code),
    catalog.services.slice(2).map((service) => `SERV-${String(service.order).padStart(3, "0")}`));
  assert.equal(resumed.verification.ok, true, resumed.verification.issues.join("\n"));

  const services = await rows(`select s.code, s.sort_order, s.created_by::int, v.version_number, v.changed_by::int, v.change_note
    from public.services s join public.service_versions v on v.service_id = s.id order by s.id, v.version_number`);
  assert.equal(services.length, catalog.services.length, "Una sola versión por servicio");
  assert.ok(services.every((row) => row.version_number === 1 && row.created_by === admin.id && row.changed_by === admin.id));
  assert.deepEqual(services.map((row) => row.sort_order), catalog.services.map((service) => service.order));
  assert.match(services[0].change_note, /· carga run1$/);
  assert.match(services.at(-1).change_note, /· carga run2$/);

  const audits = await rows("select action, entity_type, user_id::int, user_agent, new_values from public.audit_logs order by id");
  const created = catalog.denominations.length - 1 + catalog.services.length;
  assert.equal(audits.length, created, "Un registro por alta (la denominación corregida se reutilizó)");
  assert.ok(audits.every((row) => row.user_id === admin.id && row.user_agent === "maintenance:load-official-service-catalog" && row.new_values.catalogSha256 === sha));
  assert.deepEqual([...new Set(audits.map((row) => row.action))].sort(), [
    "service_catalog.official_load.denomination_created", "service_catalog.official_load.service_created",
  ]);
});

test("unidades y tarifas: alternativas con tarifa pendiente y texto comercial tal como el documento", { skip }, async () => {
  const listed = await rows(`select s.code, o.position, u.code as unit, o.presentation_label, o.reference_rate
    from public.service_unit_options o join public.services s on s.id = o.service_id
    join public.measurement_units u on u.id = o.measurement_unit_id order by s.id, o.position`);
  const unitsOf = (name) => {
    const code = `SERV-${String(catalog.services.find((service) => service.name === name).order).padStart(3, "0")}`;
    return listed.filter((row) => row.code === code).map((row) => [row.unit, row.presentation_label, row.reference_rate]);
  };
  const names = usesOfficialFile
    ? { modeling: "Modelado 3D & Renders", permits: "Permisología & Legal", tour: "Recorrido Virtual / VR" }
    : { modeling: "Modelado de prueba", permits: "Permisos de prueba", tour: "Recorrido de prueba" };
  assert.deepEqual(unitsOf(names.modeling), [["project", null, "450.00"], ["space", null, null]]);
  assert.deepEqual(unitsOf(names.tour), [["minute", null, null], ["project", null, null]]);
  assert.deepEqual(unitsOf(names.permits), [["project", "Global por Proyecto", "800.00"]]);
  const [tour] = await rows("select reference_rate from public.services where name = $1", [names.tour]);
  assert.equal(tour.reference_rate, "600.00", "La tarifa del tabulador se conserva como referencia");
  if (usesOfficialFile) {
    const kinds = await rows("select kind, count(*)::int as total from public.services group by kind order by kind");
    assert.deepEqual(kinds, [{ kind: "individual", total: 16 }, { kind: "turnkey", total: 3 }]);
  }
});

test("idempotencia: repetir la carga no escribe nada y la verificación sigue correcta", { skip }, async () => {
  const before = await writeCounts();
  const again = await loader.applyOfficialCatalogLoad(catalog, { catalogSha256: "d".repeat(64), runId: "run3", user: admin });
  assert.deepEqual([again.plan.pendingWrites, again.completed.length, again.verification.ok], [0, 0, true]);
  assert.deepEqual(await writeCounts(), before);
});

test("servicio editado después de la carga: la verificación lo detecta y la carga no lo sobrescribe", { skip }, async () => {
  const [row] = await rows("select id::int from public.services where code = 'SERV-002'");
  await catalogService.updateService({ payload: { changeNote: null, expectedVersion: 1, referenceRate: "500.00" }, serviceId: row.id, user: admin });
  const verification = await loader.verifyOfficialCatalog(catalog);
  assert.equal(verification.ok, false);
  assert.match(verification.issues.join("\n"), /SERV-002 difiere del catálogo en: referenceRate/);
  assert.match(verification.notes.join("\n"), /SERV-002 está en la versión 2/);
  const before = await writeCounts();
  await assert.rejects(loader.applyOfficialCatalogLoad(catalog, { catalogSha256: "e".repeat(64), runId: "run4", user: admin }), { code: "CATALOG_LOAD_BLOCKED" });
  assert.deepEqual(await writeCounts(), before);
});

test("secuencia desplazada: un número consumido fuera de la carga bloquea los servicios nuevos", { skip }, async () => {
  await rows("select nextval(pg_get_serial_sequence('public.services', 'id'))");
  // Mismo catálogo con la edición de SERV-002 (sus unidades conservan sus tarifas) y un servicio más.
  const extended = loader.parseOfficialCatalog({
    ...rawCatalog,
    expectedTotals: { ...rawCatalog.expectedTotals, individual: rawCatalog.expectedTotals.individual + 1, services: rawCatalog.services.length + 1 },
    services: [...rawCatalog.services.map((service) => (service.order === 2 ? { ...service, referenceRate: "500.00" } : service)),
      { description: null, kind: "individual", name: "Servicio adicional", order: rawCatalog.services.length + 1, referenceRate: "1.00", units: [{ unit: "project" }] }],
  });
  const plan = await loader.planOfficialCatalogLoad(extended, { runId: "seq" });
  const expectedNext = `SERV-${String(rawCatalog.services.length + 1).padStart(3, "0")}`;
  assert.match(plan.blockers.join("\n"), new RegExp(`entregaría SERV-\\d+ y el siguiente debe ser ${expectedNext}`));
});
