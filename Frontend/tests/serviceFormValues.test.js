import assert from "node:assert/strict";
import test from "node:test";

import { getServiceFormErrorFeedback } from "../src/pages/admin-services-quotes/service-catalog/utils/serviceCatalogErrors.js";
import {
  canonicalRate,
  changeDraftKind,
  createServiceDraft,
  filterBaseOptionsForKind,
  isBaseUnitAllowedForKind,
  rateFromPastedText,
  rateFromTypedValue,
  toCreateServicePayload,
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
  referenceRate: "12.00",
  currentVersion: 3,
};
const VALID_DRAFT = { name: "Servicio", kind: "individual", description: "", measurementUnitId: 1, unitDenomination: null, referenceRate: "12.50" };
const BASE_OPTIONS = [
  { id: 1, code: "square_meter", label: "m²" },
  { id: 6, code: "linear_meter", label: "m.l." },
  { id: 30, code: "point", label: "pto." },
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
    referenceRate: "12.00",
  });
});

test("validación: campos obligatorios, límites del contrato y tarifa NUMERIC(14,2) sin signo", () => {
  assert.deepEqual(validateServiceDraft({ ...VALID_DRAFT, name: "  ", kind: "", measurementUnitId: null, referenceRate: "" }), {
    name: "Escribe el nombre del servicio.",
    kind: "Elige la modalidad de contratación.",
    unit: "Elige la unidad de medida.",
    referenceRate: "Indica la tarifa.",
  });
  assert.ok(validateServiceDraft({ ...VALID_DRAFT, name: "x".repeat(151) }).name);
  assert.ok(validateServiceDraft({ ...VALID_DRAFT, description: "x".repeat(2001) }).description);
  for (const rate of ["0", "12", "12.5", "12.50", "999999999999.99"]) assert.deepEqual(validateServiceDraft({ ...VALID_DRAFT, referenceRate: rate }), {}, rate);
  for (const rate of ["-1", "12.345", "1e3", "1,5", "1234567890123", "12."]) assert.ok(validateServiceDraft({ ...VALID_DRAFT, referenceRate: rate }).referenceRate, rate);
});

test("modalidad: solo individual o turnkey, y llave en mano exige la base m² por su código", () => {
  for (const kind of ["individual", "turnkey"]) assert.deepEqual(validateServiceDraft({ ...VALID_DRAFT, kind }, { unitCode: "square_meter" }), {}, kind);
  for (const kind of ["", "bundle", undefined]) assert.equal(validateServiceDraft({ ...VALID_DRAFT, kind }).kind, "Elige la modalidad de contratación.", String(kind));
  // Individual admite cualquier unidad; llave en mano, solo square_meter (nunca por el símbolo).
  assert.deepEqual(validateServiceDraft({ ...VALID_DRAFT, measurementUnitId: 6 }, { unitCode: "linear_meter" }), {});
  assert.equal(validateServiceDraft({ ...VALID_DRAFT, kind: "turnkey", measurementUnitId: 6 }, { unitCode: "linear_meter" }).unit, "Llave en mano requiere una unidad en metros cuadrados (m²).");
  assert.ok(validateServiceDraft({ ...VALID_DRAFT, kind: "turnkey" }, { unitCode: undefined }).unit, "Sin código conocido no se acepta");
  assert.equal(isBaseUnitAllowedForKind("turnkey", "metro_cuadrado"), false);
  assert.equal(isBaseUnitAllowedForKind("individual", "point"), true);
  assert.deepEqual(filterBaseOptionsForKind(BASE_OPTIONS, "turnkey").map((option) => option.label), ["m²"]);
  assert.equal(filterBaseOptionsForKind(BASE_OPTIONS, "individual"), BASE_OPTIONS);
  assert.equal(filterBaseOptionsForKind(BASE_OPTIONS, ""), BASE_OPTIONS);
});

test("modalidad: al cambiarla se conserva la unidad compatible y se retira la incompatible", () => {
  const withLinear = { ...VALID_DRAFT, measurementUnitId: 6, unitDenomination: { id: 40, denomination: "de canalización" } };
  assert.deepEqual(changeDraftKind(withLinear, "turnkey", BASE_OPTIONS), { kind: "turnkey", measurementUnitId: null, unitDenomination: null });
  const withSquare = { ...VALID_DRAFT, unitDenomination: { id: 10, denomination: "de construcción" } };
  assert.deepEqual(changeDraftKind(withSquare, "turnkey", BASE_OPTIONS), { kind: "turnkey" });
  assert.deepEqual(changeDraftKind({ ...withLinear, kind: "turnkey" }, "individual", BASE_OPTIONS), { kind: "individual" });
  assert.deepEqual(changeDraftKind({ ...VALID_DRAFT, measurementUnitId: null }, "turnkey", BASE_OPTIONS), { kind: "turnkey" });
  // Una base desconocida no se da por compatible con llave en mano.
  assert.deepEqual(changeDraftKind({ ...VALID_DRAFT, measurementUnitId: 99 }, "turnkey", BASE_OPTIONS), { kind: "turnkey", measurementUnitId: null, unitDenomination: null });
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
  assert.equal(toUpdateServiceChanges({ ...draft, referenceRate: "12" }, SERVICE), null, "12 equivale a 12.00");
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
