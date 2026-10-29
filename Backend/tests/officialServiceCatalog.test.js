import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  diffServiceFromCatalog,
  expectedServiceState,
  planDenomination,
  planServices,
  toCatalogUnitOptions,
  toServiceCreateBody,
} from "../src/domain/officialServiceCatalog.js";
import { officialServiceCatalogSchema } from "../src/validation/officialServiceCatalogSchemas.js";
import { serviceCreateSchema } from "../src/validation/serviceCatalogSchemas.js";

// Reglas del archivo del catálogo oficial y del plan de carga, sin base de datos. El archivo
// real vive fuera del repositorio: con ARCA_OFFICIAL_CATALOG_FILE se valida también.

/**
 * Catálogo mínimo válido con las variantes del tabulador: denominación, varias unidades con una
 * tarifa pendiente, texto comercial y llave en mano.
 *
 * @returns {object} Catálogo sin validar.
 */
function sampleCatalog() {
  return {
    catalogId: "prueba-tabulador",
    changeNote: "Carga de prueba",
    denominations: [{ denomination: "de construcción", unit: "square_meter" }],
    expectedTotals: { denominations: 1, individual: 3, services: 4, turnkey: 1 },
    services: [
      { description: "Planimetría 2D.", kind: "individual", name: "Anteproyecto", order: 1, referenceRate: "14", units: [{ denomination: "de construcción", unit: "square_meter" }] },
      { description: null, kind: "individual", name: "Modelado", order: 2, referenceRate: "320.00", units: [{ referenceRate: "320.00", unit: "project" }, { referenceRate: null, unit: "space" }] },
      { description: null, kind: "individual", name: "Permisos", order: 3, referenceRate: "510.00", units: [{ presentationLabel: " Global  por Proyecto ", unit: "project" }] },
      { description: null, kind: "turnkey", name: "Llave en mano", order: 4, referenceRate: "610.00", units: [{ unit: "square_meter" }] },
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
 * @returns {Array<{ entry: object, expected: object, unitOptions: Array<object> }>} Servicios preparados.
 */
function preparedEntries() {
  return officialServiceCatalogSchema.parse(sampleCatalog()).services.map((entry) => {
    const unitOptions = toCatalogUnitOptions(entry, { denominationId: () => 7, unitsByCode: UNITS });
    return { entry, expected: expectedServiceState(entry, unitOptions), unitOptions };
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
  return {
    ...expected,
    code: `SERV-${String(id).padStart(3, "0")}`,
    id,
    unitOptions: expected.unitOptions.map((option) => ({
      measurementUnit: { id: option.measurementUnitId },
      presentationLabel: option.presentationLabel,
      referenceRate: option.referenceRate,
      unitDenomination: option.unitDenominationId === null ? null : { id: option.unitDenominationId },
    })),
  };
}

test("archivo del catálogo: normaliza tarifas y textos y conserva null como tarifa pendiente", () => {
  const catalog = officialServiceCatalogSchema.parse(sampleCatalog());
  assert.equal(catalog.services[0].referenceRate, "14.00");
  assert.deepEqual(catalog.services[1].units.map((unit) => unit.referenceRate), ["320.00", null]);
  assert.equal(catalog.services[2].units[0].presentationLabel, "Global por Proyecto");
  assert.equal(catalog.services[3].units[0].denomination, null);
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

test("archivo del catálogo: no inventa tarifas y exige denominaciones declaradas", () => {
  const catalog = sampleCatalog();
  delete catalog.services[1].units[1].referenceRate;
  catalog.services[2].units[0].referenceRate = "510.00";
  catalog.services[3].units = [{ denomination: "de exterior", unit: "square_meter" }];
  catalog.denominations.push({ denomination: "De Construcción", unit: "square_meter" });
  catalog.expectedTotals.denominations = 2;
  const errors = catalogErrors(catalog);
  assert.match(errors["services.1.units.1.referenceRate"], /indica la tarifa de cada una/);
  assert.match(errors["services.2.units.0.referenceRate"], /no la indiques aparte/);
  assert.match(errors["services.3.units.0.denomination"], /no está declarada/);
  assert.match(errors["denominations.1"], /repetida/);
});

test("cuerpo de alta: es el de POST /admin/services y con una sola unidad no envía tarifa aparte", () => {
  const [anteproyecto, modelado] = preparedEntries();
  const body = toServiceCreateBody(anteproyecto.entry, { changeNote: "Carga · carga abc", unitOptions: anteproyecto.unitOptions });
  assert.deepEqual(body.unitOptions, [{ measurementUnitId: 1, presentationLabel: null, unitDenominationId: 7 }]);
  assert.equal(serviceCreateSchema.safeParse({ body }).success, true);
  assert.deepEqual(modelado.unitOptions.map((option) => option.referenceRate), ["320.00", null]);
  // El estado esperado aplica la regla del dominio: una sola unidad lleva la tarifa del servicio.
  assert.equal(anteproyecto.expected.unitOptions[0].referenceRate, "14.00");
  assert.equal(anteproyecto.expected.sortOrder, 1);
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
    ["create", "SERV-001"], ["create", "SERV-002"], ["create", "SERV-003"], ["create", "SERV-004"],
  ]);
});

test("servicios: reanuda tras los primeros idénticos y exige que la secuencia entregue el siguiente", () => {
  const entries = preparedEntries();
  const existing = [existingService(entries[0].expected, 1), existingService(entries[1].expected, 2)];
  const plan = planServices({ entries, existingServices: existing, nextServiceId: 3 });
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(plan.services.map((step) => step.action), ["exists", "exists", "create", "create"]);
  // Un número consumido (alta fallida o escritura ajena) desplazaría los códigos: se bloquea.
  const shifted = planServices({ entries, existingServices: existing, nextServiceId: 4 });
  assert.match(shifted.blockers[0], /entregaría SERV-004 y el siguiente debe ser SERV-003/);
});

test("servicios: un existente distinto, ajeno o fuera de orden bloquea la carga", () => {
  const entries = preparedEntries();
  const changed = existingService(entries[1].expected, 2);
  changed.unitOptions[1].referenceRate = "300.00";
  const foreign = { ...existingService(entries[0].expected, 9), name: "Servicio de prueba" };
  const plan = planServices({ entries, existingServices: [existingService(entries[0].expected, 1), changed, foreign], nextServiceId: 3 });
  assert.match(plan.blockers.join("\n"), /SERV-002 ya existe y difiere del catálogo en: unitOptions/);
  assert.match(plan.blockers.join("\n"), /SERV-009 «Servicio de prueba» no corresponde al catálogo/);
  const gap = planServices({ entries, existingServices: [existingService(entries[1].expected, 2)], nextServiceId: 3 });
  assert.match(gap.blockers.join("\n"), /no son los primeros del catálogo/);
});

test("diferencias: detecta cada campo versionado que no coincide con el catálogo", () => {
  const [entry] = preparedEntries();
  const service = { ...existingService(entry.expected, 1), isActive: false, referenceRate: "13.00" };
  assert.deepEqual(diffServiceFromCatalog(service, entry.expected), ["referenceRate", "isActive"]);
  const otherUnit = existingService(entry.expected, 1);
  otherUnit.unitOptions[0].unitDenomination = null;
  assert.deepEqual(diffServiceFromCatalog(otherUnit, entry.expected), ["unitOptions"]);
  assert.deepEqual(diffServiceFromCatalog(existingService(entry.expected, 1), entry.expected), []);
});

test("catálogo oficial (archivo privado): estructura y totales del tabulador 3.2", {
  skip: !process.env.ARCA_OFFICIAL_CATALOG_FILE && "Define ARCA_OFFICIAL_CATALOG_FILE con la ruta del archivo privado.",
}, async () => {
  const catalog = officialServiceCatalogSchema.parse(JSON.parse(await readFile(process.env.ARCA_OFFICIAL_CATALOG_FILE, "utf8")));
  assert.deepEqual(catalog.expectedTotals, { denominations: 7, individual: 16, services: 19, turnkey: 3 });
  // Reglas decididas sobre el documento, sin repetir aquí sus importes (el repositorio es público).
  const byName = Object.fromEntries(catalog.services.map((service) => [service.name, service]));
  // Modelado 3D: proyecto con la tarifa del tabulador y espacio pendiente (sin importe inventado).
  const modeling = byName["Modelado 3D & Renders"];
  assert.deepEqual(modeling.units.map((unit) => [unit.unit, unit.referenceRate]), [["project", modeling.referenceRate], ["space", null]]);
  // Recorrido VR: minuto (principal) y proyecto, ambas cotizables con la tarifa del tabulador.
  const tour = byName["Recorrido Virtual / VR"];
  assert.deepEqual(tour.units.map((unit) => [unit.unit, unit.referenceRate]), [["minute", tour.referenceRate], ["project", tour.referenceRate]]);
  // Unidad base con texto comercial del documento.
  assert.deepEqual(byName["Permisología & Legal"].units, [{ denomination: null, presentationLabel: "Global por Proyecto", unit: "project" }]);
  assert.deepEqual(byName["Inspección Técnica Obra"].units, [{ denomination: null, presentationLabel: "Honorario Mensual", unit: "month" }]);
  // Solo esos dos servicios tienen varias unidades y solo espacio queda pendiente.
  assert.deepEqual(catalog.services.filter((service) => service.units.length > 1).map((service) => service.name), ["Modelado 3D & Renders", "Recorrido Virtual / VR"]);
  assert.equal(catalog.services.flatMap((service) => service.units).filter((unit) => unit.referenceRate === null).length, 1);
});
