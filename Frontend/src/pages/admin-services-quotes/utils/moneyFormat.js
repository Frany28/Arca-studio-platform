// Formato de importes del módulo Servicios y cotizaciones. La API entrega importes como texto
// decimal (NUMERIC de PostgreSQL); se formatean como texto, sin convertirlos a Number, para no
// perder precisión ni redondear.

const DECIMAL_AMOUNT = /^(\d+)(?:\.(\d+))?$/;
const CURRENCY_SYMBOLS = { USD: "$" };
const INTEGER_GROUPING = new Intl.NumberFormat("en-US");

/**
 * Formatea un importe decimal con su símbolo y los miles agrupados. Con `alwaysShowCents` muestra
 * siempre dos decimales (`$2,400.00`, totales de cotización); sin él solo cuando no son cero
 * (`$12`, tarifas del tabulador). Un valor con formato inesperado se muestra tal cual.
 *
 * @param {string|number|null|undefined} value - Importe como texto decimal.
 * @param {Object} [options] - Presentación.
 * @param {string} [options.currency="USD"] - Moneda.
 * @param {boolean} [options.alwaysShowCents=false] - Muestra los céntimos aunque sean cero.
 * @returns {string} Importe legible o «—» si no hay valor.
 */
export function formatDecimalMoney(value, { alwaysShowCents = false, currency = "USD" } = {}) {
  const text = String(value ?? "").trim();
  const match = DECIMAL_AMOUNT.exec(text);
  const prefix = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  if (!match) return text ? `${prefix}${text}` : "—";
  const [, integerPart, fractionPart = ""] = match;
  // BigInt conserva cualquier longitud de la parte entera (el contrato admite hasta 12 dígitos).
  const grouped = INTEGER_GROUPING.format(BigInt(integerPart));
  const cents = fractionPart.padEnd(2, "0").slice(0, 2);
  return !alwaysShowCents && /^0+$/.test(cents) ? `${prefix}${grouped}` : `${prefix}${grouped}.${cents}`;
}
