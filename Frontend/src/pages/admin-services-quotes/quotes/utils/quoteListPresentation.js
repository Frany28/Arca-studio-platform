import { fromDayKey } from "../../../../components/ui/DateRangePicker/dateRangeCalendar.js";

// Presentación y consulta del listado de cotizaciones (Figma 5771:488497). Las fechas se muestran
// y filtran con el calendario del navegador: un día local se traduce a instantes exactos para la
// API, de modo que «20 Mar 2026» incluye toda esa jornada en la zona de quien consulta.

export const QUOTE_SORT_FIELDS = Object.freeze({ CODE: "code", TOTAL: "total" });
export const DEFAULT_QUOTE_SORT = Object.freeze({ direction: "asc", sort: QUOTE_SORT_FIELDS.CODE });

/**
 * Convierte el intervalo de días elegido en los instantes que espera la API: `createdFrom` es la
 * medianoche local del primer día (incluida) y `createdBefore`, la del día siguiente al último
 * (excluida). Sin intervalo no se envía ningún límite.
 *
 * @param {{dateFrom?: string, dateTo?: string}} range - Días `YYYY-MM-DD`.
 * @returns {{createdFrom?: string, createdBefore?: string}} Instantes ISO.
 */
export function toCreatedRange({ dateFrom, dateTo } = {}) {
  const from = fromDayKey(dateFrom);
  const to = fromDayKey(dateTo ?? dateFrom);
  if (!from || !to) return {};
  const before = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1);
  return { createdBefore: before.toISOString(), createdFrom: from.toISOString() };
}

/**
 * Formatea la fecha de una cotización como `dd/mm/aaaa` en la zona del navegador, como la columna
 * «Fecha» de Figma.
 *
 * @param {string} isoDate - Instante ISO de la API.
 * @returns {string} Fecha legible o «Sin fecha» si no es válida.
 */
export function formatQuoteDate(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}

/**
 * Calcula el orden siguiente al pulsar un encabezado: otra columna empieza en ascendente y la
 * misma columna alterna la dirección.
 *
 * @param {{sort: string, direction: string}} current - Orden aplicado.
 * @param {string} field - Columna pulsada (QUOTE_SORT_FIELDS).
 * @returns {{sort: string, direction: "asc"|"desc"}} Orden nuevo.
 */
export function toggleQuoteSort(current, field) {
  if (current.sort !== field) return { direction: "asc", sort: field };
  return { direction: current.direction === "asc" ? "desc" : "asc", sort: field };
}

/**
 * Valor de `aria-sort` de una columna ordenable según el orden aplicado.
 *
 * @param {{sort: string, direction: string}} current - Orden aplicado.
 * @param {string} field - Columna.
 * @returns {"ascending"|"descending"|"none"} Estado accesible del orden.
 */
export function getColumnSortDirection(current, field) {
  if (current.sort !== field) return "none";
  return current.direction === "desc" ? "descending" : "ascending";
}
