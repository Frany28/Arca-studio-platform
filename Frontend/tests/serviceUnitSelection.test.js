import assert from "node:assert/strict";
import test from "node:test";

import { createServiceDraft, validateServiceDraft, toUpdateServiceChanges } from "../src/pages/admin-services-quotes/service-catalog/utils/serviceFormValues.js";
import {
  filterServiceUnitOptions, getServiceUnitCatalog, groupServiceUnitOptions, normalizeUnitSearchText, preservesServiceUnit, resolveSelectedUnitSymbol, toServiceUnitOption,
} from "../src/pages/admin-services-quotes/service-catalog/utils/serviceUnitSelection.js";

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
  const catalog = getServiceUnitCatalog(BASES, DENOMINATIONS);
  assert.deepEqual(catalog.prefixOptions.map((base) => base.id), [1, 2]);
  assert.deepEqual(catalog.denominations.map((item) => item.id), [10, 20]);
  assert.deepEqual(getServiceUnitCatalog(BASES, []), { prefixOptions: [], denominations: [] });
  assert.deepEqual(getServiceUnitCatalog([], DENOMINATIONS), { prefixOptions: [], denominations: [] });
  assert.deepEqual(getServiceUnitCatalog(BASES.filter((base) => base.id !== 2), DENOMINATIONS).prefixOptions.map((base) => base.id), [1]);
});

test("catálogo común: filtra por id de base y estado, no por el símbolo", () => {
  const catalog = getServiceUnitCatalog(BASES.map((base) => ({ ...base, label: "m²" })), DENOMINATIONS);
  assert.deepEqual(catalog.prefixOptions.map((base) => base.id), [1, 2]);
  assert.deepEqual(catalog.denominations.map((item) => item.id), [10, 20]);
});

test("históricos: conservar una base o denominación inactiva no obliga a cambiarlas ni reenviarlas", () => {
  for (const service of [SERVICE, { ...SERVICE, unitDenomination: null },
    { ...SERVICE, unitDenomination: { ...SERVICE.unitDenomination, isActive: false } },
    { ...SERVICE, measurementUnit: { id: 1, isActive: false } },
    { ...SERVICE, kind: "turnkey", measurementUnit: { id: 99, code: "other", isActive: false } }]) {
    const draft = createServiceDraft(service);
    assert.equal(preservesServiceUnit(draft, service), true);
    assert.deepEqual(validateServiceDraft(draft, { availableDenominations: [], preserveStoredUnit: preservesServiceUnit(draft, service) }), {});
    assert.deepEqual(toUpdateServiceChanges({ ...draft, name: "Editado" }, service), { expectedVersion: 3, name: "Editado" });
    assert.equal(toUpdateServiceChanges(draft, service), null);
  }
  assert.equal(preservesServiceUnit(createServiceDraft(null), null), false);
});

test("nuevas asignaciones: exigen denominación activa de esa base; cambiar la modalidad conserva la unidad", () => {
  const draft = createServiceDraft(SERVICE);
  for (const patch of [{ measurementUnitId: 2 }, { unitDenomination: { id: 30, denomination: "de archivo" } }]) {
    assert.equal(preservesServiceUnit({ ...draft, ...patch }, SERVICE), false);
  }
  assert.ok(validateServiceDraft({ ...draft, measurementUnitId: 2 }, { availableDenominations: DENOMINATIONS }).unit);
  assert.ok(validateServiceDraft({ ...draft, measurementUnitId: 3, unitDenomination: DENOMINATIONS[2] }, { availableDenominations: DENOMINATIONS }).unit);
  assert.ok(validateServiceDraft({ ...draft, measurementUnitId: 4, unitDenomination: DENOMINATIONS[3] }, { availableDenominations: DENOMINATIONS }).unit);
  // Llave en mano admite la unidad de otra base («de recorrido», base 2) igual que individual.
  const withOtherBase = { ...draft, measurementUnitId: 2, unitDenomination: DENOMINATIONS[1] };
  for (const kind of ["individual", "turnkey"]) assert.deepEqual(validateServiceDraft({ ...withOtherBase, kind }, { availableDenominations: DENOMINATIONS }), {}, kind);
  assert.deepEqual(validateServiceDraft({ ...draft, kind: "turnkey" }, { availableDenominations: [], preserveStoredUnit: true }), {},
    "Cambiar modalidad sin reasignar una unidad histórica no obliga a activarla");
  assert.deepEqual(validateServiceDraft(draft, { availableDenominations: DENOMINATIONS }), {});
});

