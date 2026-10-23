import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { listChangedServiceFields, mergeServiceChanges } from "../src/domain/serviceCatalog.js";
import { backendDirectory, listMigrations, readMigrationStatements } from "./helpers/migrationSchema.js";

// Contrato de la regla «un servicio usado en una cotización guardada no cambia de modalidad»
// (SERVICE_MODALITY_IN_USE, Backend/ARCHITECTURE.md). Aún no existen cotizaciones persistidas:
// la regla está PENDIENTE. Estas pruebas no la simulan; fijan lo que hoy es verificable y
// fallan en cuanto aparezca una referencia real a servicios, para obligar a implementarla.

// Tablas que hoy pueden referenciar servicios: solo su propio historial de versiones.
const ALLOWED_SERVICE_REFERENCES = new Set(["service_versions"]);
const PENDING = "Pendiente: no existen tablas de cotizaciones ni de conceptos (ARCHITECTURE.md, «Modalidad bloqueada por cotizaciones»).";
const CURRENT = {
  description: null,
  isActive: true,
  kind: "individual",
  measurementUnit: { code: "square_meter", id: 1 },
  name: "Anteproyecto",
  referenceRate: "12.00",
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

test("contrato vigente: solo un valor distinto de kind es un cambio de modalidad", () => {
  // La regla futura solo actuará cuando `kind` figure entre los campos con cambio efectivo.
  assert.deepEqual(listChangedServiceFields(CURRENT, mergeServiceChanges(CURRENT, { kind: "individual" })), [], "El mismo kind no es un cambio");
  assert.deepEqual(listChangedServiceFields(CURRENT, mergeServiceChanges(CURRENT, { kind: "turnkey" })), ["kind"]);
  // Tarifa, nombre, descripción y estado no tocan la modalidad: no deberán bloquearse por cotizaciones.
  for (const changes of [{ referenceRate: "15.00" }, { name: "Otro" }, { description: "Texto" }, { isActive: false }]) {
    assert.equal(listChangedServiceFields(CURRENT, mergeServiceChanges(CURRENT, changes)).includes("kind"), false, JSON.stringify(changes));
  }
});

test("alarma: ninguna tabla referencia servicios todavía; al aparecer una, implementar SERVICE_MODALITY_IN_USE", async () => {
  const schema = await readFile(path.join(backendDirectory, "prisma", "schema.prisma"), "utf8");
  const prismaModels = prismaModelsReferencingServices(schema).filter((model) => !ALLOWED_SERVICE_REFERENCES.has(model));
  const sqlTables = [];
  for (const migration of await listMigrations()) {
    sqlTables.push(...sqlTablesReferencingServices(await readMigrationStatements(migration)).filter((table) => !ALLOWED_SERVICE_REFERENCES.has(table)));
  }
  const message = "Una tabla nueva referencia servicios o versiones. Implementa el bloqueo de modalidad en updateService "
    + "(consulta de referencias con el servicio bloqueado FOR UPDATE y 409 SERVICE_MODALITY_IN_USE), convierte en pruebas "
    + "reales los casos pendientes de este archivo y añade la tabla a la consulta.";
  assert.deepEqual({ prismaModels, sqlTables }, { prismaModels: [], sqlTables: [] }, message);
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

// Casos obligatorios de la regla. Se convertirán en pruebas de integración (PostgreSQL desechable,
// como serviceCatalogApi.integration.test.js) cuando existan los conceptos de cotización.
for (const scenario of [
  "servicio sin cotizaciones: el cambio de kind se permite y crea una versión",
  "servicio con un concepto en una cotización guardada: 409 SERVICE_MODALITY_IN_USE",
  "cotización histórica, cancelada o archivada: también bloquea el cambio de kind",
  "servicio inactivo con referencias: el cambio de kind se rechaza",
  "con referencias, cambiar tarifa, nombre, descripción o estado sin cambiar kind se permite",
  "con referencias, enviar el mismo kind no es un cambio y no se rechaza",
  "expectedVersion obsoleto sigue respondiendo 409 SERVICE_VERSION_CONFLICT",
  "cambio rechazado: sin escrituras, sin versión nueva y con la tarifa y los datos intactos",
  "carrera: alta de un concepto y cambio de kind concurrentes; gana uno y el otro ve el resultado",
]) {
  test(`pendiente: ${scenario}`, { todo: PENDING }, () => {});
}
