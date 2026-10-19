import assert from "node:assert/strict";
import test from "node:test";

import {
  DECIMAL_PARSE_ERRORS,
  divideRoundingHalfUp,
  formatScaledDecimal,
  parseScaledDecimal,
} from "../src/utils/scaledDecimal.js";

const MONEY = { maxIntegerDigits: 12, scale: 2 };
const QUANTITY = { maxIntegerDigits: 9, scale: 3 };

test("analiza texto y números exactos como enteros escalados sin coma flotante", () => {
  assert.deepEqual(parseScaledDecimal("12", MONEY), { value: 1200n });
  assert.deepEqual(parseScaledDecimal("12.5", MONEY), { value: 1250n });
  assert.deepEqual(parseScaledDecimal("0.1", QUANTITY), { value: 100n });
  assert.deepEqual(parseScaledDecimal(0.1, QUANTITY), { value: 100n });
  assert.deepEqual(parseScaledDecimal(450, MONEY), { value: 45000n });
  assert.deepEqual(parseScaledDecimal("007.50", MONEY), { value: 750n });
  assert.deepEqual(parseScaledDecimal("0", MONEY), { value: 0n });
  assert.deepEqual(parseScaledDecimal(-0, MONEY), { value: 0n });
});

test("acepta ceros finales que exceden la escala porque no alteran el valor", () => {
  assert.deepEqual(parseScaledDecimal("12.500000", MONEY), { value: 1250n });
});

test("rechaza decimales significativos por encima de la escala sin redondearlos", () => {
  assert.deepEqual(parseScaledDecimal("12.345", MONEY), { error: DECIMAL_PARSE_ERRORS.TOO_MANY_DECIMALS });
  assert.deepEqual(parseScaledDecimal("1.0005", QUANTITY), { error: DECIMAL_PARSE_ERRORS.TOO_MANY_DECIMALS });
  // 0.1 + 0.2 en coma flotante es 0.30000000000000004: se rechaza en lugar de truncarse.
  assert.deepEqual(parseScaledDecimal(0.1 + 0.2, MONEY), { error: DECIMAL_PARSE_ERRORS.UNSAFE_NUMBER });
});

test("rechaza dígitos enteros por encima de la precisión", () => {
  assert.deepEqual(parseScaledDecimal("999999999999.99", MONEY), { value: 99999999999999n });
  assert.deepEqual(parseScaledDecimal("1000000000000", MONEY), { error: DECIMAL_PARSE_ERRORS.TOO_LARGE });
  assert.deepEqual(parseScaledDecimal("0001000000000", QUANTITY), { error: DECIMAL_PARSE_ERRORS.TOO_LARGE });
});

test("clasifica valores ausentes, negativos, no numéricos y conversiones inseguras", () => {
  for (const value of [null, undefined, ""]) {
    assert.deepEqual(parseScaledDecimal(value, MONEY), { error: DECIMAL_PARSE_ERRORS.REQUIRED });
  }
  for (const value of ["-1", "-0.01", -5]) {
    assert.deepEqual(parseScaledDecimal(value, MONEY), { error: DECIMAL_PARSE_ERRORS.NEGATIVE });
  }
  for (const value of ["abc", "1,5", "1.", ".5", "+1", " 1", "1e3", "0x10", "١٢", NaN, Infinity, -Infinity, true, {}, [], 10n]) {
    assert.deepEqual(parseScaledDecimal(value, MONEY), { error: DECIMAL_PARSE_ERRORS.NOT_NUMERIC }, String(value));
  }
  for (const value of [1e21, 1e-7, 12345678901234567, 0.1234567890123456]) {
    assert.deepEqual(parseScaledDecimal(value, MONEY), { error: DECIMAL_PARSE_ERRORS.UNSAFE_NUMBER }, String(value));
  }
});

test("divide redondeando la mitad hacia arriba como round() de PostgreSQL", () => {
  assert.equal(divideRoundingHalfUp(5n, 1000n), 0n);
  assert.equal(divideRoundingHalfUp(499n, 1000n), 0n);
  assert.equal(divideRoundingHalfUp(500n, 1000n), 1n);
  assert.equal(divideRoundingHalfUp(1500n, 1000n), 2n);
  assert.equal(divideRoundingHalfUp(2499n, 1000n), 2n);
  assert.equal(divideRoundingHalfUp(0n, 1000n), 0n);
  assert.throws(() => divideRoundingHalfUp(-1n, 10n), RangeError);
  assert.throws(() => divideRoundingHalfUp(1n, 0n), RangeError);
});

test("formatea enteros escalados con escala fija", () => {
  assert.equal(formatScaledDecimal(240000n, 2), "2400.00");
  assert.equal(formatScaledDecimal(5n, 2), "0.05");
  assert.equal(formatScaledDecimal(0n, 3), "0.000");
  assert.equal(formatScaledDecimal(42n, 0), "42");
  assert.equal(formatScaledDecimal(99999999999999n, 2), "999999999999.99");
  assert.throws(() => formatScaledDecimal(-1n, 2), RangeError);
});
