/*
 * Modelo de presentación del documento PDF de una cotización (Figma 5831:356993). Traduce la
 * cotización guardada a los textos que se imprimen, sin conocer pdfkit, PostgreSQL ni HTTP.
 *
 * Los importes llegan como texto decimal de PostgreSQL y se formatean como texto, sin convertirlos
 * a Number, para no introducir errores de coma flotante en un documento financiero.
 */

const DEFAULT_TIME_ZONE = "UTC";

/**
 * Agrupa los miles de la parte entera de un decimal con comas (`3975` → `3,975`).
 * Trabaja sobre texto para no convertir importes a Number.
 *
 * @param {string} integerDigits - Dígitos enteros sin signo.
 * @returns {string} Dígitos agrupados.
 */
function groupThousands(integerDigits) {
  return integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Formatea un importe en dólares con dos decimales y miles agrupados (`2400.00` → `$2,400.00`),
 * como el documento de Figma.
 *
 * @param {string} amount - Importe como texto decimal ("2400.00").
 * @returns {string} Importe para imprimir.
 */
export function formatDocumentAmount(amount) {
  const [integerPart, fractionPart = ""] = String(amount).split(".");
  return `$${groupThousands(integerPart)}.${fractionPart.padEnd(2, "0").slice(0, 2)}`;
}

/**
 * Formatea una cantidad sin los ceros decimales sobrantes de NUMERIC(12,3) y con miles
 * agrupados (`200.000` → `200`, `12.500` → `12.5`, `1250.000` → `1,250`).
 *
 * @param {string} quantity - Cantidad como texto decimal.
 * @returns {string} Cantidad para imprimir.
 */
export function formatDocumentQuantity(quantity) {
  const [integerPart, fractionPart = ""] = String(quantity).split(".");
  const significantFraction = fractionPart.replace(/0+$/, "");
  return significantFraction ? `${groupThousands(integerPart)}.${significantFraction}` : groupThousands(integerPart);
}

/**
 * Indica si una zona horaria IANA es válida para formatear fechas en este entorno.
 *
 * @param {unknown} timeZone - Zona recibida.
 * @returns {boolean} true si Intl la reconoce.
 */
export function isSupportedTimeZone(timeZone) {
  if (typeof timeZone !== "string" || !timeZone) return false;
  try {
    new Intl.DateTimeFormat("es", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Formatea la fecha de la cotización como `dd/mm/aaaa` en la zona horaria indicada, la misma
 * que usa el navegador para mostrar el listado.
 *
 * @param {string} isoDate - Instante ISO 8601.
 * @param {string} timeZone - Zona horaria IANA ya validada.
 * @returns {string} Fecha para imprimir.
 */
export function formatDocumentDate(isoDate, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", timeZone, year: "numeric" })
    .formatToParts(new Date(isoDate));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.day}/${byType.month}/${byType.year}`;
}

/**
 * Construye los textos del documento a partir de una cotización con su versión vigente.
 * Las observaciones vacías se omiten: el documento no imprime una sección sin contenido.
 *
 * @param {object} quote - Cotización devuelta por findQuoteById.
 * @param {object} [options] - Opciones de presentación.
 * @param {string} [options.timeZone] - Zona horaria IANA para la fecha; UTC si falta o es inválida.
 * @returns {{
 *   code: string, date: string, fileName: string, clientName: string, projectName: string,
 *   items: Array<{ serviceName: string, unitLabel: string, quantity: string, unitRate: string, subtotal: string }>,
 *   total: string, currency: string, notes: string|null
 * }} Modelo listo para maquetar.
 */
export function buildQuoteDocument(quote, { timeZone } = {}) {
  const zone = isSupportedTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  return {
    clientName: quote.client.name,
    code: quote.code,
    currency: quote.currency,
    date: formatDocumentDate(quote.createdAt, zone),
    fileName: `${quote.code}.pdf`,
    items: quote.items.map((item) => ({
      quantity: formatDocumentQuantity(item.quantity),
      serviceName: item.service.name,
      subtotal: formatDocumentAmount(item.subtotal),
      unitLabel: item.unit.label,
      unitRate: formatDocumentAmount(item.unitRate),
    })),
    notes: quote.notes?.trim() || null,
    projectName: quote.project.name,
    total: formatDocumentAmount(quote.servicesTotal),
  };
}
