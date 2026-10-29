import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  diffServiceFromCatalog,
  expectedServiceState,
  planDenomination,
  planServices,
  toCatalogServiceUnit,
  toServiceCreateBody,
} from "../src/domain/officialServiceCatalog.js";
import { officialServiceCatalogSchema } from "../src/validation/officialServiceCatalogSchemas.js";
import { serviceCreateSchema } from "../src/validation/serviceCatalogSchemas.js";

// Reglas del archivo del catálogo oficial y del plan de carga, sin base de datos. El archivo
// real vive fuera del repositorio: con ARCA_OFFICIAL_CATALOG_FILE se valida también.

/**
 * Catálogo mínimo válido con las variantes del tabulador: denominación, una variante con otra
 * unidad colocada junto a su original (`sortOrder`), texto comercial y llave en mano.
 *
 * @returns {object} Catálogo sin validar.
 */
function sampleCatalog() {
  return {
    catalogId: "prueba-tabulador",
    changeNote: "Carga de prueba",
    denominations: [{ denomination: "de construcción", unit: "square_meter" }],
    expectedTotals: { denominations: 1, individual: 4, services: 5, turnkey: 1 },
    services: [
      { denomination: "de construcción", description: "Planimetría 2D.", kind: "individual", name: "Anteproyecto", order: 1, referenceRate: "14", unit: "square_meter" },
      { description: null, kind: "individual", name: "Modelado — Por proyecto", order: 2, referenceRate: "320.00", unit: "project" },
      { description: null, kind: "individual", name: "Permisos", order: 3, presentationLabel: " Global  por Proyecto ", referenceRate: "510.00", unit: "project" },
      { description: null, kind: "turnkey", name: "Llave en mano", order: 4, referenceRate: "610.00", unit: "square_meter" },
      { description: null, kind: "individual", name: "Modelado — Por espacio", order: 5, referenceRate: "320.00", sortOrder: 2, unit: "space" },
    ],
    source: "Documento de prueba",
  };
}

/**
 * Valida un catálogo y devuelve los mensajes de error por ruta.
 *
 * @param {object} catalog - Catálogo sin validar.
 * @returns {Record<string, string>} Errores; vacío si es válido.
 */
function catalogErrors(catalog) {
  const result = officialServiceCatalogSchema.safeParse(catalog);
  return result.success ? {} : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message]));
}

const UNITS = new Map([["square_meter", { id: 1 }], ["project", { id: 38 }], ["space", { id: 39 }]]);

/**
 * Prepara los servicios del catálogo de ejemplo como el servicio de carga (denominación 7).
 *
 * @returns {Array<{ entry: object, expected: object, unit: object }>} Servicios preparados.
 */
function preparedEntries() {
  return officialServiceCatalogSchema.parse(sampleCatalog()).services.map((entry) => {
    const unit = toCatalogServiceUnit(entry, { denominationId: () => 7, unitsByCode: UNITS });
    return { entry, expected: expectedServiceState(entry, unit), unit };
  });
}

/**
 * Servicio existente en la forma pública del repositorio a partir de su estado esperado.
 *
 * @param {object} expected - Estado esperado (expectedServiceState).
 * @param {number} id - Id del servicio.
 * @returns {object} Servicio existente.
 */
function existingService(expected, id) {
  const { unit, ...fields } = expected;
  return {
    ...fields,
    code: `SERV-${String(id).padStart(3, "0")}`,
    id,
    measurementUnit: { id: unit.measurementUnitId },
    presentationLabel: unit.presentationLabel,
    unitDenomination: unit.unitDenominationId === null ? null : { id: unit.unitDenominationId },
  };
}

test("archivo del catálogo: normaliza tarifas y textos; el orden visual es el del documento salvo sortOrder", () => {
  const catalog = officialServiceCatalogSchema.parse(sampleCatalog());
  assert.equal(catalog.services[0].referenceRate, "14.00");
  assert.equal(catalog.services[2].presentationLabel, "Global por Proyecto");
  assert.equal(catalog.services[3].denomination, null);
  assert.deepEqual(catalog.services.map((service) => service.sortOrder), [1, 2, 3, 4, 2]);
});

