import { ValidationError } from "../errors/appError.js";
import {
  DECIMAL_PARSE_ERRORS,
  divideRoundingHalfUp,
  formatScaledDecimal,
  parseScaledDecimal,
} from "../utils/scaledDecimal.js";

/*
 * Motor de importes de cotizaciones. Es independiente del catálogo: no conoce servicios,
 * tarifas del tabulador, PostgreSQL ni HTTP; recibe cantidades y tarifas aplicadas.
 *
 * Reglas:
 * - subtotal de cada concepto = cantidad × tarifa aplicada, redondeado a 2 decimales;
 *   las tarifas fijas usan el mismo mecanismo con cantidad 1.
 * - total de servicios = suma de los subtotales ya redondeados.
 * - IVA referencial (informativo, no fiscal) = total de servicios × tasa / 100, redondeado
 *   a 2 decimales; total estimado con IVA = total de servicios + IVA referencial.
 *
 * Redondeo: mitad hacia arriba (0.005 → 0.01), igual que round() de PostgreSQL para
 * valores positivos. Las cantidades y tarifas nunca se redondean: si exceden su escala se
 * rechazan. Todo el cálculo usa enteros escalados (BigInt), sin coma flotante.
 */

// Escalas alineadas con el modelo de datos propuesto (NUMERIC(precisión, escala)).
export const QUOTE_DECIMAL_FORMATS = Object.freeze({
  /** quote_items.quantity NUMERIC(12,3): hasta 999999999.999. */
  quantity: Object.freeze({ maxIntegerDigits: 9, scale: 3 }),
  /** quote_items.unit_rate NUMERIC(14,2): hasta 999999999999.99. */
  unitRate: Object.freeze({ maxIntegerDigits: 12, scale: 2 }),
  /** Subtotales y totales NUMERIC(14,2): hasta 999999999999.99. */
  amount: Object.freeze({ maxIntegerDigits: 12, scale: 2 }),
  /** quote_versions.vat_rate NUMERIC(5,2): porcentaje entre 0.00 y 100.00. */
  vatRate: Object.freeze({ maxIntegerDigits: 3, scale: 2 }),
});

const { amount: AMOUNT_FORMAT, quantity: QUANTITY_FORMAT, unitRate: UNIT_RATE_FORMAT, vatRate: VAT_RATE_FORMAT } =
  QUOTE_DECIMAL_FORMATS;

/** Mayor importe representable en NUMERIC(14,2), en centésimas. */
const MAX_AMOUNT = 10n ** BigInt(AMOUNT_FORMAT.maxIntegerDigits + AMOUNT_FORMAT.scale) - 1n;
/** 100.00 % expresado con la escala de la tasa. */
const MAX_VAT_RATE = 100n * 10n ** BigInt(VAT_RATE_FORMAT.scale);
/** Cantidad × tarifa tiene escala 3 + 2; se reduce a la escala monetaria. */
const LINE_PRODUCT_DIVISOR = 10n ** BigInt(QUANTITY_FORMAT.scale + UNIT_RATE_FORMAT.scale - AMOUNT_FORMAT.scale);
/** Importe × tasa tiene escala 2 + 2 y la tasa es un porcentaje (÷ 100). */
const VAT_PRODUCT_DIVISOR = 10n ** BigInt(VAT_RATE_FORMAT.scale) * 100n;

const INVALID_TOTALS_MESSAGE = "Los importes de la cotización no son válidos.";
const AMOUNT_LIMIT_MESSAGE = `Supera el importe máximo permitido (${formatScaledDecimal(MAX_AMOUNT, AMOUNT_FORMAT.scale)}).`;

/**
 * Traduce un código de análisis decimal al mensaje que se asigna al campo correspondiente.
 * Incluye en el texto la precisión admitida para que el usuario pueda corregir el valor.
 *
 * @param {string} errorCode - Código de DECIMAL_PARSE_ERRORS.
 * @param {{ scale: number, maxIntegerDigits: number }} format - Precisión del campo.
 * @returns {string} Mensaje en español para `fields`.
 */
function describeDecimalError(errorCode, format) {
  switch (errorCode) {
    case DECIMAL_PARSE_ERRORS.REQUIRED: return "Es obligatorio.";
    case DECIMAL_PARSE_ERRORS.NEGATIVE: return "No puede ser negativo.";
    case DECIMAL_PARSE_ERRORS.TOO_MANY_DECIMALS: return `Admite como máximo ${format.scale} decimales.`;
    case DECIMAL_PARSE_ERRORS.TOO_LARGE: return `Admite como máximo ${format.maxIntegerDigits} dígitos enteros.`;
    case DECIMAL_PARSE_ERRORS.UNSAFE_NUMBER: return "Envía el valor como texto decimal para conservar la precisión.";
    default: return "Debe ser un número decimal válido.";
  }
}

