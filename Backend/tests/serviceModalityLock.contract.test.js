import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { listChangedServiceFields, mergeServiceChanges } from "../src/domain/serviceCatalog.js";
import { startAdminRouterServer } from "./helpers/adminRouterServer.js";
import { backendDirectory, listMigrations, readMigrationStatements } from "./helpers/migrationSchema.js";

// Regla «un servicio usado en una cotización guardada no cambia de modalidad»
// (SERVICE_MODALITY_IN_USE, Backend/ARCHITECTURE.md). Activa desde la migración quotes:
// quote_items referencia el servicio y su versión. Estas pruebas ejecutan updateService real
// sobre un PostgreSQL simulado; la carrera con PostgreSQL real está en quotes.integration.test.js.

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/arca_unit_test";
process.env.ROUTE_AUTH_DISABLED_FOR_TESTS = "false";
const { pool } = await import("../src/config/db.js");
const { default: serviceCatalogRouter } = await import("../src/routes/serviceCatalog.js");

// Tablas que pueden referenciar servicios: su historial y los conceptos de cotización, que la
// consulta serviceHasQuoteReferences revisa. Una tabla nueva debe sumarse a esa consulta.
// service_unit_options y su copia por versión describen el propio servicio (sus unidades), no su
// uso: no representan una cotización y no bloquean la modalidad.
const ALLOWED_SERVICE_REFERENCES = new Set(["service_versions", "quote_items", "service_unit_options", "service_version_unit_options"]);
const ADMIN = { id: 2, role: { code: "admin" } };
const REFERENCE_CHECK = "select exists (select 1 from public.quote_items where service_id = $1) as used";
const CURRENT = {
  description: null,
  isActive: true,
  kind: "individual",
  measurementUnit: { code: "square_meter", id: 1 },
  name: "Anteproyecto",
  referenceRate: "14.00",
  sortOrder: 1,
  unitDenomination: null,
};

/**
 * Lista los modelos de schema.prisma que declaran una relación hacia `services` o
 * `service_versions`, es decir, tablas que podrían representar el uso de un servicio.
 *
 * @param {string} schema - Contenido de schema.prisma.
 * @returns {Array<string>} Nombres de modelo con esa relación.
 */
