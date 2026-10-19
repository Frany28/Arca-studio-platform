/*
 * Aritmética decimal exacta para valores no negativos mediante enteros escalados (BigInt).
 *
 * Un valor con escala S se representa como el entero valor × 10^S: "12.5" con escala 3 es
 * 12500n. Así se evitan los errores de la coma flotante binaria (0.1 × 0.2) y los límites de
 * Number.MAX_SAFE_INTEGER, y la representación es compatible con columnas NUMERIC(p, s).
 *
 * El análisis devuelve `{ value }` o `{ error }` en lugar de lanzar excepciones, para que el
 * dominio pueda reunir todos los errores de una entrada y asignarlos a sus campos.
 */

export const DECIMAL_PARSE_ERRORS = Object.freeze({
  NEGATIVE: "NEGATIVE",
  NOT_NUMERIC: "NOT_NUMERIC",
  REQUIRED: "REQUIRED",
  TOO_LARGE: "TOO_LARGE",
  TOO_MANY_DECIMALS: "TOO_MANY_DECIMALS",
  UNSAFE_NUMBER: "UNSAFE_NUMBER",
});

// Solo dígitos ASCII (sin la bandera `u`, \d no admite otros sistemas numéricos), sin signo,
// exponente, espacios ni separadores de miles.
const DECIMAL_TEXT_PATTERN = /^(\d+)(?:\.(\d+))?$/;
const NEGATIVE_DECIMAL_PATTERN = /^-\d+(?:\.\d+)?$/;

// Un double conserva con seguridad 15 dígitos significativos: hasta ese límite, String(n)
// reproduce exactamente el decimal escrito (String(0.1) === "0.1").
const MAX_SAFE_NUMBER_SIGNIFICANT_DIGITS = 15;

/**
 * Cuenta los dígitos significativos del texto que JavaScript genera para un número.
 * Ignora signo, punto decimal y ceros a la izquierda; los ceros finales sí cuentan.
 *
 * @param {string} numberText - Resultado de String(number) sin notación exponencial.
 * @returns {number} Cantidad de dígitos significativos.
 */
function countSignificantDigits(numberText) {
  return numberText.replace(/[-.]/g, "").replace(/^0+/, "").length;
}

/**
 * Convierte la entrada admitida en texto decimal antes de analizarla.
 * Los números solo se aceptan si su conversión a texto es exacta y no usa exponente;
 * en otro caso se exige texto decimal para no heredar imprecisiones de la coma flotante.
 *
 * @param {unknown} value - Valor recibido (texto decimal o número finito).
 * @returns {{ text?: string, error?: string }} Texto a analizar o código de error.
 */
function toDecimalText(value) {
  if (value === null || value === undefined || value === "") {
    return { error: DECIMAL_PARSE_ERRORS.REQUIRED };
  }
  if (typeof value === "string") return { text: value };
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { error: DECIMAL_PARSE_ERRORS.NOT_NUMERIC };
  }

  const text = String(value);
  if (/e/i.test(text) || countSignificantDigits(text) > MAX_SAFE_NUMBER_SIGNIFICANT_DIGITS) {
    return { error: DECIMAL_PARSE_ERRORS.UNSAFE_NUMBER };
  }
  return { text };
}

/**
 * Analiza un decimal no negativo y lo devuelve como entero escalado con la escala indicada.
 * Los ceros finales que exceden la escala se aceptan porque no cambian el valor; cualquier
 * otro decimal adicional se rechaza en lugar de redondearse, para no alterar el dato recibido.
 *
 * @param {unknown} value - Texto decimal ("12.5") o número finito (12.5).
 * @param {object} format - Precisión admitida, equivalente a NUMERIC(maxIntegerDigits + scale, scale).
 * @param {number} format.scale - Número máximo de decimales.
 * @param {number} format.maxIntegerDigits - Número máximo de dígitos enteros.
 * @returns {{ value?: bigint, error?: string }} Entero escalado o un código de DECIMAL_PARSE_ERRORS.
 */
export function parseScaledDecimal(value, { scale, maxIntegerDigits }) {
  const { text, error } = toDecimalText(value);
  if (error) return { error };
  if (NEGATIVE_DECIMAL_PATTERN.test(text)) return { error: DECIMAL_PARSE_ERRORS.NEGATIVE };

  const match = DECIMAL_TEXT_PATTERN.exec(text);
  if (!match) return { error: DECIMAL_PARSE_ERRORS.NOT_NUMERIC };

  const [, integerDigits, fractionDigits = ""] = match;
  const significantFraction = fractionDigits.replace(/0+$/, "");
  if (significantFraction.length > scale) return { error: DECIMAL_PARSE_ERRORS.TOO_MANY_DECIMALS };

  const normalizedInteger = integerDigits.replace(/^0+(?=\d)/, "");
  if (normalizedInteger.length > maxIntegerDigits) return { error: DECIMAL_PARSE_ERRORS.TOO_LARGE };

  return { value: BigInt(normalizedInteger + significantFraction.padEnd(scale, "0")) };
}

/**
 * Divide dos enteros no negativos y redondea el cociente a la mitad hacia arriba.
 * Para valores positivos coincide con round() de PostgreSQL sobre NUMERIC (mitad alejándose
 * de cero), de modo que el resultado puede verificarse con restricciones CHECK equivalentes.
 *
 * @param {bigint} dividend - Dividendo no negativo.
 * @param {bigint} divisor - Divisor positivo.
 * @returns {bigint} Cociente redondeado.
 * @throws {RangeError} Si el dividendo es negativo o el divisor no es positivo (error de programación).
 */
export function divideRoundingHalfUp(dividend, divisor) {
  if (dividend < 0n || divisor <= 0n) {
    throw new RangeError("divideRoundingHalfUp solo admite dividendos no negativos y divisores positivos.");
  }
  const quotient = dividend / divisor;
  const remainder = dividend % divisor;
  return remainder * 2n >= divisor ? quotient + 1n : quotient;
}

/**
 * Representa un entero escalado no negativo como texto decimal con exactamente `scale` decimales.
 * El formato ("2400.00") es el que PostgreSQL devuelve para NUMERIC y conserva la precisión.
 *
 * @param {bigint} value - Entero escalado no negativo.
 * @param {number} scale - Decimales que representa el entero.
 * @returns {string} Texto decimal sin separadores de miles.
 * @throws {RangeError} Si el valor es negativo (error de programación).
 */
export function formatScaledDecimal(value, scale) {
  if (value < 0n) throw new RangeError("formatScaledDecimal solo admite valores no negativos.");
  const digits = value.toString().padStart(scale + 1, "0");
  return scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}
