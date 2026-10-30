// Vista previa de los importes mientras se edita una cotización. Los importes los calcula el mismo
// motor que guarda el backend (Backend/src/domain/quoteTotals.js, «Cálculo de cotizaciones»):
// subtotales, total de servicios, IVA referencial y total estimado con IVA, sin fórmulas propias.
// Aquí solo se leen las entradas del formulario (coma decimal, campo vacío) con los mismos
// mensajes que el backend. El backend vuelve a calcular y guarda los importes definitivos;
// tests/quoteAmountsParity.test.js comprueba que ambos coinciden.
import { QUOTE_DECIMAL_FORMATS, calculateQuoteTotals } from "../../../../../../Backend/src/domain/quoteTotals.js";

export const QUOTE_INPUT_FORMATS = Object.freeze({
  quantity: QUOTE_DECIMAL_FORMATS.quantity,
  unitRate: QUOTE_DECIMAL_FORMATS.unitRate,
});
const DECIMAL_TEXT = /^(\d+)(?:\.(\d+))?$/;
const WITHOUT_REFERENCE_VAT = Object.freeze({ enabled: false });

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
 * Calcula con el motor del backend y devuelve null en lugar de lanzar si un importe supera el
 * máximo representable: la vista previa no muestra una cifra que el servidor rechazaría.
 *
 * @param {Array<{quantity: string, unitRate: string}>} items - Conceptos ya normalizados.
 * @param {{enabled: boolean, rate?: string|null}} referenceVat - IVA referencial.
 * @returns {{totals: Object|null, fields: Record<string, string>}} Importes o los campos que fallan.
 */
function tryCalculate(items, referenceVat) {
  try {
    return { fields: {}, totals: calculateQuoteTotals({ items, referenceVat }) };
  } catch (error) {
    return { fields: error.fields ?? {}, totals: null };
  }
}

/**
 * Valida un concepto y calcula su subtotal. Una cantidad cero o fraccionaria en una unidad sin
 * decimales se rechaza con el mensaje del backend; una tarifa cero sí se admite.
 *
 * @param {{quantity: string, unitRate: string, unitAllowsDecimals?: boolean}} line - Concepto del borrador.
 * @returns {{subtotal: string|null, errors: {quantity?: string, unitRate?: string, subtotal?: string}, normalized?: {quantity: string, unitRate: string}}} Resultado.
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
  const normalized = { quantity: quantity.normalized, unitRate: unitRate.normalized };
  const { fields, totals } = tryCalculate([normalized], WITHOUT_REFERENCE_VAT);
  if (!totals) return { errors: { subtotal: fields["items.0.subtotal"] ?? fields.servicesTotal }, subtotal: null };
  return { errors, normalized, subtotal: totals.items[0].subtotal };
}

/**
 * Calcula la vista previa de toda la cotización con el motor del backend: el subtotal de cada
 * concepto, el total de servicios (sin IVA) y, si hay una tasa, el IVA referencial y el total
 * estimado con IVA. Si algún concepto no es válido los totales son null, para no mostrar una
 * cifra que el servidor rechazaría.
 *
 * @param {Array<Object>} lines - Conceptos del borrador.
 * @param {{enabled: boolean, rate: string|null}|null} [referenceVat] - IVA referencial que se
 *   aplicará al guardar; null o deshabilitado si aún no se conoce o está pendiente de configuración.
 * @returns {{lines: Array<{subtotal: string|null, errors: Object}>, total: string|null,
 *   referenceVatAmount: string|null, estimatedTotalWithVat: string|null}} Importes.
 */
export function calculateQuotePreview(lines, referenceVat = null) {
  const results = lines.map(calculateLineAmount);
  const empty = { estimatedTotalWithVat: null, lines: results, referenceVatAmount: null, total: null };
  if (results.some((result) => result.subtotal === null)) return empty;
  const items = results.map((result) => result.normalized);
  const services = tryCalculate(items, WITHOUT_REFERENCE_VAT).totals;
  if (!services) return empty;
  const withVat = referenceVat?.enabled ? tryCalculate(items, referenceVat).totals : null;
  return {
    estimatedTotalWithVat: withVat?.estimatedTotalWithVat ?? null,
    lines: results,
    referenceVatAmount: withVat?.referenceVat.amount ?? null,
    total: services.servicesTotal,
  };
}
