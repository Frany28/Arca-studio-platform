import assert from "node:assert/strict";
import test from "node:test";

import { getServiceFormErrorFeedback } from "../src/pages/admin-services-quotes/service-catalog/utils/serviceCatalogErrors.js";
import {
  canonicalRate,
  createServiceDraft,
  filterDenominationsForBase,
  rateFromPastedText,
  rateFromTypedValue,
  toCreateServicePayload,
  toDenominationOption,
  toDenominationTag,
  toUpdateServiceChanges,
  validateServiceDraft,
} from "../src/pages/admin-services-quotes/service-catalog/utils/serviceFormValues.js";

const SERVICE = {
  id: 7,
  name: "Anteproyecto",
  kind: "turnkey",
  description: "Primera propuesta.",
  measurementUnit: { id: 1, code: "square_meter", symbol: "m²" },
  unitDenomination: { id: 10, denomination: "de construcción", isActive: true },
  referenceRate: "14.00",
  currentVersion: 3,
};
const VALID_DRAFT = { name: "Servicio", kind: "individual", description: "", measurementUnitId: 1, unitDenomination: null, referenceRate: "12.50" };
// Borrador con una unidad registrada (denominación), que es lo que exige el formulario.
const REGISTERED = { ...VALID_DRAFT, unitDenomination: { id: 10, denomination: "de construcción" } };
const M2 = { id: 1, code: "square_meter", symbol: "m²", name: "Metro cuadrado" };
const ML = { id: 6, code: "linear_meter", symbol: "m.l.", name: "Metro lineal" };
const REGISTERED_UNITS = [
  { id: 10, denomination: "de construcción", label: "m² de construcción", measurementUnit: M2 },
  { id: 11, denomination: "a intervenir", label: "m² a intervenir", measurementUnit: M2 },
  { id: 40, denomination: "de canalización", label: "m.l. de canalización", measurementUnit: ML },
];

test("borrador: vacío en el alta y con los datos guardados (sin convertir la tarifa) en la edición", () => {
  // El alta empieza sin modalidad: el administrador debe elegirla.
  assert.deepEqual(createServiceDraft(null), { name: "", kind: "", description: "", measurementUnitId: null, unitDenomination: null, referenceRate: "" });
  assert.deepEqual(createServiceDraft(SERVICE), {
    name: "Anteproyecto",
    kind: "turnkey",
    description: "Primera propuesta.",
    measurementUnitId: 1,
    unitDenomination: { id: 10, denomination: "de construcción" },
    referenceRate: "14.00",
  });
});

// Una sola unidad por servicio: cada forma de cobro es un servicio (importes ficticios).
const PROJECT = { id: 38, code: "project", symbol: "proy.", name: "Proyecto" };
const SPACE = { id: 39, code: "space", symbol: "esp.", name: "Espacio" };
const BASES = [{ id: 1, label: "m²", description: "Metro cuadrado" }, { id: 38, label: "proy.", description: "Proyecto" }, { id: 39, label: "esp.", description: "Espacio" }];
// «Permisología & Legal»: el texto comercial guardado lo conserva el backend; el formulario no lo edita.
const PERMITS = {
  ...SERVICE, kind: "individual", measurementUnit: PROJECT, name: "Permisología & Legal", presentationLabel: "Global por Proyecto",
  referenceRate: "510.00", unitDenomination: null, unitLabel: "Global por Proyecto",
};