test("archivo del catálogo: rechaza orden no contiguo, totales distintos y nombres repetidos", () => {
  const catalog = sampleCatalog();
  catalog.services[1].order = 3;
  catalog.services[3].name = "Anteproyecto";
  catalog.expectedTotals.turnkey = 2;
  const errors = catalogErrors(catalog);
  assert.match(errors["services.1.order"], /debe ser 2/);
  assert.match(errors["services.3.name"], /repetido/);
  assert.match(errors["expectedTotals.turnkey"], /Se declararon 2 y el archivo contiene 1/);
});

test("archivo del catálogo: una sola unidad por servicio y denominaciones declaradas", () => {
  const withList = sampleCatalog();
  withList.services[1].units = [{ unit: "project" }, { unit: "space" }];
  assert.match(catalogErrors(withList)["services.1"], /units/, "La lista de unidades ya no se admite");
  const catalog = sampleCatalog();
  catalog.services[3].denomination = "de exterior";
  catalog.denominations.push({ denomination: "De Construcción", unit: "square_meter" });
  catalog.expectedTotals.denominations = 2;
  const errors = catalogErrors(catalog);
  assert.match(errors["services.3.denomination"], /no está declarada/);
  assert.match(errors["denominations.1"], /repetida/);
  const missingUnit = sampleCatalog();
  delete missingUnit.services[1].unit;
  assert.ok(catalogErrors(missingUnit)["services.1.unit"]);
});

test("cuerpo de alta: es el de POST /admin/services, con su unidad, orden visual y texto comercial", () => {
  const [anteproyecto, , permisos, , espacio] = preparedEntries();
  const body = toServiceCreateBody(anteproyecto.entry, { changeNote: "Carga · carga abc", unit: anteproyecto.unit });
  assert.deepEqual([body.measurementUnitId, body.unitDenominationId, body.presentationLabel], [1, 7, undefined]);
  assert.equal(serviceCreateSchema.safeParse({ body }).success, true);
  const permitsBody = toServiceCreateBody(permisos.entry, { changeNote: "Carga", unit: permisos.unit });
  assert.equal(permitsBody.presentationLabel, "Global por Proyecto");
  assert.equal(serviceCreateSchema.safeParse({ body: permitsBody }).success, true);
  // La variante por espacio se crea al final (orden 5) pero se muestra junto a su original.
  assert.equal(toServiceCreateBody(espacio.entry, { changeNote: "Carga", unit: espacio.unit }).sortOrder, 2);
  assert.equal(anteproyecto.expected.sortOrder, 1);
  assert.deepEqual(anteproyecto.expected.unit, { measurementUnitId: 1, presentationLabel: null, unitDenominationId: 7 });
});

test("denominaciones: reutiliza solo la equivalente activa e idéntica", () => {
  const item = { denomination: "de construcción", unit: "square_meter" };
  assert.deepEqual(planDenomination(item, null), { action: "create" });
  assert.deepEqual(planDenomination(item, { denomination: "de construcción", id: 1, isActive: true, publicCode: "UNID-001" }), { action: "reuse" });
  assert.equal(planDenomination(item, { denomination: "de construcción", id: 1, isActive: false, publicCode: "UNID-001" }).action, "blocked");
  assert.match(planDenomination(item, { denomination: "De Construcción", id: 1, isActive: true, publicCode: "UNID-001" }).reason, /escrita como/);
});

test("servicios: base vacía y secuencia en 1 crean SERV-001..N en orden", () => {
  const plan = planServices({ entries: preparedEntries(), existingServices: [], nextServiceId: 1 });
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(plan.services.map((step) => [step.action, step.expectedCode]), [
    ["create", "SERV-001"], ["create", "SERV-002"], ["create", "SERV-003"], ["create", "SERV-004"], ["create", "SERV-005"],
  ]);
});

test("servicios: reanuda tras los primeros idénticos y exige que la secuencia entregue el siguiente", () => {
  const entries = preparedEntries();
  const existing = entries.slice(0, 4).map((item, index) => existingService(item.expected, index + 1));
  const plan = planServices({ entries, existingServices: existing, nextServiceId: 5 });
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(plan.services.map((step) => step.action), ["exists", "exists", "exists", "exists", "create"]);
  // Un número consumido (alta fallida o escritura ajena) desplazaría los códigos: se bloquea.
  const shifted = planServices({ entries, existingServices: existing, nextServiceId: 6 });
  assert.match(shifted.blockers[0], /entregaría SERV-006 y el siguiente debe ser SERV-005/);
});

