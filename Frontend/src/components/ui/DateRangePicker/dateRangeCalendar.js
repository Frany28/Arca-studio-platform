// Cálculos puros del selector de intervalos de fechas (Figma «Date picker menu», 3149:163491).
// Trabaja con días de calendario locales (`YYYY-MM-DD`), sin horas: el consumidor decide cómo
// traducir un día a instantes (por ejemplo, el inicio del día en la zona del navegador).

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_NAMES = Object.freeze([
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]);
const SHORT_MONTH_NAMES = Object.freeze(["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]);
// Semana de lunes a domingo, como Figma.
export const WEEKDAY_LABELS = Object.freeze([
  { label: "Lu", name: "lunes" }, { label: "Ma", name: "martes" }, { label: "Mi", name: "miércoles" },
  { label: "Ju", name: "jueves" }, { label: "Vi", name: "viernes" }, { label: "Sa", name: "sábado" }, { label: "Do", name: "domingo" },
]);
const WEEKS_PER_GRID = 6;

/**
 * Convierte una fecha local en su clave de día (`2026-03-20`).
 *
 * @param {Date} date - Fecha local.
 * @returns {string} Clave del día.
 */
export function toDayKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Convierte una clave de día en una fecha local a medianoche. Devuelve null si la clave no es
 * una fecha real (`2026-02-30`).
 *
 * @param {string|null|undefined} dayKey - Clave `YYYY-MM-DD`.
 * @returns {Date|null} Fecha local o null.
 */
export function fromDayKey(dayKey) {
  const match = DAY_KEY.exec(String(dayKey ?? ""));
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/**
 * Devuelve el primer día del mes desplazado `offset` meses respecto a `month`.
 *
 * @param {Date} month - Cualquier día del mes de referencia.
 * @param {number} offset - Meses a sumar (negativo para retroceder).
 * @returns {Date} Primer día del mes resultante.
 */
export function addMonths(month, offset) {
  return new Date(month.getFullYear(), month.getMonth() + offset, 1);
}

/**
 * Título del mes como en Figma (`Marzo-2026`).
 *
 * @param {Date} month - Cualquier día del mes.
 * @returns {string} Título.
 */
export function formatMonthTitle(month) {
  return `${MONTH_NAMES[month.getMonth()]}-${month.getFullYear()}`;
}

/**
 * Fecha abreviada del intervalo aplicado (`20 Mar 2026`), como el campo del listado en Figma.
 *
 * @param {string} dayKey - Clave del día.
 * @returns {string} Fecha legible o cadena vacía si la clave no es válida.
 */
export function formatShortDay(dayKey) {
  const date = fromDayKey(dayKey);
  return date ? `${date.getDate()} ${SHORT_MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}` : "";
}

/**
 * Nombre accesible completo de un día (`viernes, 20 de marzo de 2026`).
 *
 * @param {Date} date - Fecha local.
 * @returns {string} Nombre para lectores de pantalla.
 */
export function formatAccessibleDay(date) {
  const weekday = WEEKDAY_LABELS[(date.getDay() + 6) % 7].name;
  return `${weekday}, ${date.getDate()} de ${MONTH_NAMES[date.getMonth()].toLowerCase()} de ${date.getFullYear()}`;
}

/**
 * Construye la cuadrícula de seis semanas de un mes, de lunes a domingo. Los días de los meses
 * vecinos se incluyen para conservar la geometría de Figma, marcados como fuera del mes.
 *
 * @param {Date} month - Cualquier día del mes.
 * @returns {Array<Array<{ key: string, date: Date, inMonth: boolean }>>} Semanas con sus días.
 */
export function buildMonthGrid(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const leadingDays = (first.getDay() + 6) % 7;
  return Array.from({ length: WEEKS_PER_GRID }, (_, week) => Array.from({ length: 7 }, (_unused, weekday) => {
    const date = new Date(first.getFullYear(), first.getMonth(), 1 - leadingDays + week * 7 + weekday);
    return { date, inMonth: date.getMonth() === first.getMonth(), key: toDayKey(date) };
  }));
}

/**
 * Aplica un clic al intervalo en edición: el primer clic fija el inicio; el segundo, el fin
 * (intercambiándolos si es anterior). Un clic con el intervalo completo empieza uno nuevo.
 *
 * @param {{ from: string|null, to: string|null }} range - Intervalo en edición.
 * @param {string} dayKey - Día pulsado.
 * @returns {{ from: string, to: string|null }} Intervalo resultante.
 */
export function selectRangeDay(range, dayKey) {
  if (!range.from || range.to) return { from: dayKey, to: null };
  return dayKey < range.from ? { from: dayKey, to: range.from } : { from: range.from, to: dayKey };
}

/**
 * Indica la posición de un día respecto al intervalo para su presentación.
 *
 * @param {string} dayKey - Día.
 * @param {{ from: string|null, to: string|null }} range - Intervalo (el fin puede faltar).
 * @returns {"start"|"end"|"single"|"inside"|"outside"} Posición.
 */
export function getRangePosition(dayKey, range) {
  const { from } = range;
  const to = range.to ?? range.from;
  if (!from) return "outside";
  if (dayKey === from && dayKey === to) return "single";
  if (dayKey === from) return "start";
  if (dayKey === to) return "end";
  return dayKey > from && dayKey < to ? "inside" : "outside";
}