const UNIT_OPTIONS = [
  { id: 1, denomination: "de construcción", label: "m² de construcción", measurementUnit: { id: 1, symbol: "m²", name: "Metro cuadrado" } },
  { id: 2, denomination: "de área", measurementUnit: { id: 1, symbol: "m²", name: "Metro cuadrado" } },
  { id: 3, denomination: "de recorrido", label: "m.l. de recorrido", measurementUnit: { id: 2, symbol: "m.l.", name: "Metro lineal" } },
  { id: 4, denomination: "de visita técnica", label: "h de visita técnica", measurementUnit: { id: 3, symbol: "h", name: "Hora" } },
].map(toServiceUnitOption);

test("combobox de unidad: la opción deriva símbolo, categoría y base de la denominación", () => {
  const [first, second] = UNIT_OPTIONS;
  assert.equal(first.symbol, "m²");
  assert.equal(first.category, "de construcción");
  assert.equal(first.baseName, "Metro cuadrado");
  // Sin etiqueta del backend se compone símbolo + categoría.
  assert.equal(second.label, "m² de área");
});

test("combobox de unidad: busca por símbolo, categoría o base sin distinguir mayúsculas ni acentos", () => {
  const ids = (query) => filterServiceUnitOptions(UNIT_OPTIONS, query).map((option) => option.id);
  assert.deepEqual(ids(""), [1, 2, 3, 4], "Sin texto se ofrecen todas en el orden del catálogo");
  assert.deepEqual(ids("   "), [1, 2, 3, 4]);
  assert.deepEqual(ids("CONSTRUCCION"), [1]);
  assert.deepEqual(ids("tecnica"), [4]);
  assert.deepEqual(ids("m2"), [1, 2], "El superíndice se encuentra escribiendo la cifra");
  assert.deepEqual(ids("m²"), [1, 2]);
  assert.deepEqual(ids("lineal"), [3]);
  assert.deepEqual(ids("cuadrado área"), [2], "Cada palabra debe coincidir, en cualquier orden");
  assert.deepEqual(ids("volumen"), []);
});

test("combobox de unidad: agrupa por unidad base en el orden del catálogo y solo con resultados", () => {
  const summary = (options) => groupServiceUnitOptions(options).map((group) => [group.title, group.options.map((option) => option.id)]);
  // Una base intercalada se reúne en su grupo, que conserva su primera posición.
  const interleaved = [UNIT_OPTIONS[0], UNIT_OPTIONS[2], UNIT_OPTIONS[1], UNIT_OPTIONS[3]];
  assert.deepEqual(summary(interleaved), [["Metro cuadrado (m²)", [1, 2]], ["Metro lineal (m.l.)", [3]], ["Hora (h)", [4]]]);
  assert.deepEqual(summary(filterServiceUnitOptions(UNIT_OPTIONS, "lineal")), [["Metro lineal (m.l.)", [3]]]);
  assert.deepEqual(summary([]), []);
  // Sin nombre de base, el encabezado es el símbolo.
  assert.deepEqual(summary([toServiceUnitOption({ id: 9, denomination: "de obra", measurementUnit: { id: 7, symbol: "u" } })]), [["u", [9]]]);
});

test("combobox de unidad: normalización de la búsqueda", () => {
  assert.equal(normalizeUnitSearchText("  Metro   Cuadrádo ²  "), "metro cuadrado 2");
  assert.equal(normalizeUnitSearchText(null), "");
});

test("combobox de unidad: el símbolo se deriva de los ids del borrador aunque falte la base en su catálogo", () => {
  const denominations = [{ id: 1, measurementUnit: { id: 1, symbol: "m²" } }];
  const selection = { measurementUnitId: 1, unitDenomination: { id: 1 } };
  assert.equal(resolveSelectedUnitSymbol({ ...selection, denominations, selectedBaseOption: { id: 1, label: "m²" } }), "m²");
  assert.equal(resolveSelectedUnitSymbol({ ...selection, denominations, selectedBaseOption: null }), "m²", "Catálogo de bases sin cargar");
  assert.equal(resolveSelectedUnitSymbol({ ...selection, denominations: [], selectedBaseOption: { id: 1, label: "m²" } }), "m²", "Base histórica");
  assert.equal(resolveSelectedUnitSymbol({ denominations, measurementUnitId: null, selectedBaseOption: null, unitDenomination: null }), "");
  // Una denominación de otra base nunca aporta su símbolo.
  assert.equal(resolveSelectedUnitSymbol({ denominations, measurementUnitId: 2, selectedBaseOption: null, unitDenomination: { id: 1 } }), "");
});
