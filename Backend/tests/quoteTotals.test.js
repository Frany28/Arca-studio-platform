import assert from "node:assert/strict";
import test from "node:test";

import { QUOTE_DECIMAL_FORMATS, calculateQuoteTotals } from "../src/domain/quoteTotals.js";
import { ValidationError } from "../src/errors/appError.js";

// Ejemplos tomados de la Propuesta de Servicios y Tabulador 2025, versión 3.2. Las tarifas
// son datos de prueba: el motor las recibe como parámetros y no contiene el tabulador.
const ANTEPROYECTO_M2 = { quantity: "200", unitRate: "12" };
const CANALIZACIONES_ML = { quantity: "120", unitRate: "12" };
const PUNTOS_ELECTRICOS = { quantity: "35", unitRate: "45" };
const MODELADO_3D_PROYECTO = { quantity: "1", unitRate: "450" };
const LLAVE_EN_MANO_PREMIUM_M2 = { quantity: "150", unitRate: "900" };

const VAT_DISABLED = { enabled: false };
const VAT_16 = { enabled: true, rate: "16" };
const MAX_AMOUNT = "999999999999.99";

/**
 * Calcula una cotización con el IVA referencial indicado (deshabilitado por defecto).
 *
 * @param {Array<object>} items - Conceptos con cantidad y tarifa aplicada.
 * @param {object} [referenceVat] - Configuración del IVA referencial.
 * @returns {object} Resultado del motor.
 */
function calculate(items, referenceVat = VAT_DISABLED) {
  return calculateQuoteTotals({ items, referenceVat });
}

/**
 * Comprueba que el cálculo falla con ValidationError y exactamente los campos indicados.
 *
 * @param {Function} run - Cálculo que debe fallar.
 * @param {Array<string>} expectedFields - Rutas de campo esperadas.
 * @returns {void}
 */
function assertInvalidFields(run, expectedFields) {
  assert.throws(run, (error) => {
    assert.ok(error instanceof ValidationError);
    assert.equal(error.code, "VALIDATION_ERROR");
    assert.equal(error.status, 400);
    assert.deepEqual(Object.keys(error.fields).sort(), [...expectedFields].sort());
    return true;
  });
}

/**
 * Convierte un importe de texto con dos decimales a centésimas para comparar sumas exactas.
 *
 * @param {string} amount - Importe "1234.56".
 * @returns {bigint} Importe en centésimas.
 */
function toCents(amount) {
  return BigInt(amount.replace(".", ""));
}

test("v3.2: servicio por metro cuadrado (anteproyecto, 200 m² × 12 USD)", () => {
  assert.equal(calculate([ANTEPROYECTO_M2]).items[0].subtotal, "2400.00");
});

test("v3.2: servicio por metro lineal (canalizaciones, 120 ml × 12 USD)", () => {
  assert.equal(calculate([CANALIZACIONES_ML]).items[0].subtotal, "1440.00");
});

test("v3.2: servicio por punto (puntos eléctricos, 35 × 45 USD)", () => {
  assert.equal(calculate([PUNTOS_ELECTRICOS]).items[0].subtotal, "1575.00");
});

test("v3.2: servicio por proyecto con tarifa fija usa la misma multiplicación (1 × 450 USD)", () => {
  assert.equal(calculate([MODELADO_3D_PROYECTO]).items[0].subtotal, "450.00");
});

test("v3.2: modalidad llave en mano premium por m² (150 m² × 900 USD)", () => {
  assert.equal(calculate([LLAVE_EN_MANO_PREMIUM_M2]).items[0].subtotal, "135000.00");
});

test("cotización con múltiples servicios: subtotales en orden, total e IVA referencial", () => {
  const result = calculate([ANTEPROYECTO_M2, CANALIZACIONES_ML, PUNTOS_ELECTRICOS, MODELADO_3D_PROYECTO], VAT_16);

  assert.deepEqual(result, {
    items: [
      { quantity: "200.000", subtotal: "2400.00", unitRate: "12.00" },
      { quantity: "120.000", subtotal: "1440.00", unitRate: "12.00" },
      { quantity: "35.000", subtotal: "1575.00", unitRate: "45.00" },
      { quantity: "1.000", subtotal: "450.00", unitRate: "450.00" },
    ],
    servicesTotal: "5865.00",
    referenceVat: { amount: "938.40", enabled: true, isReferenceOnly: true, rate: "16.00" },
    estimatedTotalWithVat: "6803.40",
  });
});

