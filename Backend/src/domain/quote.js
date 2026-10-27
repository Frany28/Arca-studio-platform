import { formatGeneratedCode } from "./generatedCode.js";
import { QUOTE_DECIMAL_FORMATS } from "./quoteTotals.js";
import { parseScaledDecimal } from "../utils/scaledDecimal.js";

/*
 * Reglas puras de las cotizaciones. No conocen PostgreSQL ni HTTP.
 *
 * - Código visible generado por el sistema a partir del id (`COT-001`, `COT-1000`).
 * - Moneda única USD, como el tabulador.
 * - Cada servicio aparece una sola vez por cotización: su cantidad expresa todo el alcance.
 * - Una unidad sin decimales (unidades contables, entregables) solo admite cantidades enteras.
 * - Guardar sin cambios efectivos no crea una versión nueva.
 */

export const QUOTE_CURRENCY = "USD";
export const QUOTE_NOTES_MAX_LENGTH = 2000;
/** Conceptos admitidos por cotización: acota el tamaño de la petición y del PDF. */
export const QUOTE_MAX_ITEMS = 100;

/** Órdenes del listado (encabezados N° y Total de Figma 5771:488506). */
export const QUOTE_SORT_FIELDS = Object.freeze({ CODE: "code", TOTAL: "total" });
export const QUOTE_SORT_DIRECTIONS = Object.freeze({ ASC: "asc", DESC: "desc" });

const QUOTE_CODE_PREFIX = "COT-";
const { quantity: QUANTITY_FORMAT } = QUOTE_DECIMAL_FORMATS;

/**
 * Compone el código visible de una cotización a partir de su id: `COT-` y el id con al menos
 * tres dígitos. Cumple el CHECK de PostgreSQL (`chk_quotes_code`).
 *
 * @param {number} quoteId - Identificador de la cotización.
 * @returns {string} Código generado (`COT-001`).
 * @throws {TypeError} Si el id no es un entero positivo seguro.
 */
export function formatGeneratedQuoteCode(quoteId) {
  return formatGeneratedCode(QUOTE_CODE_PREFIX, quoteId, "quotes: el id de la cotización");
}

/**
 * Registra en `fields` los conceptos que repiten un servicio ya incluido. Se señala cada
 * repetición (no la primera aparición) para que el formulario marque la fila sobrante.
 *
 * @param {Array<{ serviceId: number }>} items - Conceptos en el orden recibido.
 * @param {Record<string, string>} fields - Errores acumulados por ruta; se modifica.
 * @returns {void}
 */
export function collectDuplicateServiceErrors(items, fields) {
  const seen = new Set();
  items.forEach((item, index) => {
    if (seen.has(item.serviceId)) fields[`items.${index}.serviceId`] = "Este servicio ya está incluido en la cotización.";
    seen.add(item.serviceId);
  });
}

/**
 * Indica si una cantidad decimal es un número entero (`35`, `35.000`). La cantidad ya llega
 * validada con la escala de NUMERIC(12,3); un valor no interpretable no se considera entero.
 *
 * @param {string} quantity - Cantidad como texto decimal.
 * @returns {boolean} true si no tiene parte fraccionaria.
 */
function isWholeQuantity(quantity) {
  const parsed = parseScaledDecimal(quantity, QUANTITY_FORMAT);
  return !parsed.error && parsed.value % 10n ** BigInt(QUANTITY_FORMAT.scale) === 0n;
}

/**
 * Registra en `fields` las cantidades fraccionarias de conceptos cuya unidad no admite
 * decimales (`allows_decimals` de la unidad base copiado en la versión del servicio).
 *
 * @param {Array<{ quantity: string, unitAllowsDecimals: boolean }>} lines - Conceptos resueltos.
 * @param {Record<string, string>} fields - Errores acumulados por ruta; se modifica.
 * @returns {void}
 */
export function collectWholeQuantityErrors(lines, fields) {
  lines.forEach((line, index) => {
    if (!line.unitAllowsDecimals && !isWholeQuantity(line.quantity)) {
      fields[`items.${index}.quantity`] = "La unidad de este servicio solo admite cantidades enteras.";
    }
  });
}

/**
 * Normaliza una cantidad o tarifa para compararla sin depender de su escritura (`35` y
 * `35.000` son iguales). Un valor no interpretable se compara como texto.
 *
 * @param {string} value - Decimal como texto.
 * @param {{ scale: number, maxIntegerDigits: number }} format - Precisión del campo.
 * @returns {string} Representación comparable.
 */
function comparableDecimal(value, format) {
  const parsed = parseScaledDecimal(value, format);
  return parsed.error ? String(value) : parsed.value.toString();
}

/**
 * Representa el contenido versionado de una cotización como texto estable, para decidir si un
 * guardado cambia algo. Incluye cliente, proyecto, observaciones y, en orden, cada concepto con
 * la versión del servicio, la cantidad y la tarifa aplicada.
 *
 * @param {object} content - Contenido de la cotización.
 * @param {number} content.clientId - Cliente.
 * @param {number} content.projectId - Proyecto.
 * @param {string|null} content.notes - Observaciones.
 * @param {Array<{ serviceId: number, serviceVersionId: number, quantity: string, unitRate: string }>} content.items - Conceptos.
 * @returns {string} Huella comparable del contenido.
 */
function quoteContentFingerprint({ clientId, items, notes, projectId }) {
  return JSON.stringify([
    Number(clientId),
    Number(projectId),
    notes ?? null,
    items.map((item) => [
      Number(item.serviceId),
      Number(item.serviceVersionId),
      comparableDecimal(item.quantity, QUANTITY_FORMAT),
      comparableDecimal(item.unitRate, QUOTE_DECIMAL_FORMATS.unitRate),
    ]),
  ]);
}

/**
 * Indica si el contenido resultante difiere del de la versión vigente. Reordenar conceptos sí
 * es un cambio: el orden forma parte del documento entregado al cliente.
 *
 * @param {object} current - Contenido de la versión vigente.
 * @param {object} next - Contenido que se pretende guardar.
 * @returns {boolean} true si hay un cambio efectivo.
 */
export function hasQuoteContentChanged(current, next) {
  return quoteContentFingerprint(current) !== quoteContentFingerprint(next);
}
