// Vista previa de los importes mientras se edita una cotización. Reproduce exactamente las
// reglas del motor del backend (Backend/src/domain/quoteTotals.js, «Cálculo de cotizaciones»):
// enteros escalados con BigInt, subtotal = cantidad × tarifa redondeado a 2 decimales (mitad
// hacia arriba), total = suma de los subtotales redondeados y sin redondear las entradas. El
// backend vuelve a calcular y guarda sus propios importes, que son los definitivos;
// tests/quoteAmountsParity.test.js comprueba que ambos coinciden.

export const QUOTE_INPUT_FORMATS = Object.freeze({
  quantity: Object.freeze({ maxIntegerDigits: 9, scale: 3 }),
  unitRate: Object.freeze({ maxIntegerDigits: 12, scale: 2 }),
});
const AMOUNT_SCALE = 2;
const MAX_AMOUNT = 10n ** 14n - 1n;
const LINE_PRODUCT_DIVISOR = 10n ** BigInt(QUOTE_INPUT_FORMATS.quantity.scale + QUOTE_INPUT_FORMATS.unitRate.scale - AMOUNT_SCALE);
const DECIMAL_TEXT = /^(\d+)(?:\.(\d+))?$/;
// NUMERIC(14,2): hasta 999999999999.99, expresado en centésimas como MAX_AMOUNT.
const AMOUNT_LIMIT_MESSAGE = "Supera el importe máximo permitido (999999999999.99).";

/**
 * Analiza un decimal escrito en el formulario con la precisión de su columna. Admite coma como
 * separador decimal por comodidad; rechaza signos, exponentes, separadores de miles y decimales de
 * más, con los mismos mensajes que el backend.
 *
 * @param {string} text - Valor escrito.
 * @param {{scale: number, maxIntegerDigits: number}} format - Precisión.
 * @returns {{value: bigint, normalized: string}|{error: string}} Entero escalado y texto normalizado, o error.
 */
export function parseDecimalInput(text, format) {
  const value = String(text ?? "").trim().replace(",", ".");
  if (!value) return { error: "Es obligatorio." };
  if (/^-/.test(value)) return { error: "No puede ser negativo." };
  const match = DECIMAL_TEXT.exec(value);
  if (!match) return { error: "Debe ser un número decimal válido." };
  const [, integerDigits, fractionDigits = ""] = match;
  const fraction = fractionDigits.replace(/0+$/, "");
  if (fraction.length > format.scale) return { error: `Admite como máximo ${format.scale} decimales.` };
  const integer = integerDigits.replace(/^0+(?=\d)/, "");
  if (integer.length > format.maxIntegerDigits) return { error: `Admite como máximo ${format.maxIntegerDigits} dígitos enteros.` };
  return { normalized: fraction ? `${integer}.${fraction}` : integer, value: BigInt(integer + fraction.padEnd(format.scale, "0")) };
}

/**
 * Escribe un entero escalado como texto decimal con escala fija («2400.00»).
 *
 * @param {bigint} value - Entero escalado no negativo.
 * @param {number} scale - Decimales.
 * @returns {string} Texto decimal.
 */
function formatScaled(value, scale) {
  const digits = value.toString().padStart(scale + 1, "0");
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

/**
 * Divide redondeando la mitad hacia arriba, como round() de PostgreSQL en valores positivos.
 *
 * @param {bigint} dividend - Dividendo no negativo.
 * @param {bigint} divisor - Divisor positivo.
 * @returns {bigint} Cociente redondeado.
 */
function divideHalfUp(dividend, divisor) {
  const quotient = dividend / divisor;
  return (dividend % divisor) * 2n >= divisor ? quotient + 1n : quotient;
}

/**
 * Valida un concepto y calcula su subtotal. Una cantidad cero o fraccionaria en una unidad sin
 * decimales se rechaza con el mensaje del backend; una tarifa cero sí se admite.
 *
 * @param {{quantity: string, unitRate: string, unitAllowsDecimals?: boolean}} line - Concepto del borrador.
 * @returns {{subtotal: string|null, errors: {quantity?: string, unitRate?: string, subtotal?: string}}} Resultado.
 */
export function calculateLineAmount(line) {
  const errors = {};
  const quantity = parseDecimalInput(line.quantity, QUOTE_INPUT_FORMATS.quantity);
  const unitRate = parseDecimalInput(line.unitRate, QUOTE_INPUT_FORMATS.unitRate);
  if (quantity.error) errors.quantity = quantity.error;
  else if (quantity.value === 0n) errors.quantity = "Debe ser mayor que cero.";
  else if (line.unitAllowsDecimals === false && quantity.value % 10n ** BigInt(QUOTE_INPUT_FORMATS.quantity.scale) !== 0n) {
    errors.quantity = "La unidad de este servicio solo admite cantidades enteras.";
  }
  if (unitRate.error) errors.unitRate = unitRate.error;
  if (errors.quantity || errors.unitRate) return { errors, subtotal: null };
  const subtotal = divideHalfUp(quantity.value * unitRate.value, LINE_PRODUCT_DIVISOR);
  if (subtotal > MAX_AMOUNT) return { errors: { subtotal: AMOUNT_LIMIT_MESSAGE }, subtotal: null };
  return { errors, subtotal: formatScaled(subtotal, AMOUNT_SCALE) };
}

/**
 * Calcula la vista previa de toda la cotización: el subtotal de cada concepto y el total como
 * suma de los subtotales ya redondeados. Si algún concepto no es válido el total es null, para no
 * mostrar una cifra que el servidor rechazaría.
 *
 * @param {Array<Object>} lines - Conceptos del borrador.
 * @returns {{lines: Array<{subtotal: string|null, errors: Object}>, total: string|null}} Importes.
 */
export function calculateQuotePreview(lines) {
  const results = lines.map(calculateLineAmount);
  if (results.some((result) => result.subtotal === null)) return { lines: results, total: null };
  const total = results.reduce((sum, result) => sum + BigInt(result.subtotal.replace(".", "")), 0n);
  return { lines: results, total: total > MAX_AMOUNT ? null : formatScaled(total, AMOUNT_SCALE) };
}