test("admite cantidades decimales sin redondearlas", () => {
  const result = calculate([
    { quantity: "87.5", unitRate: "12" },
    { quantity: "45.75", unitRate: "12" },
    { quantity: "0.333", unitRate: "10" },
  ]);

  assert.deepEqual(result.items.map(({ quantity, subtotal }) => [quantity, subtotal]), [
    ["87.500", "1050.00"],
    ["45.750", "549.00"],
    ["0.333", "3.33"],
  ]);
  assert.equal(result.servicesTotal, "1602.33");
});

test("redondea cada subtotal a dos decimales con la mitad hacia arriba", () => {
  const result = calculate([
    { quantity: "1.005", unitRate: "1" }, // 1.005 → 1.01 (toFixed en coma flotante daría 1.00)
    { quantity: "0.5", unitRate: "0.01" }, // 0.005 → 0.01
    { quantity: "0.004", unitRate: "1" }, // 0.004 → 0.00
    { quantity: "2.345", unitRate: "3.33" }, // 7.80885 → 7.81
    { quantity: "1.5", unitRate: "0.01" }, // 0.015 → 0.02
  ]);

  assert.deepEqual(result.items.map((item) => item.subtotal), ["1.01", "0.01", "0.00", "7.81", "0.02"]);
});

test("el total se calcula después de redondear cada subtotal", () => {
  // Sin redondeo previo: 3 × 0.005 = 0.015 → 0.02. Redondeando cada línea: 3 × 0.01 = 0.03.
  const result = calculate([
    { quantity: "0.5", unitRate: "0.01" },
    { quantity: "0.5", unitRate: "0.01" },
    { quantity: "0.5", unitRate: "0.01" },
  ]);
  assert.equal(result.servicesTotal, "0.03");
});

test("precisión decimal: los resultados no dependen de la coma flotante binaria", () => {
  assert.notEqual(0.1 * 0.2, 0.02);
  assert.notEqual(0.1 + 0.2, 0.3);

  assert.equal(calculate([{ quantity: "0.1", unitRate: "0.20" }]).items[0].subtotal, "0.02");
  assert.equal(calculate([{ quantity: "1.1", unitRate: "1.10" }]).items[0].subtotal, "1.21");
  assert.equal(calculate([{ quantity: 0.1, unitRate: 1 }, { quantity: 0.2, unitRate: 1 }]).servicesTotal, "0.30");
  assert.equal(calculate(Array.from({ length: 10 }, () => ({ quantity: "0.1", unitRate: "1" }))).servicesTotal, "1.00");
});

test("IVA referencial habilitado: se identifica como estimación y redondea a dos decimales", () => {
  const result = calculate([ANTEPROYECTO_M2], VAT_16);
  assert.deepEqual(result.referenceVat, { amount: "384.00", enabled: true, isReferenceOnly: true, rate: "16.00" });
  assert.equal(result.servicesTotal, "2400.00");
  assert.equal(result.estimatedTotalWithVat, "2784.00");

  assert.equal(calculate([{ quantity: "1", unitRate: "10.03" }], VAT_16).referenceVat.amount, "1.60"); // 1.6048
  assert.equal(calculate([{ quantity: "1", unitRate: "0.05" }], { enabled: true, rate: "10" }).referenceVat.amount, "0.01"); // 0.005
  assert.equal(calculate([ANTEPROYECTO_M2], { enabled: true, rate: "12.5" }).referenceVat.amount, "300.00");
});

