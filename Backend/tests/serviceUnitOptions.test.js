import assert from "node:assert/strict";
import test from "node:test";

import { chooseQuoteUnitOption } from "../src/domain/quote.js";
import { listChangedServiceFields, mergeServiceChanges } from "../src/domain/serviceCatalog.js";
import {
  SERVICE_UNIT_OPTIONS_MAX,
  collectUnitOptionErrors,
  formatUnitOptionLabel,
  isUnitOptionQuotable,
  resolveUnitOptions,
} from "../src/domain/serviceUnitOptions.js";
import { quoteCreateSchema } from "../src/validation/quoteSchemas.js";
import { serviceCreateSchema, serviceUpdateSchema } from "../src/validation/serviceCatalogSchemas.js";

// Varias unidades por servicio (tabulador 3.2): «Por Proyecto / Espacio» ($450, confirmado por
// proyecto) y «Por Minuto / Proyecto» ($600, sin tarifa por unidad), sin inventar tarifas.

const option = (unitId, overrides = {}) => ({
  measurementUnit: { id: unitId }, presentationLabel: null, referenceRate: null, unitDenomination: null, ...overrides,
});

// «Modelado 3D & Renders»: proyecto (38) a $450 y espacio (39) pendiente.
const MODELING = {
  description: "Modelo 3D + 3 a 5 renders hiperrealistas.", isActive: true, kind: "individual",
  measurementUnit: { id: 38 }, name: "Modelado 3D & Renders", referenceRate: "450.00", sortOrder: 2, unitDenomination: null,
  unitOptions: [option(38, { referenceRate: "450.00" }), option(39)],
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

test("tarifas: una unidad pendiente no es cotizable y una sola unidad usa la tarifa del servicio", () => {
  assert.equal(isUnitOptionQuotable({ referenceRate: null }), false);
  assert.equal(isUnitOptionQuotable({ referenceRate: "0.00" }), true);
  // Alta con el atajo: una unidad base sin denominación toma la tarifa del servicio.
  assert.deepEqual(resolveUnitOptions({ changes: { measurementUnitId: 6 }, current: [], referenceRate: "12.00" }), [
    { measurementUnitId: 6, presentationLabel: null, referenceRate: "12.00", unitDenominationId: null },
  ]);
  // Varias unidades: una tarifa omitida queda pendiente; nunca se copia la del servicio.
  const recorrido = resolveUnitOptions({
    changes: { unitOptions: [{ measurementUnitId: 31 }, { measurementUnitId: 38 }] }, current: [], referenceRate: "600.00",
  });
  assert.deepEqual(recorrido.map((item) => item.referenceRate), [null, null]);
});

test("reglas: entre 1 y el máximo, sin repetir unidad y denominación, tarifa única coherente", () => {
  assert.deepEqual(collectUnitOptionErrors(null, "12.00"), {}, "El atajo no se valida aquí");
  assert.equal(SERVICE_UNIT_OPTIONS_MAX, 10);
  const many = Array.from({ length: SERVICE_UNIT_OPTIONS_MAX + 1 }, (_value, index) => ({ measurementUnitId: index + 1, unitDenominationId: null }));
  assert.ok(collectUnitOptionErrors(many, "1.00").unitOptions);
  // La misma base admite denominaciones distintas, pero no la misma combinación dos veces.
  assert.deepEqual(collectUnitOptionErrors([{ measurementUnitId: 1, unitDenominationId: 1 }, { measurementUnitId: 1, unitDenominationId: 2 }], "1.00"), {});
  assert.deepEqual(
    Object.keys(collectUnitOptionErrors([{ measurementUnitId: 38, unitDenominationId: null }, { measurementUnitId: 38, unitDenominationId: null }], "1.00")),
    ["unitOptions.1.measurementUnitId"],
  );
  assert.deepEqual(
    Object.keys(collectUnitOptionErrors([{ measurementUnitId: 38, referenceRate: "500.00", unitDenominationId: null }], "800.00")),
    ["unitOptions.0.referenceRate"],
  );
});

test("versionado: las unidades cambian con su orden, tarifa o texto; el atajo conserva las alternativas", () => {
  assert.deepEqual(listChangedServiceFields(MODELING, mergeServiceChanges(MODELING, {})), []);
  // Confirmar la tarifa de espacio es un cambio versionado de las unidades.
  const confirmed = mergeServiceChanges(MODELING, { unitOptions: [
    { measurementUnitId: 38, referenceRate: "450.00" }, { measurementUnitId: 39, referenceRate: "380.00" },
  ] });
  assert.deepEqual(listChangedServiceFields(MODELING, confirmed), ["unitOptions"]);
  // En un servicio con varias unidades, la tarifa del tabulador no cambia las de las unidades.
  assert.deepEqual(listChangedServiceFields(MODELING, mergeServiceChanges(MODELING, { referenceRate: "500.00" })), ["referenceRate"]);
  // El atajo cambia solo la principal y conserva espacio pendiente.
  const replaced = mergeServiceChanges(MODELING, { measurementUnitId: 44 });
  assert.deepEqual(replaced.unitOptions.map((item) => [item.measurementUnitId, item.referenceRate]), [[44, "450.00"], [39, null]]);
  assert.equal(replaced.measurementUnitId, 44);
});

test("cotización: se elige la unidad por posición y nunca una con tarifa pendiente", () => {
  const unitOptions = [{ id: 400, position: 1, referenceRate: "450.00" }, { id: 401, position: 2, referenceRate: null }];
  assert.deepEqual(chooseQuoteUnitOption({ requestedPosition: 1, unitOptions }), { option: unitOptions[0] });
  assert.match(chooseQuoteUnitOption({ requestedPosition: 2, unitOptions }).error, /pendiente de validación comercial/);
  assert.match(chooseQuoteUnitOption({ unitOptions }).error, /Elige la unidad/, "Con varias unidades hay que elegir");
  assert.match(chooseQuoteUnitOption({ requestedPosition: 3, unitOptions }).error, /no existe/);
  // El concepto ya cotizado conserva su unidad aunque no se reenvíe la posición.
  assert.deepEqual(chooseQuoteUnitOption({ quotedPosition: 1, unitOptions }), { option: unitOptions[0] });
  // Con una sola unidad no hace falta indicarla.
  assert.deepEqual(chooseQuoteUnitOption({ unitOptions: [unitOptions[0]] }), { option: unitOptions[0] });
});

test("contrato: unitOptions o el atajo de unidad, nunca ambos; tarifa por unidad opcional y texto comercial normalizado", () => {
  const base = { name: "Modelado 3D & Renders", referenceRate: "450" };
  const created = serviceCreateSchema.safeParse({ body: { ...base, unitOptions: [
    { measurementUnitId: 38, referenceRate: "450" }, { measurementUnitId: 39, presentationLabel: "  Por  Espacio " },
  ] } });
  assert.equal(created.success, true, JSON.stringify(created.error?.issues));
  assert.deepEqual(created.data.body.unitOptions.map((item) => [item.referenceRate, item.presentationLabel]), [["450.00", null], [null, "Por Espacio"]]);
  assert.deepEqual(errorPaths(serviceCreateSchema.safeParse({ body: base })), ["body.measurementUnitId"]);
  assert.deepEqual(
    errorPaths(serviceCreateSchema.safeParse({ body: { ...base, measurementUnitId: 38, unitOptions: [{ measurementUnitId: 38 }] } })),
    ["body.unitOptions"],
  );
  assert.deepEqual(errorPaths(serviceCreateSchema.safeParse({ body: { ...base, unitOptions: [] } })), ["body.unitOptions"]);
  assert.deepEqual(errorPaths(serviceCreateSchema.safeParse({ body: { ...base, unitOptions: [{ measurementUnitId: 38, referenceRate: "-1" }] } })), ["body.unitOptions.0.referenceRate"]);
  // La edición acepta solo unitOptions como cambio.
  const updated = serviceUpdateSchema.safeParse({ params: { serviceId: "2" }, body: { expectedVersion: 1, unitOptions: [{ measurementUnitId: 38 }] } });
  assert.equal(updated.success, true);
  // En la cotización, la posición de la unidad es opcional y acotada.
  const item = { quantity: "1", serviceId: 4, unitRate: "450" };
  assert.equal(quoteCreateSchema.safeParse({ body: { clientId: 3, items: [{ ...item, unitOptionPosition: 1 }], projectId: 9 } }).success, true);
  assert.deepEqual(errorPaths(quoteCreateSchema.safeParse({ body: { clientId: 3, items: [{ ...item, unitOptionPosition: 0 }], projectId: 9 } })), ["body.items.0.unitOptionPosition"]);
});