/**
 * Analiza un campo decimal y registra su error en `fields` cuando no es válido.
 * Centraliza la asociación entre ruta del campo, precisión y mensaje.
 *
 * @param {unknown} value - Valor recibido.
 * @param {{ scale: number, maxIntegerDigits: number }} format - Precisión del campo.
 * @param {string} fieldPath - Ruta del campo en el objeto de entrada.
 * @param {Record<string, string>} fields - Errores acumulados; se modifica.
 * @returns {bigint | null} Entero escalado o null si el valor es inválido.
 */
function readDecimalField(value, format, fieldPath, fields) {
  const parsed = parseScaledDecimal(value, format);
  if (parsed.error) {
    fields[fieldPath] = describeDecimalError(parsed.error, format);
    return null;
  }
  return parsed.value;
}

/**
 * Valida un concepto y calcula su subtotal redondeado a la escala monetaria.
 * Una cantidad cero se rechaza porque un concepto incluido debe aportar alcance; una tarifa
 * cero sí se admite (concepto bonificado). Los errores se acumulan en `fields`.
 *
 * @param {unknown} item - Concepto con `quantity` y `unitRate`; otras propiedades se ignoran.
 * @param {string} path - Ruta del concepto ("items.0").
 * @param {Record<string, string>} fields - Errores acumulados; se modifica.
 * @returns {{ quantity: bigint, unitRate: bigint, subtotal: bigint } | null} Valores escalados, o null
 *   si el concepto es inválido.
 */
function calculateLine(item, path, fields) {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    fields[path] = "Debe ser un concepto con cantidad y tarifa aplicada.";
    return null;
  }

  const quantity = readDecimalField(item.quantity, QUANTITY_FORMAT, `${path}.quantity`, fields);
  if (quantity === 0n) fields[`${path}.quantity`] = "Debe ser mayor que cero.";
  const unitRate = readDecimalField(item.unitRate, UNIT_RATE_FORMAT, `${path}.unitRate`, fields);
  if (quantity === null || quantity === 0n || unitRate === null) return null;

  const subtotal = divideRoundingHalfUp(quantity * unitRate, LINE_PRODUCT_DIVISOR);
  if (subtotal > MAX_AMOUNT) {
    fields[`${path}.subtotal`] = AMOUNT_LIMIT_MESSAGE;
    return null;
  }
  return { quantity, subtotal, unitRate };
}

/**
 * Valida la lista de conceptos y calcula el subtotal de cada uno conservando su orden.
 * Una lista vacía es matemáticamente válida (total 0.00); exigir conceptos es una regla
 * del servicio de cotizaciones, no del motor de cálculo.
 *
 * @param {unknown} items - Conceptos de la cotización.
 * @param {Record<string, string>} fields - Errores acumulados; se modifica.
 * @returns {Array<{ quantity: bigint, unitRate: bigint, subtotal: bigint } | null>} Líneas calculadas.
 */
function calculateLines(items, fields) {
  if (!Array.isArray(items)) {
    fields.items = "Debe ser una lista de conceptos.";
    return [];
  }
  return items.map((item, index) => calculateLine(item, `items.${index}`, fields));
}

/**
 * Valida la tasa porcentual del IVA referencial: hasta 2 decimales y entre 0 y 100.
 * La tasa 0 es válida. Los errores se registran en `fields`.
 *
 * @param {unknown} rawRate - Tasa recibida.
 * @param {Record<string, string>} fields - Errores acumulados; se modifica.
 * @returns {bigint | null} Tasa escalada (16.00 → 1600n) o null si es inválida.
 */
function readVatRate(rawRate, fields) {
  const rate = readDecimalField(rawRate, VAT_RATE_FORMAT, "referenceVat.rate", fields);
  if (rate === null || rate <= MAX_VAT_RATE) return rate;
  fields["referenceVat.rate"] = "Debe estar entre 0 y 100.";
  return null;
}

/**
 * Valida la configuración del IVA referencial recibida para la cotización.
 * La tasa es obligatoria solo si el IVA está habilitado; si se envía estando deshabilitado
 * se valida y se conserva, para registrar la tasa configurada sin aplicarla.
 *
 * @param {unknown} referenceVat - Objeto `{ enabled: boolean, rate?: string|number }`.
 * @param {Record<string, string>} fields - Errores acumulados; se modifica.
 * @returns {{ enabled: boolean, rate: bigint | null } | null} Configuración leída; solo es
 *   utilizable si `fields` no contiene errores.
 */