test("servicios: un existente distinto, ajeno o fuera de orden bloquea la carga", () => {
  const entries = preparedEntries();
  const changed = { ...existingService(entries[1].expected, 2), name: "Modelado 3D & Renders" };
  const foreign = { ...existingService(entries[0].expected, 9), name: "Servicio de prueba" };
  const plan = planServices({ entries, existingServices: [existingService(entries[0].expected, 1), changed, foreign], nextServiceId: 3 });
  assert.match(plan.blockers.join("\n"), /SERV-002 ya existe y difiere del catálogo en: name/);
  assert.match(plan.blockers.join("\n"), /SERV-009 «Servicio de prueba» no corresponde al catálogo/);
  const gap = planServices({ entries, existingServices: [existingService(entries[1].expected, 2)], nextServiceId: 3 });
  assert.match(gap.blockers.join("\n"), /no son los primeros del catálogo/);
});

test("diferencias: detecta cada campo versionado que no coincide con el catálogo", () => {
  const [entry, , permisos] = preparedEntries();
  const service = { ...existingService(entry.expected, 1), isActive: false, referenceRate: "13.00" };
  assert.deepEqual(diffServiceFromCatalog(service, entry.expected), ["referenceRate", "isActive"]);
  const otherUnit = { ...existingService(entry.expected, 1), unitDenomination: null };
  assert.deepEqual(diffServiceFromCatalog(otherUnit, entry.expected), ["unitDenominationId"]);
  const withoutLabel = { ...existingService(permisos.expected, 3), presentationLabel: null };
  assert.deepEqual(diffServiceFromCatalog(withoutLabel, permisos.expected), ["presentationLabel"]);
  assert.deepEqual(diffServiceFromCatalog(existingService(entry.expected, 1), entry.expected), []);
});

test("catálogo oficial (archivo privado): una unidad por servicio y variantes separadas del tabulador 3.2", {
  skip: !process.env.ARCA_OFFICIAL_CATALOG_FILE && "Define ARCA_OFFICIAL_CATALOG_FILE con la ruta del archivo privado.",
}, async () => {
  const catalog = officialServiceCatalogSchema.parse(JSON.parse(await readFile(process.env.ARCA_OFFICIAL_CATALOG_FILE, "utf8")));
  assert.deepEqual(catalog.expectedTotals, { denominations: 7, individual: 18, services: 21, turnkey: 3 });
  // Reglas decididas sobre el documento, sin repetir aquí sus importes (el repositorio es público).
  const byName = Object.fromEntries(catalog.services.map((service) => [service.name, service]));
  const variants = [
    ["Modelado 3D & Renders — Por proyecto", 2, "project"],
    ["Modelado 3D & Renders — Por espacio", 20, "space"],
    ["Recorrido Virtual / VR — Por minuto", 14, "minute"],
    ["Recorrido Virtual / VR — Por proyecto", 21, "project"],
  ];
  for (const [name, order, unit] of variants) {
    assert.deepEqual([byName[name]?.order, byName[name]?.unit], [order, unit], name);
  }
  // Cada variante se muestra junto a su original y comparte su tarifa base.
  assert.equal(byName["Modelado 3D & Renders — Por espacio"].sortOrder, byName["Modelado 3D & Renders — Por proyecto"].sortOrder);
  assert.equal(byName["Modelado 3D & Renders — Por espacio"].referenceRate, byName["Modelado 3D & Renders — Por proyecto"].referenceRate);
  assert.equal(byName["Recorrido Virtual / VR — Por proyecto"].sortOrder, byName["Recorrido Virtual / VR — Por minuto"].sortOrder);
  assert.equal(byName["Recorrido Virtual / VR — Por proyecto"].referenceRate, byName["Recorrido Virtual / VR — Por minuto"].referenceRate);
  // Unidades base con texto comercial del documento.
  assert.deepEqual([byName["Permisología & Legal"].unit, byName["Permisología & Legal"].presentationLabel], ["project", "Global por Proyecto"]);
  assert.deepEqual([byName["Inspección Técnica Obra"].unit, byName["Inspección Técnica Obra"].presentationLabel], ["month", "Honorario Mensual"]);
  // Los demás servicios conservan su orden visual del documento.
  assert.ok(catalog.services.filter((service) => service.order <= 19).every((service) => service.sortOrder === service.order));
});