test("una unidad: alta de una variante con la base sola y edición que conserva el texto comercial", () => {
  const space = { ...VALID_DRAFT, name: "Modelado 3D & Renders — Por espacio", measurementUnitId: SPACE.id, referenceRate: "320.00" };
  assert.deepEqual(validateServiceDraft(space, { availableBases: BASES, availableDenominations: [] }), {});
  assert.deepEqual(toCreateServicePayload(space), { name: "Modelado 3D & Renders — Por espacio", kind: "individual", measurementUnitId: 39, referenceRate: "320.00" });
  const draft = createServiceDraft(PERMITS);
  assert.equal("presentationLabel" in draft, false, "El borrador no edita el texto comercial");
  assert.equal(toUpdateServiceChanges(draft, PERMITS), null);
  // Cambiar otros campos no envía la unidad: el backend conserva «Global por Proyecto».
  assert.deepEqual(toUpdateServiceChanges({ ...draft, name: "Permisología & Legal (global)" }, PERMITS), { expectedVersion: 3, name: "Permisología & Legal (global)" });
  // Cambiar la unidad envía la base y la denominación (null), como exige el contrato.
  assert.deepEqual(toUpdateServiceChanges({ ...draft, measurementUnitId: SPACE.id }, PERMITS), { expectedVersion: 3, measurementUnitId: 39, unitDenominationId: null });
});

test("validación: campos obligatorios, límites del contrato y tarifa NUMERIC(14,2) sin signo", () => {
  assert.deepEqual(validateServiceDraft({ ...REGISTERED, name: "  ", kind: "", measurementUnitId: null, referenceRate: "" }), {
    name: "Escribe el nombre del servicio.",
    kind: "Elige la modalidad de contratación.",
    unit: "Elige la unidad de medida.",
    referenceRate: "Indica la tarifa.",
  });
  assert.ok(validateServiceDraft({ ...REGISTERED, name: "x".repeat(151) }).name);
  assert.ok(validateServiceDraft({ ...REGISTERED, description: "x".repeat(2001) }).description);
  for (const rate of ["0", "12", "12.5", "12.50", "999999999999.99"]) assert.deepEqual(validateServiceDraft({ ...REGISTERED, referenceRate: rate }), {}, rate);
  for (const rate of ["-1", "12.345", "1e3", "1,5", "1234567890123", "12."]) assert.ok(validateServiceDraft({ ...REGISTERED, referenceRate: rate }).referenceRate, rate);
});

test("modalidad: solo individual o turnkey, y ninguna restringe la unidad registrada", () => {
  for (const kind of ["", "bundle", undefined]) assert.equal(validateServiceDraft({ ...REGISTERED, kind }).kind, "Elige la modalidad de contratación.", String(kind));
  // Ambas modalidades admiten cualquier unidad registrada (m², m.l. o cualquier otra base).
  const withLinear = { ...REGISTERED, measurementUnitId: 6, unitDenomination: { id: 40, denomination: "de canalización" } };
  for (const kind of ["individual", "turnkey"]) {
    assert.deepEqual(validateServiceDraft({ ...REGISTERED, kind }), {}, kind);
    assert.deepEqual(validateServiceDraft({ ...withLinear, kind }), {}, kind);
  }
});

test("unidad: una base activa sin denominación es válida, como admite el backend; una base no disponible no", () => {
  assert.equal(validateServiceDraft(VALID_DRAFT).unit, undefined, "Una base sola es una unidad válida");
  assert.equal(validateServiceDraft(VALID_DRAFT, { availableBases: [{ id: 1 }] }).unit, undefined);
  assert.equal(validateServiceDraft(VALID_DRAFT, { availableBases: [{ id: 6 }] }).unit, "Elige una unidad base activa.");
  assert.equal(validateServiceDraft(VALID_DRAFT, { availableBases: [{ id: 6 }], preserveStoredUnit: true }).unit, undefined, "La base guardada se conserva");
  assert.deepEqual(validateServiceDraft(REGISTERED), {});
  // La base sola viaja sin denominación.
  assert.deepEqual(toCreateServicePayload({ ...VALID_DRAFT, measurementUnitId: 6 }), { name: "Servicio", kind: "individual", measurementUnitId: 6, referenceRate: "12.50" });
});

test("unidades registradas: sugerencias con símbolo", () => {
  assert.deepEqual(toDenominationOption(REGISTERED_UNITS[0]), { id: 10, label: "m² de construcción", avatar: false, closeIcon: true });
  assert.equal(toDenominationOption({ id: 5, denomination: "de obra", measurementUnit: M2 }).label, "m² de obra", "Sin label, compone símbolo y texto");
});

