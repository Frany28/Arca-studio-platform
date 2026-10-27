import assert from "node:assert/strict";
import test from "node:test";

import { calculateQuoteTotals } from "../../Backend/src/domain/quoteTotals.js";
import { calculateLineAmount, calculateQuotePreview, parseDecimalInput, QUOTE_INPUT_FORMATS } from "../src/pages/admin-services-quotes/quote-editor/utils/quoteAmounts.js";

// La vista previa del formulario debe coincidir exactamente con el motor del backend, que guarda
// los importes definitivos (Backend/ARCHITECTURE.md, «Cálculo de cotizaciones»). Esta prueba
// importa el motor real para detectar cualquier divergencia de redondeo o de validación.

/**
 * Calcula los importes con el motor del backend en el formato de la vista previa.
 *
 * @param {Array<{quantity: string, unitRate: string}>} items - Conceptos.
 * @returns {{subtotals: Array<string>, total: string}} Importes del backend.
 */
function backendTotals(items) {
  const totals = calculateQuoteTotals({ items, referenceVat: { enabled: false } });
  return { subtotals: totals.items.map((item) => item.subtotal), total: totals.servicesTotal };
}

/**
 * Genera un decimal aleatorio reproducible con la escala indicada.
 *
 * @param {() => number} random - Generador.
 * @param {number} integerDigits - Dígitos enteros máximos.
 * @param {number} scale - Decimales máximos.
 * @returns {string} Decimal como texto.
 */
function randomDecimal(random, integerDigits, scale) {
  const integer = String(Math.floor(random() * 10 ** integerDigits));
  const decimals = Math.floor(random() * (scale + 1));
  const fraction = decimals ? String(Math.floor(random() * 10 ** decimals)).padStart(decimals, "0") : "";
  return fraction ? `${integer}.${fraction}` : integer;
}

/**
 * Generador congruencial determinista: la prueba recorre siempre los mismos casos.
 *
 * @param {number} seed - Semilla.
 * @returns {() => number} Números en [0, 1).
 */
function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

test("paridad: subtotales y total coinciden con el motor del backend, incluidos los límites de redondeo", () => {
  const cases = [
    [{ quantity: "200", unitRate: "12" }, { quantity: "35", unitRate: "45" }],
    // 0.005 → 0.01 (mitad hacia arriba) y 0.004 → 0.00.
    [{ quantity: "0.001", unitRate: "5" }, { quantity: "0.001", unitRate: "4" }],
    [{ quantity: "1.005", unitRate: "1.01" }, { quantity: "333.333", unitRate: "0.03" }],
    [{ quantity: "999999999.999", unitRate: "0" }],
    [{ quantity: "1", unitRate: "999999999999.99" }],
  ];
  const random = seededRandom(20261026);
  for (let index = 0; index < 300; index += 1) {
    cases.push(Array.from({ length: 1 + Math.floor(random() * 4) }, () => {
      const quantity = randomDecimal(random, 4, 3);
      // Una cantidad cero se rechaza en ambos motores; aquí solo se comparan importes válidos.
      return { quantity: /^0+(\.0+)?$/.test(quantity) ? "1" : quantity, unitRate: randomDecimal(random, 5, 2) };
    }));
  }
  for (const items of cases) {
    const expected = backendTotals(items);
    const preview = calculateQuotePreview(items.map((item) => ({ ...item, unitAllowsDecimals: true })));
    assert.deepEqual(preview.lines.map((line) => line.subtotal), expected.subtotals, JSON.stringify(items));
    assert.equal(preview.total, expected.total, JSON.stringify(items));
  }
});

test("paridad: las entradas inválidas se rechazan con los mismos mensajes del backend", () => {
  const invalid = [
    [{ quantity: "1.2345", unitRate: "1" }, "quantity"],
    [{ quantity: "0", unitRate: "1" }, "quantity"],
    [{ quantity: "1", unitRate: "1.001" }, "unitRate"],
    [{ quantity: "1", unitRate: "-1" }, "unitRate"],
    [{ quantity: "1234567890", unitRate: "1" }, "quantity"],
  ];
  for (const [item, field] of invalid) {
    let backendMessage = null;
    try {
      calculateQuoteTotals({ items: [item], referenceVat: { enabled: false } });
    } catch (error) {
      backendMessage = error.fields[`items.0.${field}`];
    }
    assert.ok(backendMessage, `El backend rechaza ${JSON.stringify(item)}`);
    assert.equal(calculateLineAmount(item).errors[field], backendMessage, JSON.stringify(item));
  }
});

test("entradas del formulario: coma decimal, ceros sobrantes y unidades sin decimales", () => {
  assert.deepEqual(parseDecimalInput("12,50", QUOTE_INPUT_FORMATS.unitRate), { normalized: "12.5", value: 1250n });
  assert.deepEqual(parseDecimalInput("007.000", QUOTE_INPUT_FORMATS.quantity), { normalized: "7", value: 7000n });
  assert.equal(parseDecimalInput("1,250.50", QUOTE_INPUT_FORMATS.unitRate).error, "Debe ser un número decimal válido.");
  assert.equal(parseDecimalInput("", QUOTE_INPUT_FORMATS.quantity).error, "Es obligatorio.");
  assert.equal(calculateLineAmount({ quantity: "2.5", unitAllowsDecimals: false, unitRate: "1" }).errors.quantity, "La unidad de este servicio solo admite cantidades enteras.");
  assert.equal(calculateLineAmount({ quantity: "2.000", unitAllowsDecimals: false, unitRate: "1" }).subtotal, "2.00");
  assert.equal(calculateQuotePreview([{ quantity: "", unitRate: "1" }]).total, null, "Sin cantidad no se muestra un total");
  assert.deepEqual(calculateQuotePreview([]), { lines: [], total: "0.00" });
});
