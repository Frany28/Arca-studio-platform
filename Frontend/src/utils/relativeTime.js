const MINUTE_IN_MS = 60_000;
const HOUR_IN_MINUTES = 60;
const DAY_IN_HOURS = 24;
const RELATIVE_DAY_LIMIT = 30;
const ONE_MONTH_DAY_LIMIT = 60;

function pluralize(value, singular, plural) {
  return `${value} ${value === 1 ? singular : plural}`;
}

/**
 * Formatea día y mes abreviado en es-ES y elimina puntos de abreviación.
 * Incluye el año únicamente si difiere del año de referencia, usando zona local.
 *
 * @param {Object} date - Fecha válida con interfaz Date.
 * @param {number} now - Instante de referencia en milisegundos.
 * @returns {string} Fecha visible.
 */
function formatExactDate(date, now) {
  const includeYear = date.getFullYear() !== new Date(now).getFullYear();
  const formattedDate = new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "short",
    ...(includeYear ? { year: "numeric" } : {}),
  }).format(date);

  return formattedDate.replaceAll(".", "");
}

/**
 * Convierte una fecha a milisegundos sin confundir ausencia con época Unix.
 * null, undefined, texto vacío y fechas inválidas devuelven null.
 *
 * @param {string|number|Object|null} value - Valor convertible mediante Date.
 * @returns {number|null} Timestamp válido o null.
 */
function resolveTimestamp(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return timestamp;
}

/**
 * Formatea una fecha es-ES como día, mes abreviado con inicial mayúscula y año.
 * Elimina puntos del mes y usa el fallback para valores ausentes o inválidos.
 *
 * @param {string|number|Object|null} value - Fecha candidata.
 * @param {string} [fallback="Sin fecha"] - Texto alternativo.
 * @returns {string} Fecha de calendario en zona local.
 */
export function formatCalendarDate(value, fallback = "Sin fecha") {
  const timestamp = resolveTimestamp(value);
  if (timestamp === null) return fallback;

  const parts = new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const month = String(values.month || "").replaceAll(".", "");
  const titleCaseMonth = month ? `${month[0].toUpperCase()}${month.slice(1)}` : "";

  return [values.day, titleCaseMonth, values.year].filter(Boolean).join(" ");
}

/**
 * Presenta tiempo transcurrido en minutos, horas o días completos, sin límite de días.
 * Las fechas futuras se muestran como menos de un minuto; no programa actualizaciones.
 *
 * @param {string|number|Object|null} value - Fecha candidata.
 * @param {number} [now=Date.now()] - Instante de referencia en milisegundos.
 * @param {string} [fallback="Sin fecha"] - Texto para fecha ausente o inválida.
 * @returns {string} Etiqueta relativa abreviada.
 */
export function formatRelativeTime(value, now = Date.now(), fallback = "Sin fecha") {
  const timestamp = resolveTimestamp(value);
  if (timestamp === null) return fallback;

  const minutes = Math.max(Math.floor((now - timestamp) / MINUTE_IN_MS), 0);

  if (minutes < 1) return "Hace menos de 1 min";
  if (minutes < HOUR_IN_MINUTES) return `Hace ${minutes} min`;

  const hours = Math.floor(minutes / HOUR_IN_MINUTES);
  if (hours < DAY_IN_HOURS) return `Hace ${hours} h`;

  const days = Math.floor(hours / DAY_IN_HOURS);
  return `Hace ${days} d`;
}

/**
 * Presenta tiempo relativo con unidades completas hasta treinta días.
 * De 31 a 59 días usa Hace un mes; desde 60 muestra fecha exacta con año solo
 * si difiere del actual. Fechas futuras usan menos de un minuto.
 *
 * @param {string|number|Object|null} value - Fecha candidata.
 * @param {number} [now=Date.now()] - Instante de referencia en milisegundos.
 * @param {string} [fallback="Sin fecha"] - Texto para fecha ausente o inválida.
 * @returns {string} Etiqueta relativa o fecha exacta, sin timers.
 */
export function formatHumanDate(value, now = Date.now(), fallback = "Sin fecha") {
  const timestamp = resolveTimestamp(value);
  if (timestamp === null) return fallback;

  const minutes = Math.max(Math.floor((now - timestamp) / MINUTE_IN_MS), 0);

  if (minutes < 1) return "Hace menos de un minuto";
  if (minutes < HOUR_IN_MINUTES) {
    return `Hace ${pluralize(minutes, "minuto", "minutos")}`;
  }

  const hours = Math.floor(minutes / HOUR_IN_MINUTES);
  if (hours < DAY_IN_HOURS) {
    return `Hace ${pluralize(hours, "hora", "horas")}`;
  }

  const days = Math.floor(hours / DAY_IN_HOURS);
  if (days <= RELATIVE_DAY_LIMIT) {
    return `Hace ${pluralize(days, "día", "días")}`;
  }

  if (days < ONE_MONTH_DAY_LIMIT) {
    return "Hace un mes";
  }

  return formatExactDate(new Date(timestamp), now);
}