test("denominaciones: sin base no hay opciones y el filtro usa identificadores, no símbolos", () => {
  const sameSymbol = { id: 77, denomination: "otra base", isActive: true, measurementUnit: { ...M2, id: 99 } };
  const inactive = { ...REGISTERED_UNITS[0], id: 90, isActive: false };
  const catalog = [...REGISTERED_UNITS, sameSymbol, inactive];
  assert.deepEqual(filterDenominationsForBase(catalog, null), []);
  assert.deepEqual(filterDenominationsForBase(catalog, undefined), []);
  assert.deepEqual(filterDenominationsForBase(catalog, 1).map((item) => item.id), [10, 11]);
  assert.deepEqual(filterDenominationsForBase(catalog, 6).map((item) => item.id), [40]);
  assert.deepEqual(filterDenominationsForBase(catalog, 99).map((item) => item.id), [77]);
  assert.deepEqual(filterDenominationsForBase(catalog, 30), [], "Base sin denominaciones activas");
  assert.deepEqual(filterDenominationsForBase(null, 1), []);
});

test("tarifa: comparación canónica como texto, sin Number", () => {
  assert.equal(canonicalRate("12.00"), "12");
  assert.equal(canonicalRate("012.50"), "12.5");
  assert.equal(canonicalRate("0.00"), "0");
  assert.equal(canonicalRate("999999999999.99"), "999999999999.99");
});

test("alta: con la modalidad elegida, sin código, sin descripción vacía y con la tarifa tal como se escribió", () => {
  assert.deepEqual(toCreateServicePayload({ ...VALID_DRAFT, name: "  Servicio  ", description: "   ", referenceRate: " 12.50 " }), {
    name: "Servicio", kind: "individual", measurementUnitId: 1, referenceRate: "12.50",
  });
  assert.deepEqual(toCreateServicePayload({ ...VALID_DRAFT, kind: "turnkey", description: " Texto ", unitDenomination: { id: 10 } }), {
    name: "Servicio", kind: "turnkey", description: "Texto", measurementUnitId: 1, unitDenominationId: 10, referenceRate: "12.50",
  });
  assert.equal("code" in toCreateServicePayload(VALID_DRAFT), false);
});

test("edición: solo campos cambiados con expectedVersion; la base arrastra la denominación", () => {
  const draft = createServiceDraft(SERVICE);
  assert.equal(toUpdateServiceChanges(draft, SERVICE), null, "Sin cambios no hay petición");
  assert.equal(toUpdateServiceChanges({ ...draft, referenceRate: "14" }, SERVICE), null, "14 equivale a 14.00");
  assert.deepEqual(toUpdateServiceChanges({ ...draft, referenceRate: "15.5" }, SERVICE), { expectedVersion: 3, referenceRate: "15.5" });
  assert.deepEqual(toUpdateServiceChanges({ ...draft, description: "  " }, SERVICE), { expectedVersion: 3, description: null });
  assert.deepEqual(toUpdateServiceChanges({ ...draft, unitDenomination: null }, SERVICE), { expectedVersion: 3, unitDenominationId: null });
  assert.deepEqual(toUpdateServiceChanges({ ...draft, measurementUnitId: 13, unitDenomination: { id: 20 } }, SERVICE), {
    expectedVersion: 3, measurementUnitId: 13, unitDenominationId: 20,
  });
  // Una descripción guardada con espacios exteriores no cuenta como cambio.
  assert.equal(toUpdateServiceChanges(draft, { ...SERVICE, description: " Primera propuesta. " }), null);
  // La modalidad precargada no viaja; solo un cambio explícito la envía.
  assert.equal("kind" in (toUpdateServiceChanges({ ...draft, name: "Otro" }, SERVICE) ?? {}), false);
  assert.deepEqual(toUpdateServiceChanges({ ...draft, kind: "individual" }, SERVICE), { expectedVersion: 3, kind: "individual" });
});