test("IVA referencial deshabilitado: no altera el total de servicios", () => {
  const result = calculate([ANTEPROYECTO_M2], VAT_DISABLED);
  assert.deepEqual(result.referenceVat, { amount: "0.00", enabled: false, isReferenceOnly: true, rate: null });
  assert.equal(result.estimatedTotalWithVat, "2400.00");

  // La tasa configurada puede conservarse sin aplicarse.
  const withConfiguredRate = calculate([ANTEPROYECTO_M2], { enabled: false, rate: "16" });
  assert.equal(withConfiguredRate.referenceVat.rate, "16.00");
  assert.equal(withConfiguredRate.referenceVat.amount, "0.00");
  assert.equal(withConfiguredRate.estimatedTotalWithVat, "2400.00");
});

test("IVA referencial con tasa 0 %", () => {
  const result = calculate([ANTEPROYECTO_M2], { enabled: true, rate: "0" });
  assert.deepEqual(result.referenceVat, { amount: "0.00", enabled: true, isReferenceOnly: true, rate: "0.00" });
  assert.equal(result.estimatedTotalWithVat, "2400.00");
});

test("acepta los extremos de la tasa de IVA y rechaza tasas inválidas", () => {
  assert.equal(calculate([ANTEPROYECTO_M2], { enabled: true, rate: "100" }).estimatedTotalWithVat, "4800.00");

  for (const rate of ["-1", -0.01, "100.01", 101, "abc", "16.555", NaN, Infinity, null, undefined, ""]) {
    assertInvalidFields(() => calculate([ANTEPROYECTO_M2], { enabled: true, rate }), ["referenceVat.rate"]);
  }
  assertInvalidFields(() => calculate([ANTEPROYECTO_M2], { enabled: false, rate: "101" }), ["referenceVat.rate"]);
  assertInvalidFields(() => calculate([ANTEPROYECTO_M2], { enabled: "true", rate: "16" }), ["referenceVat.enabled"]);
  assertInvalidFields(() => calculate([ANTEPROYECTO_M2], { rate: "16" }), ["referenceVat.enabled"]);
  for (const referenceVat of [undefined, null, true, "16", []]) {
    assertInvalidFields(() => calculateQuoteTotals({ items: [ANTEPROYECTO_M2], referenceVat }), ["referenceVat"]);
  }
});

test("rechaza tarifas negativas y admite tarifa cero", () => {
  assertInvalidFields(() => calculate([{ quantity: "1", unitRate: "-12" }]), ["items.0.unitRate"]);
  assertInvalidFields(() => calculate([{ quantity: "1", unitRate: -0.01 }]), ["items.0.unitRate"]);
  assert.equal(calculate([{ quantity: "3", unitRate: "0" }]).items[0].subtotal, "0.00");
});

test("rechaza cantidades iguales a cero o negativas", () => {
  for (const quantity of ["0", 0, "0.000", "-1", -200]) {
    assertInvalidFields(() => calculate([{ quantity, unitRate: "12" }]), ["items.0.quantity"]);
  }
});

test("rechaza entradas no numéricas, ausentes o con precisión no admitida", () => {
  for (const value of ["doce", NaN, Infinity, -Infinity, null, undefined, "", {}, true, "1,5", "1e3", 0.1 + 0.2]) {
    assertInvalidFields(() => calculate([{ quantity: value, unitRate: value }]), ["items.0.quantity", "items.0.unitRate"]);
  }
  assertInvalidFields(() => calculate([{ quantity: "1.0005", unitRate: "12" }]), ["items.0.quantity"]);
  assertInvalidFields(() => calculate([{ quantity: "1", unitRate: "12.345" }]), ["items.0.unitRate"]);
  assertInvalidFields(() => calculate([null, "x", []]), ["items.0", "items.1", "items.2"]);
  for (const items of [undefined, null, "items", {}]) {
    assertInvalidFields(() => calculate(items), ["items"]);
  }
  assertInvalidFields(() => calculateQuoteTotals(), ["items", "referenceVat"]);
});

test("reúne todos los errores de la entrada antes de fallar", () => {
  assertInvalidFields(
    () => calculate([{ quantity: "-1", unitRate: "12" }, ANTEPROYECTO_M2, { quantity: "2", unitRate: "x" }], { enabled: true, rate: "120" }),
    ["items.0.quantity", "items.2.unitRate", "referenceVat.rate"],
  );
});