function prismaModelsReferencingServices(schema) {
  const models = [];
  for (const [, model, body] of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const referencesService = body.split("\n").some((line) => /^\s*\w+\s+(services|service_versions)\??\s+@relation\(/.test(line));
    if (referencesService) models.push(model);
  }
  return models;
}

/**
 * Lista las tablas cuyo SQL de migración declara una clave foránea hacia `public.services` o
 * `public.service_versions`, en CREATE TABLE o ALTER TABLE.
 *
 * @param {string} sql - SQL de una migración sin comentarios.
 * @returns {Array<string>} Tablas con esa referencia.
 */
function sqlTablesReferencingServices(sql) {
  const tables = [];
  for (const statement of sql.split(";")) {
    if (!/references\s+(public\.)?(services|service_versions)\s*\(/i.test(statement)) continue;
    const table = /(?:create\s+table|alter\s+table)\s+(?:if\s+not\s+exists\s+)?(?:only\s+)?(?:public\.)?(\w+)/i.exec(statement)?.[1];
    if (table) tables.push(table.toLowerCase());
  }
  return tables;
}

/**
 * Fila de servicio con la forma de SERVICE_COLUMNS para la base simulada.
 *
 * @param {object} service - Estado del servicio simulado.
 * @returns {object} Fila como la devuelve `pg`.
 */
function serviceRow(service) {
  return {
    code: "SERV-001", created_at: "2026-10-20T12:00:00.000Z", currency_code: "USD", current_version: service.version,
    denomination_id: null, denomination_is_active: null, denomination_text: null, description: null, id: "1",
    is_active: service.isActive, kind: service.kind, kind_locked: service.used, name: service.name, reference_rate: service.referenceRate,
    sort_order: 1, unit_allows_decimals: true, unit_code: "square_meter", unit_id: "1", unit_is_active: true, unit_name: "Metro cuadrado",
    unit_symbol: "m²", updated_at: "2026-10-20T12:00:00.000Z",
  };
}

/**
 * Única unidad del servicio simulado (m², con la tarifa del servicio), con la forma de la consulta
 * de unidades del catálogo.
 *
 * @param {object} service - Estado del servicio simulado.
 * @returns {object} Fila como la devuelve `pg`.
 */
function unitOptionRow(service) {
  return {
    denomination_id: null, denomination_is_active: null, denomination_text: null, option_id: "1", position: 1, presentation_label: null,
    reference_rate: service.referenceRate, service_id: "1", unit_allows_decimals: true, unit_code: "square_meter", unit_id: "1",
    unit_is_active: true, unit_name: "Metro cuadrado", unit_symbol: "m²",
  };
}

/**
 * Levanta el router del tabulador sobre una base simulada con un servicio individual en m²
 * que puede estar incluido en cotizaciones (`used`). Registra las escrituras para comprobar que
 * un rechazo no modifica nada.
 *
 * @param {import("node:test").TestContext} context - Contexto de la prueba.
 * @param {{ used: boolean, isActive?: boolean }} options - Estado inicial del servicio.
 * @returns {Promise<object>} Cliente HTTP, estado y escrituras.
 */
async function startCatalog(context, { isActive = true, used }) {
  const service = { isActive, kind: "individual", name: "Anteproyecto", referenceRate: "14.00", used, version: 1 };
  const writes = [];
  const statements = [];
  const respond = (sql) => {
    const text = sql.replace(/\s+/g, " ").trim();
    statements.push(text);
    if (/^(begin|commit|rollback)$/i.test(text)) return { rowCount: 0, rows: [] };
    // Las escrituras primero: la copia de la versión es un INSERT ... SELECT sobre services.
    if (/^(update|insert|delete)/.test(text)) {
      writes.push(text);
      if (text.startsWith("insert into public.service_versions")) {
        service.version += 1;
        return { rowCount: 1, rows: [{ id: String(service.version) }] };
      }
      return { rowCount: 1, rows: [] };
    }
    if (text.startsWith("select id from public.services where id = $1 for update")) return { rowCount: 1, rows: [{ id: "1" }] };
    if (text.includes("from public.services s inner join public.measurement_units u")) return { rowCount: 1, rows: [serviceRow(service)] };
    if (text.includes("from public.service_unit_options o inner join public.measurement_units u")) {
      return { rowCount: 1, rows: [unitOptionRow(service)] };
    }
    if (text.startsWith(REFERENCE_CHECK)) return { rowCount: 1, rows: [{ used: service.used }] };
    if (text.includes("from public.measurement_units where id = $1")) {
      return { rowCount: 1, rows: [{ allows_decimals: true, code: "square_meter", id: "1", is_active: true, name: "Metro cuadrado", sort_order: 101, symbol: "m²" }] };
    }
    throw new Error(`Sentencia no simulada: ${text.slice(0, 120)}`);
  };
  const server = await startAdminRouterServer(context, { pool, respond, routes: [["/api/admin/services", serviceCatalogRouter]] });
  server.setUser(ADMIN);
  /**
   * Sustituye el estado simulado tras una escritura confirmada, como lo vería la siguiente lectura.
   *
   * @param {object} changes - Campos del servicio que cambian.
   * @returns {void}
   */
  const applyServiceChanges = (changes) => Object.assign(service, changes);
  return { applyServiceChanges, patch: (body) => server.send("PATCH", "/api/admin/services/1", body), service, statements, writes };
}

test("contrato: solo un valor distinto de kind es un cambio de modalidad", () => {
  assert.deepEqual(listChangedServiceFields(CURRENT, mergeServiceChanges(CURRENT, { kind: "individual" })), [], "El mismo kind no es un cambio");
  assert.deepEqual(listChangedServiceFields(CURRENT, mergeServiceChanges(CURRENT, { kind: "turnkey" })), ["kind"]);
  for (const changes of [{ referenceRate: "15.00" }, { name: "Otro" }, { description: "Texto" }, { isActive: false }]) {
    assert.equal(listChangedServiceFields(CURRENT, mergeServiceChanges(CURRENT, changes)).includes("kind"), false, JSON.stringify(changes));
  }
});

test("alarma: solo service_versions y quote_items referencian servicios; una tabla nueva debe sumarse a la regla", async () => {
  const schema = await readFile(path.join(backendDirectory, "prisma", "schema.prisma"), "utf8");
  const prismaModels = prismaModelsReferencingServices(schema).filter((model) => !ALLOWED_SERVICE_REFERENCES.has(model));
  const sqlTables = [];
  for (const migration of await listMigrations()) {
    sqlTables.push(...sqlTablesReferencingServices(await readMigrationStatements(migration)).filter((table) => !ALLOWED_SERVICE_REFERENCES.has(table)));
  }
  const message = "Una tabla nueva referencia servicios o versiones. Añádela a serviceHasQuoteReferences "
    + "(SERVICE_MODALITY_IN_USE) y a kindLocked del detalle del servicio, y amplía estas pruebas.";
  assert.deepEqual({ prismaModels, sqlTables }, { prismaModels: [], sqlTables: [] }, message);
  assert.ok(prismaModelsReferencingServices(schema).includes("quote_items"), "quote_items es la referencia que activa la regla");
});

test("alarma: el detector reconoce referencias reales (control del propio detector)", () => {
  const schema = "model quote_items {\n  id BigInt @id\n  service_versions service_versions @relation(fields: [x], references: [id])\n}\n";
  assert.deepEqual(prismaModelsReferencingServices(schema), ["quote_items"]);
  assert.deepEqual(
    sqlTablesReferencingServices("CREATE TABLE public.quote_items (id bigint, service_version_id bigint REFERENCES public.service_versions(id))"),
    ["quote_items"],
  );
  assert.deepEqual(sqlTablesReferencingServices("ALTER TABLE ONLY public.quote_items ADD CONSTRAINT fk FOREIGN KEY (service_id) REFERENCES public.services (id)"), ["quote_items"]);
  assert.deepEqual(sqlTablesReferencingServices("CREATE TABLE public.notes (id bigint)"), []);
});

test("servicio sin cotizaciones: el cambio de kind se permite y crea una versión", async (context) => {
  const catalog = await startCatalog(context, { used: false });
  const response = await catalog.patch({ expectedVersion: 1, kind: "turnkey" });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.changed, true);
  assert.ok(catalog.writes.some((sql) => sql.startsWith("insert into public.service_versions")), JSON.stringify(catalog.writes));
});

test("servicio con conceptos guardados (también inactivo): 409 SERVICE_MODALITY_IN_USE sin escrituras", async (context) => {
  for (const isActive of [true, false]) {
    const catalog = await startCatalog(context, { isActive, used: true });
    const response = await catalog.patch({ expectedVersion: 1, kind: "turnkey" });
    assert.equal(response.status, 409, `activo=${isActive}`);
    assert.deepEqual(response.body, {
      code: "SERVICE_MODALITY_IN_USE",
      message: "La modalidad no se puede modificar porque este servicio ya está incluido en una cotización.",
    });
    assert.deepEqual(catalog.writes, [], "Sin escrituras ni versión nueva");
    assert.equal(catalog.statements.at(-1), "rollback");
  }
});

test("con referencias, cambiar tarifa, nombre o estado, o enviar el mismo kind, no consulta ni bloquea", async (context) => {
  for (const changes of [{ referenceRate: "15.00" }, { name: "Otro nombre" }, { isActive: false }, { kind: "individual", name: "Mismo kind" }]) {
    const catalog = await startCatalog(context, { used: true });
    const response = await catalog.patch({ expectedVersion: 1, ...changes });
    assert.equal(response.status, 200, `${JSON.stringify(changes)} → ${JSON.stringify(response.body)}`);
    assert.ok(!catalog.statements.some((sql) => sql.startsWith(REFERENCE_CHECK)), JSON.stringify(changes));
  }
});

test("expectedVersion obsoleto sigue respondiendo 409 SERVICE_VERSION_CONFLICT antes que la modalidad", async (context) => {
  const catalog = await startCatalog(context, { used: true });
  catalog.applyServiceChanges({ version: 3 });
  const response = await catalog.patch({ expectedVersion: 1, kind: "turnkey" });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "SERVICE_VERSION_CONFLICT");
  assert.ok(!catalog.statements.some((sql) => sql.startsWith(REFERENCE_CHECK)));
});

test("el detalle expone kindLocked para que el formulario bloquee la modalidad", async (context) => {
  const catalog = await startCatalog(context, { used: true });
  // Sin cambios efectivos la edición devuelve el servicio leído, con su kindLocked.
  const response = await catalog.patch({ expectedVersion: 1, kind: "individual" });
  assert.equal(response.body.service.kindLocked, true);
});