function readReferenceVat(referenceVat, fields) {
  if (referenceVat === null || typeof referenceVat !== "object" || Array.isArray(referenceVat)) {
    fields.referenceVat = "Indica si el IVA referencial está habilitado y su tasa.";
    return null;
  }

  const { enabled, rate: rawRate } = referenceVat;
  if (typeof enabled !== "boolean") fields["referenceVat.enabled"] = "Debe ser verdadero o falso.";

  const isOptionalRateMissing = enabled !== true && (rawRate === null || rawRate === undefined || rawRate === "");
  return { enabled, rate: isOptionalRateMissing ? null : readVatRate(rawRate, fields) };
}

/**
 * Lanza el error de validación con todos los campos inválidos cuando existe alguno.
 * Usa el error central de la aplicación para que el middleware lo traduzca a HTTP 400.
 *
 * @param {Record<string, string>} fields - Errores acumulados.
 * @returns {void}
 * @throws {ValidationError} Si `fields` contiene al menos un error.
 */
function assertNoFieldErrors(fields) {
  if (Object.keys(fields).length > 0) throw new ValidationError(INVALID_TOTALS_MESSAGE, fields);
}

/**
 * Representa un importe escalado con la escala monetaria (dos decimales).
 * Unifica el formato de todos los importes del resultado.
 *
 * @param {bigint} value - Importe en centésimas.
 * @returns {string} Importe como texto decimal ("2400.00").
 */
function formatAmount(value) {
  return formatScaledDecimal(value, AMOUNT_FORMAT.scale);
}

/**
 * Calcula de forma exacta los importes de una cotización a partir de cantidades y tarifas.
 * Valida toda la entrada y reúne todos los errores antes de fallar. Todos los valores del
 * resultado son texto decimal con escala fija, compatible con columnas NUMERIC.
 *
 * @param {object} input - Datos de cálculo.
 * @param {Array<{ quantity: string|number, unitRate: string|number }>} input.items - Conceptos en orden.
 *   `quantity`: positiva, hasta 9 enteros y 3 decimales. `unitRate`: no negativa, hasta 12 enteros
 *   y 2 decimales. Se recomienda texto decimal; los números solo se aceptan si su conversión es exacta.
 * @param {{ enabled: boolean, rate?: string|number }} input.referenceVat - IVA referencial;
 *   `rate` es un porcentaje entre 0 y 100 con hasta 2 decimales, obligatorio si `enabled` es true.
 * @returns {{
 *   items: Array<{ quantity: string, unitRate: string, subtotal: string }>,
 *   servicesTotal: string,
 *   referenceVat: { isReferenceOnly: true, enabled: boolean, rate: string|null, amount: string },
 *   estimatedTotalWithVat: string
 * }} Importes calculados. Con el IVA deshabilitado, `amount` es "0.00" y el total estimado
 *   coincide con `servicesTotal`.
 * @throws {ValidationError} Con `fields` por ruta ("items.0.quantity", "referenceVat.rate",
 *   "servicesTotal"...) si una entrada es inválida o un importe supera NUMERIC(14,2).
 */
export function calculateQuoteTotals({ items, referenceVat } = {}) {
  const fields = {};
  const lines = calculateLines(items, fields);
  const vat = readReferenceVat(referenceVat, fields);
  assertNoFieldErrors(fields);

  const servicesTotal = lines.reduce((total, line) => total + line.subtotal, 0n);
  if (servicesTotal > MAX_AMOUNT) fields.servicesTotal = AMOUNT_LIMIT_MESSAGE;
  const vatAmount = vat.enabled ? divideRoundingHalfUp(servicesTotal * vat.rate, VAT_PRODUCT_DIVISOR) : 0n;
  const estimatedTotalWithVat = servicesTotal + vatAmount;
  if (!fields.servicesTotal && estimatedTotalWithVat > MAX_AMOUNT) fields.estimatedTotalWithVat = AMOUNT_LIMIT_MESSAGE;
  assertNoFieldErrors(fields);

  return {
    items: lines.map((line) => ({
      quantity: formatScaledDecimal(line.quantity, QUANTITY_FORMAT.scale),
      subtotal: formatAmount(line.subtotal),
      unitRate: formatScaledDecimal(line.unitRate, UNIT_RATE_FORMAT.scale),
    })),
    servicesTotal: formatAmount(servicesTotal),
    referenceVat: {
      amount: formatAmount(vatAmount),
      enabled: vat.enabled,
      isReferenceOnly: true,
      rate: vat.rate === null ? null : formatScaledDecimal(vat.rate, VAT_RATE_FORMAT.scale),
    },
    estimatedTotalWithVat: formatAmount(estimatedTotalWithVat),
  };
}