test("unidad: la denominación se muestra como Tag sin avatar y con cierre", () => {
  assert.deepEqual(toDenominationTag({ id: 10, denomination: "de construcción" }), { id: 10, label: "de construcción", avatar: false, closeIcon: true });
});

test("errores del formulario: 400 por campo, 409 explicados y recarga ante versión desactualizada", () => {
  const validation = getServiceFormErrorFeedback({ status: 400, code: "VALIDATION_ERROR", fields: { "body.referenceRate": "Tarifa inválida.", "body.unitDenominationId": "Denominación inactiva.", "body.kind": "Modalidad inválida." } }, "x");
  assert.deepEqual(validation.fieldErrors, { referenceRate: "Tarifa inválida.", unit: "Denominación inactiva.", kind: "Modalidad inválida." });
  assert.equal(validation.message, "Revisa los datos marcados.");
  const conflict = getServiceFormErrorFeedback({ status: 409, code: "SERVICE_VERSION_CONFLICT", message: "x" }, "x");
  assert.equal(conflict.shouldReload, true);
  assert.match(conflict.message, /Otro administrador/);
  assert.deepEqual(getServiceFormErrorFeedback({ status: 409, code: "SERVICE_REFERENCE_CONFLICT", message: "Ya no disponible." }, "x").fieldErrors, { unit: "Ya no disponible." });
  const missing = getServiceFormErrorFeedback({ status: 404, code: "SERVICE_NOT_FOUND" }, "x");
  assert.deepEqual([missing.notFound, missing.shouldReload], [true, true]);
  assert.equal(getServiceFormErrorFeedback({ status: 429 }, "x").message, "Realizaste demasiados cambios en poco tiempo. Espera unos minutos e inténtalo de nuevo.");
  assert.equal(getServiceFormErrorFeedback({ status: 500, message: "" }, "No se pudo guardar el servicio.").message, "No se pudo guardar el servicio.");
});

test("la tarifa se escribe como en una caja registradora: los dígitos entran por la derecha", () => {
  let rate = "";
  const typed = [];
  for (const digit of "100") {
    rate = rateFromTypedValue(`${rate}${digit}`, rate);
    typed.push(rate);
  }
  assert.deepEqual(typed, ["0.01", "0.10", "1.00"]);
  // Borrar quita el último dígito y vaciarlo deja el campo vacío.
  assert.equal(rateFromTypedValue("1.0", "1.00"), "0.10");
  assert.equal(rateFromTypedValue("0.0", "0.01"), "");
  // Editar una tarifa guardada continúa desde ella; letras y signos se ignoran.
  assert.equal(rateFromTypedValue("12.005", "12.00"), "120.05");
  assert.equal(rateFromTypedValue("1.00a-", "1.00"), "1.00");
  // Tope de NUMERIC(14,2): un dígito más conserva la tarifa anterior.
  assert.equal(rateFromTypedValue("999999999999.99", "99999999999.99"), "999999999999.99");
  assert.equal(rateFromTypedValue("999999999999.991", "999999999999.99"), "999999999999.99");
  for (const value of typed) assert.deepEqual(validateServiceDraft({ ...createServiceDraft(null), referenceRate: value }).referenceRate, undefined);
});

test("pegar una tarifa la interpreta como importe o, si no lo es, por sus dígitos", () => {
  assert.equal(rateFromPastedText("12.5", "3.00"), "12.50");
  assert.equal(rateFromPastedText(" 1250 ", ""), "1250.00");
  assert.equal(rateFromPastedText("007.05", ""), "7.05");
  assert.equal(rateFromPastedText("$1,250.50", ""), "1250.50");
  assert.equal(rateFromPastedText("abc", "3.00"), "");
  assert.equal(rateFromPastedText("1234567890123456", "3.00"), "3.00");
});
