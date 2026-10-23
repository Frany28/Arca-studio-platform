import assert from "node:assert/strict";
import test from "node:test";

import { createServiceDraft, validateServiceDraft, toUpdateServiceChanges } from "../src/pages/admin-services-quotes/service-catalog/utils/serviceFormValues.js";
import { getServiceUnitCatalog, preservesServiceUnit } from "../src/pages/admin-services-quotes/service-catalog/utils/serviceUnitSelection.js";

const BASES = Array.from({ length: 48 }, (_, index) => ({ id: index + 1, code: index === 0 ? "square_meter" : "other", label: `base-${index + 1}` }));
const DENOMINATIONS = [
  { id: 10, isActive: true, denomination: "de obra", measurementUnit: { id: 1, code: "square_meter", isActive: true } },
  { id: 20, isActive: true, denomination: "de recorrido", measurementUnit: { id: 2, code: "other", isActive: true } },
  { id: 30, isActive: false, denomination: "de archivo", measurementUnit: { id: 3, isActive: true } },
  { id: 40, isActive: true, denomination: "base inactiva", measurementUnit: { id: 4, isActive: false } },
];
const SERVICE = { name: "Servicio", kind: "individual", description: "", measurementUnit: { id: 1 },
  unitDenomination: { id: 10, denomination: "de obra", isActive: true }, referenceRate: "12.00", currentVersion: 3 };

test("catálogo común: 48 bases solo ofrecen las que tienen denominaciones y base activas", () => {
  const catalog = getServiceUnitCatalog(BASES, DENOMINATIONS, "individual");
  assert.deepEqual(catalog.prefixOptions.map((base) => base.id), [1, 2]);
  assert.deepEqual(catalog.denominations.map((item) => item.id), [10, 20]);
  assert.deepEqual(getServiceUnitCatalog(BASES, [], "individual"), { prefixOptions: [], denominations: [] });
  assert.deepEqual(getServiceUnitCatalog([], DENOMINATIONS, "individual"), { prefixOptions: [], denominations: [] });
  assert.deepEqual(getServiceUnitCatalog(BASES.filter((base) => base.id !== 2), DENOMINATIONS, "individual").prefixOptions.map((base) => base.id), [1]);
});

test("catálogo común: llave en mano filtra por código estable e id, no por el símbolo", () => {
  const catalog = getServiceUnitCatalog(BASES.map((base) => ({ ...base, label: "m²" })), DENOMINATIONS, "turnkey");
  assert.deepEqual(catalog.prefixOptions.map((base) => base.id), [1]);
  assert.deepEqual(catalog.denominations.map((item) => item.id), [10]);
});

test("históricos: conservar una base o denominación inactiva no obliga a cambiarlas ni reenviarlas", () => {
  for (const service of [SERVICE, { ...SERVICE, unitDenomination: null },
    { ...SERVICE, unitDenomination: { ...SERVICE.unitDenomination, isActive: false } },
    { ...SERVICE, measurementUnit: { id: 1, isActive: false } },
    { ...SERVICE, kind: "turnkey", measurementUnit: { id: 99, code: "other", isActive: false } }]) {
    const draft = createServiceDraft(service);
    assert.equal(preservesServiceUnit(draft, service), true);
    assert.deepEqual(validateServiceDraft(draft, { availableDenominations: [], originalKind: service.kind, preserveStoredUnit: preservesServiceUnit(draft, service), unitCode: service.measurementUnit.code }), {});
    assert.deepEqual(toUpdateServiceChanges({ ...draft, name: "Editado" }, service), { expectedVersion: 3, name: "Editado" });
    assert.equal(toUpdateServiceChanges(draft, service), null);
  }
  assert.equal(preservesServiceUnit(createServiceDraft(null), null), false);
});

test("nuevas asignaciones: exigen denominación activa de esa base y revalidan cambios de modalidad", () => {
  const draft = createServiceDraft(SERVICE);
  for (const patch of [{ measurementUnitId: 2 }, { unitDenomination: { id: 30, denomination: "de archivo" } }]) {
    assert.equal(preservesServiceUnit({ ...draft, ...patch }, SERVICE), false);
  }
  assert.ok(validateServiceDraft({ ...draft, measurementUnitId: 2 }, { availableDenominations: DENOMINATIONS }).unit);
  assert.ok(validateServiceDraft({ ...draft, measurementUnitId: 3, unitDenomination: DENOMINATIONS[2] }, { availableDenominations: DENOMINATIONS }).unit);
  assert.ok(validateServiceDraft({ ...draft, measurementUnitId: 4, unitDenomination: DENOMINATIONS[3] }, { availableDenominations: DENOMINATIONS }).unit);
  assert.ok(validateServiceDraft({ ...draft, kind: "turnkey" }, { availableDenominations: DENOMINATIONS, unitCode: "other" }).unit);
  assert.deepEqual(validateServiceDraft({ ...draft, kind: "turnkey" }, { availableDenominations: [], originalKind: "individual", preserveStoredUnit: true, unitCode: "square_meter" }), {},
    "Cambiar modalidad sin reasignar una unidad histórica compatible no obliga a activarla");
  assert.ok(validateServiceDraft({ ...draft, kind: "turnkey" }, { availableDenominations: [], originalKind: "individual", preserveStoredUnit: true, unitCode: "other" }).unit);
  assert.deepEqual(validateServiceDraft(draft, { availableDenominations: DENOMINATIONS }), {});
});