test("valores en los límites permitidos de cantidad, tarifa e importes", () => {
  const { quantity, unitRate } = QUOTE_DECIMAL_FORMATS;
  assert.deepEqual(quantity, { maxIntegerDigits: 9, scale: 3 });
  assert.deepEqual(unitRate, { maxIntegerDigits: 12, scale: 2 });

  // 999999999.999 × 1.00 = 999999999.999 → 1000000000.00
  assert.equal(calculate([{ quantity: "999999999.999", unitRate: "1" }]).servicesTotal, "1000000000.00");
  assert.equal(calculate([{ quantity: "0.001", unitRate: "0.01" }]).items[0].subtotal, "0.00");
  assert.equal(calculate([{ quantity: "1", unitRate: MAX_AMOUNT }]).servicesTotal, MAX_AMOUNT);
  assert.equal(calculate([{ quantity: "1", unitRate: MAX_AMOUNT }], { enabled: true, rate: "0" }).estimatedTotalWithVat, MAX_AMOUNT);

  assertInvalidFields(() => calculate([{ quantity: "1000000000", unitRate: "1" }]), ["items.0.quantity"]);
  assertInvalidFields(() => calculate([{ quantity: "1", unitRate: "1000000000000" }]), ["items.0.unitRate"]);
  assertInvalidFields(() => calculate([{ quantity: "1.001", unitRate: MAX_AMOUNT }]), ["items.0.subtotal"]);
  assertInvalidFields(() => calculate([{ quantity: "1", unitRate: MAX_AMOUNT }, { quantity: "1", unitRate: "0.01" }]), ["servicesTotal"]);
  assertInvalidFields(() => calculate([{ quantity: "1", unitRate: MAX_AMOUNT }], { enabled: true, rate: "0.01" }), ["estimatedTotalWithVat"]);
});

test("la suma de subtotales coincide siempre con el total y el total estimado con el IVA", () => {
  // Generador determinista (LCG) para recorrer muchas combinaciones reproducibles.
  let seed = 20251019;
  const next = (max) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % max;
  };

  for (let round = 0; round < 200; round += 1) {
    const items = Array.from({ length: 1 + next(12) }, () => ({
      quantity: `${1 + next(5000)}.${String(next(1000)).padStart(3, "0")}`,
      unitRate: `${next(2000)}.${String(next(100)).padStart(2, "0")}`,
    }));
    const rate = `${next(100)}.${String(next(100)).padStart(2, "0")}`;
    const result = calculate(items, { enabled: true, rate });

    const subtotalSum = result.items.reduce((sum, item) => sum + toCents(item.subtotal), 0n);
    assert.equal(subtotalSum, toCents(result.servicesTotal));
    assert.equal(toCents(result.servicesTotal) + toCents(result.referenceVat.amount), toCents(result.estimatedTotalWithVat));
    for (const amount of [result.servicesTotal, result.referenceVat.amount, result.estimatedTotalWithVat]) {
      assert.match(amount, /^\d+\.\d{2}$/);
    }
  }
});

test("conserva el orden, ignora propiedades ajenas al cálculo y no modifica la entrada", () => {
  const items = [
    { concept: "Modelado 3D", quantity: "1", serviceId: 7, unitRate: "450" },
    { concept: "Anteproyecto", quantity: "200", serviceId: 1, unitRate: "12" },
  ];
  const snapshot = structuredClone(items);
  const result = calculate(items);

  assert.deepEqual(result.items.map((item) => item.subtotal), ["450.00", "2400.00"]);
  assert.deepEqual(Object.keys(result.items[0]).sort(), ["quantity", "subtotal", "unitRate"]);
  assert.deepEqual(items, snapshot);
});

test("una lista vacía produce importes en cero", () => {
  const result = calculate([], VAT_16);
  assert.deepEqual(result.items, []);
  assert.equal(result.servicesTotal, "0.00");
  assert.equal(result.estimatedTotalWithVat, "0.00");
});
