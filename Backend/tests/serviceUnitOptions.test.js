import assert from "node:assert/strict";
import test from "node:test";

import { chooseQuoteUnitOption } from "../src/domain/quote.js";
import { listChangedServiceFields, mergeServiceChanges } from "../src/domain/serviceCatalog.js";
import { SERVICE_UNIT_POSITION, formatUnitOptionLabel, resolvePresentationLabel } from "../src/domain/serviceUnitOptions.js";
import { quoteCreateSchema } from "../src/validation/quoteSchemas.js";
import { serviceCreateSchema, serviceUpdateSchema } from "../src/validation/serviceCatalogSchemas.js";

// Una sola unidad por servicio: los servicios que se cobran de dos formas son servicios
// independientes («Modelado 3D & Renders — Por proyecto» y «— Por espacio»). Importes ficticios.

// «Permisología & Legal»: proyecto (38) con el texto comercial «Global por Proyecto».
const PERMITS = {
  description: null, isActive: true, kind: "individual", measurementUnit: { id: 38 }, name: "Permisología & Legal",
  presentationLabel: "Global por Proyecto", referenceRate: "510.00", sortOrder: 15, unitDenomination: null,
};

/**
 * Rutas de los errores de un resultado de Zod.
 *
 * @param {import("zod").SafeParseReturnType} result - Resultado de safeParse.
 * @returns {Array<string>} Rutas con puntos.
 */
function errorPaths(result) {
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

test("etiqueta: el texto comercial sustituye a la composición; sin él, abreviatura y denominación", () => {
  assert.equal(formatUnitOptionLabel({ presentationLabel: "Global por Proyecto", symbol: "proy." }), "Global por Proyecto");
  assert.equal(formatUnitOptionLabel({ presentationLabel: "  ", symbol: "proy." }), "proy.");
  assert.equal(formatUnitOptionLabel({ denomination: "de construcción", symbol: "m²" }), "m² de construcción");
});

test("texto comercial: se conserva con la misma unidad y se retira al cambiarla sin texto nuevo", () => {
  const current = { measurementUnitId: 38, presentationLabel: "Global por Proyecto", unitDenominationId: null };
  assert.equal(resolvePresentationLabel({ current, next: { measurementUnitId: 38, unitDenominationId: null } }), "Global por Proyecto");
  assert.equal(resolvePresentationLabel({ current, next: { measurementUnitId: 44, unitDenominationId: null } }), null);
  assert.equal(resolvePresentationLabel({ current, next: { measurementUnitId: 44, unitDenominationId: null }, requested: " Honorario  Mensual " }), "Honorario Mensual");
  assert.equal(resolvePresentationLabel({ current, next: { measurementUnitId: 38, unitDenominationId: null }, requested: null }), null);
  assert.equal(resolvePresentationLabel({ current: null, next: { measurementUnitId: 38, unitDenominationId: null } }), null);
});

test("versionado: editar otros campos conserva el texto comercial; cambiar la unidad lo retira", () => {
  assert.deepEqual(listChangedServiceFields(PERMITS, mergeServiceChanges(PERMITS, {})), []);
  const renamed = mergeServiceChanges(PERMITS, { name: "Permisología & Legal — Global" });
  assert.equal(renamed.presentationLabel, "Global por Proyecto");
  assert.deepEqual(listChangedServiceFields(PERMITS, renamed), ["name"]);
  const otherUnit = mergeServiceChanges(PERMITS, { measurementUnitId: 44 });
  assert.deepEqual(listChangedServiceFields(PERMITS, otherUnit), ["measurementUnitId", "presentationLabel"]);
  assert.deepEqual(listChangedServiceFields(PERMITS, mergeServiceChanges(PERMITS, { referenceRate: "520" })), ["referenceRate"]);
});

test("cotización: se cotiza la unidad del servicio; un concepto ya cotizado conserva la suya", () => {
  // Versión anterior a la unidad única: la alternativa (posición 2) es historial.
  const unitOptions = [{ id: 400, position: 1, referenceRate: "320.00" }, { id: 401, position: 2, referenceRate: "320.00" }];
  assert.equal(SERVICE_UNIT_POSITION, 1);
  assert.deepEqual(chooseQuoteUnitOption({ unitOptions }), { option: unitOptions[0] });
  assert.deepEqual(chooseQuoteUnitOption({ quotedPosition: 2, unitOptions }), { option: unitOptions[1] });
  assert.match(chooseQuoteUnitOption({ unitOptions: [] }).error, /no tiene una unidad/);
  assert.match(chooseQuoteUnitOption({ unitOptions: [{ id: 402, position: 1, referenceRate: null }] }).error, /no está confirmada/);
});

test("contrato: una unidad por servicio, sin unitOptions; texto comercial opcional y normalizado", () => {
  const base = { measurementUnitId: 38, name: "Modelado 3D & Renders — Por proyecto", referenceRate: "320" };
  const created = serviceCreateSchema.safeParse({ body: { ...base, presentationLabel: "  Global  por Proyecto " } });
  assert.equal(created.success, true, JSON.stringify(created.error?.issues));
  assert.equal(created.data.body.presentationLabel, "Global por Proyecto");
  assert.equal(serviceCreateSchema.safeParse({ body: base }).data.body.presentationLabel, undefined);
  assert.deepEqual(errorPaths(serviceCreateSchema.safeParse({ body: { name: base.name, referenceRate: "320" } })), ["body.measurementUnitId"]);
  assert.deepEqual(errorPaths(serviceCreateSchema.safeParse({ body: { ...base, unitOptions: [{ measurementUnitId: 38 }] } })), ["body"]);
  assert.deepEqual(errorPaths(serviceCreateSchema.safeParse({ body: { ...base, presentationLabel: "x".repeat(81) } })), ["body.presentationLabel"]);
  // La edición acepta el texto comercial solo (null lo retira) y rechaza unitOptions.
  const cleared = serviceUpdateSchema.safeParse({ params: { serviceId: "2" }, body: { expectedVersion: 1, presentationLabel: null } });
  assert.equal(cleared.success, true);
  assert.equal(cleared.data.body.presentationLabel, null);
  assert.equal(serviceUpdateSchema.safeParse({ params: { serviceId: "2" }, body: { expectedVersion: 1, unitOptions: [] } }).success, false);
  // En la cotización ya no se elige unidad.
  const item = { quantity: "1", serviceId: 4, unitRate: "320" };
  assert.equal(quoteCreateSchema.safeParse({ body: { clientId: 3, items: [item], projectId: 9 } }).success, true);
  assert.deepEqual(errorPaths(quoteCreateSchema.safeParse({ body: { clientId: 3, items: [{ ...item, unitOptionPosition: 1 }], projectId: 9 } })), ["body.items.0"]);
});
