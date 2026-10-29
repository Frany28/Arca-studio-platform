import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

import bcrypt from "bcrypt";

import { applyMigration, createIsolatedMigrationDatabase } from "./helpers/isolatedMigrationDatabase.js";

// Carga del catálogo oficial contra PostgreSQL real. Opcional y aislada, como el catálogo:
// ARCA_SERVICE_CATALOG_DB_TESTS=1 y ARCA_SERVICE_CATALOG_TEST_DATABASE_URL (solo localhost).
// La base empieza sin la migración de unidades para comprobar que la carga la exige. Usa el
// archivo privado del tabulador si ARCA_OFFICIAL_CATALOG_FILE lo indica; si no, un catálogo de
// prueba con las mismas variantes (denominación, una unidad por servicio con las formas de cobro
// separadas en servicios junto a su original, texto comercial) y tarifas ficticias. Con el
// archivo privado, las tarifas se leen de él y no se repiten aquí (el repositorio es público).
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

let quotes;
let quoteIds;
let NAMES;

/**
 * Catálogo de prueba con las variantes del tabulador 3.2 y tarifas ficticias.
 *
 * @returns {object} Catálogo sin validar.
 */
function sampleCatalog() {
  return {
    catalogId: "prueba-tabulador",
    changeNote: "Carga de prueba del tabulador",
    denominations: [{ denomination: "de construcción", unit: "square_meter" }, { denomination: "eléctrico", unit: "point" }],
    expectedTotals: { denominations: 2, individual: 7, services: 8, turnkey: 1 },
    services: [
      { denomination: "de construcción", description: "Planimetría 2D.", kind: "individual", name: "Anteproyecto de prueba", order: 1, referenceRate: "14.00", unit: "square_meter" },
      { description: "Modelo 3D.", kind: "individual", name: "Modelado de prueba — Por proyecto", order: 2, referenceRate: "320.00", unit: "project" },
      { description: null, kind: "individual", name: "Recorrido de prueba — Por minuto", order: 3, referenceRate: "275.00", unit: "minute" },
      { description: null, kind: "individual", name: "Permisos de prueba", order: 4, presentationLabel: "Global por Proyecto", referenceRate: "510.00", unit: "project" },
      { description: null, kind: "individual", name: "Inspección de prueba", order: 5, presentationLabel: "Honorario Mensual", referenceRate: "430.00", unit: "month" },
      { description: null, kind: "turnkey", name: "Llave en mano de prueba", order: 6, referenceRate: "610.00", unit: "square_meter" },
      { description: "Modelo 3D.", kind: "individual", name: "Modelado de prueba — Por espacio", order: 7, referenceRate: "320.00", sortOrder: 2, unit: "space" },
      { description: null, kind: "individual", name: "Recorrido de prueba — Por proyecto", order: 8, referenceRate: "275.00", sortOrder: 3, unit: "project" },
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
  NAMES = usesOfficialFile
    ? {
      inspection: "Inspección Técnica Obra", modeling: "Modelado 3D & Renders — Por proyecto", modelingSpace: "Modelado 3D & Renders — Por espacio",
      permits: "Permisología & Legal", tour: "Recorrido Virtual / VR — Por minuto", tourProject: "Recorrido Virtual / VR — Por proyecto",
    }
    : {
      inspection: "Inspección de prueba", modeling: "Modelado de prueba — Por proyecto", modelingSpace: "Modelado de prueba — Por espacio",
      permits: "Permisos de prueba", tour: "Recorrido de prueba — Por minuto", tourProject: "Recorrido de prueba — Por proyecto",
    };
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
  const [client] = await rows("insert into public.clients (name, email) values ('Cliente Catálogo', 'catalogo@arca.test') returning id::int");
  const [project] = await rows(`insert into public.projects (client_id, created_by, name, start_date, project_type, location, public_slug)
    values ($1, $2, 'Local Catálogo', current_date, (select enum_range(null::public.project_type))[1], 'Caracas', 'local-catalogo-carga') returning id::int`, [client.id, admin.id]);
  quoteIds = { client: client.id, project: project.id };

  Object.assign(process.env, { DATABASE_POOL_MAX: "5", DATABASE_URL: database.databaseUrl, NODE_ENV: "test" });
  db = await import("../src/config/db.js");
  loader = await import("../src/services/officialServiceCatalogLoadService.js");
  credentials = await import("../src/services/credentialService.js");
  catalogService = await import("../src/services/serviceCatalogService.js");
  unitService = await import("../src/services/measurementUnitService.js");
  maintenance = await import("../src/repositories/catalogMaintenanceRepository.js");
  quotes = await import("../src/services/quoteService.js");
  catalog = loader.parseOfficialCatalog(rawCatalog);
});

after(async () => {
  await db?.pool.end().catch(() => {});
  if (database) await database.drop();
});

test("migración: sin la estructura de unidades por servicio, o sin registrarla en Prisma, la carga se bloquea", { skip }, async () => {
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
  const step = (name) => plan.services.find((service) => service.name === name);
  assert.deepEqual([NAMES.modeling, NAMES.modelingSpace, NAMES.tour, NAMES.tourProject, NAMES.inspection].map((name) => step(name).unitLabel),
    ["proy.", "esp.", "min", "proy.", "Honorario Mensual"]);
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
  assert.deepEqual(services.map((row) => row.sort_order), catalog.services.map((service) => service.sortOrder));
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

test("unidades y tarifas: una unidad por servicio, variantes junto a su original y texto comercial del documento", { skip }, async () => {
  const listed = await rows(`select s.code, o.position, u.code as unit, o.presentation_label, o.reference_rate
    from public.service_unit_options o join public.services s on s.id = o.service_id
    join public.measurement_units u on u.id = o.measurement_unit_id order by s.id, o.position`);
  const unitsOf = (name) => {
    const code = `SERV-${String(catalog.services.find((service) => service.name === name).order).padStart(3, "0")}`;
    return listed.filter((row) => row.code === code).map((row) => [row.unit, row.presentation_label, row.reference_rate]);
  };
  // Las tarifas se leen del catálogo usado (el privado no se repite en el repositorio público).
  const rateOf = (name) => catalog.services.find((service) => service.name === name).referenceRate;
  assert.deepEqual(unitsOf(NAMES.modeling), [["project", null, rateOf(NAMES.modeling)]]);
  assert.deepEqual(unitsOf(NAMES.modelingSpace), [["space", null, rateOf(NAMES.modelingSpace)]]);
  assert.deepEqual(unitsOf(NAMES.tour), [["minute", null, rateOf(NAMES.tour)]]);
  assert.deepEqual(unitsOf(NAMES.tourProject), [["project", null, rateOf(NAMES.tourProject)]]);
  assert.deepEqual(unitsOf(NAMES.permits), [["project", "Global por Proyecto", rateOf(NAMES.permits)]]);
  assert.deepEqual(unitsOf(NAMES.inspection), [["month", "Honorario Mensual", rateOf(NAMES.inspection)]]);
  assert.ok(listed.every((row) => row.position === 1 && row.reference_rate !== null), "Una unidad con tarifa por servicio");
  // Cada variante se lista junto a su original (mismo orden visual, código posterior).
  const ordered = (await rows("select name from public.services order by sort_order, id")).map((row) => row.name);
  assert.equal(ordered.indexOf(NAMES.modelingSpace), ordered.indexOf(NAMES.modeling) + 1);
  assert.equal(ordered.indexOf(NAMES.tourProject), ordered.indexOf(NAMES.tour) + 1);
  if (usesOfficialFile) {
    const kinds = await rows("select kind, count(*)::int as total from public.services group by kind order by kind");
    assert.deepEqual(kinds, [{ kind: "individual", total: 18 }, { kind: "turnkey", total: 3 }]);
  }
});

test("idempotencia: repetir la carga no escribe nada y la verificación sigue correcta", { skip }, async () => {
  const before = await writeCounts();
  const again = await loader.applyOfficialCatalogLoad(catalog, { catalogSha256: "d".repeat(64), runId: "run3", user: admin });
  assert.deepEqual([again.plan.pendingWrites, again.completed.length, again.verification.ok], [0, 0, true]);
  assert.deepEqual(await writeCounts(), before);
});

test("cotizaciones del catálogo cargado: cada forma de cobro es un concepto con su unidad y tarifa editable", { skip }, async () => {
  const serviceId = async (name) => (await rows("select id::int from public.services where name = $1", [name]))[0].id;
  const rateOf = (name) => catalog.services.find((service) => service.name === name).referenceRate;
  // VR por minuto y por proyecto pueden ir en la misma cotización: son servicios distintos.
  const quote = await quotes.createQuote({
    payload: {
      clientId: quoteIds.client,
      items: [
        { quantity: "3", serviceId: await serviceId(NAMES.tour), unitRate: rateOf(NAMES.tour) },
        // La tarifa aplicada se modifica en la cotización sin alterar la referencia del tabulador.
        { quantity: "1", serviceId: await serviceId(NAMES.tourProject), unitRate: "123.00" },
        { quantity: "2", serviceId: await serviceId(NAMES.modelingSpace), unitRate: rateOf(NAMES.modelingSpace) },
      ],
      notes: null,
      projectId: quoteIds.project,
    },
    user: admin,
  });
  assert.deepEqual(quote.items.map((item) => [item.unit.label, item.unit.position, item.referenceRate, item.unitRate, item.subtotal]), [
    ["min", 1, rateOf(NAMES.tour), rateOf(NAMES.tour), (Number(rateOf(NAMES.tour)) * 3).toFixed(2)],
    ["proy.", 1, rateOf(NAMES.tourProject), "123.00", "123.00"],
    ["esp.", 1, rateOf(NAMES.modelingSpace), rateOf(NAMES.modelingSpace), (Number(rateOf(NAMES.modelingSpace)) * 2).toFixed(2)],
  ]);
  const [tour] = await rows("select reference_rate from public.services where name = $1", [NAMES.tourProject]);
  assert.equal(tour.reference_rate, rateOf(NAMES.tourProject), "La tarifa del tabulador no cambia");
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
  // Mismo catálogo con la edición de SERV-002 y un servicio más.
  const extended = loader.parseOfficialCatalog({
    ...rawCatalog,
    expectedTotals: { ...rawCatalog.expectedTotals, individual: rawCatalog.expectedTotals.individual + 1, services: rawCatalog.services.length + 1 },
    services: [...rawCatalog.services.map((service) => (service.order === 2 ? { ...service, referenceRate: "500.00" } : service)),
      { description: null, kind: "individual", name: "Servicio adicional", order: rawCatalog.services.length + 1, referenceRate: "1.00", unit: "project" }],
  });
  const plan = await loader.planOfficialCatalogLoad(extended, { runId: "seq" });
  const expectedNext = `SERV-${String(rawCatalog.services.length + 1).padStart(3, "0")}`;
  assert.match(plan.blockers.join("\n"), new RegExp(`entregaría SERV-\\d+ y el siguiente debe ser ${expectedNext}`));
});
