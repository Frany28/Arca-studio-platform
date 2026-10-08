// `end_date` es `@db.Date` y llega serializado a medianoche UTC; formatear en la zona del
// navegador mostraba el día anterior en América (UTC-4). Se formatea siempre en UTC.
const DELIVERY_DATE_FORMATTER = new Intl.DateTimeFormat("es-VE", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export const DELIVERY_DATE_FALLBACK = "Fecha por definir";

/**
 * Formatea la fecha de entrega de un proyecto como en Figma ("24 Mar 2026"): día de dos
 * dígitos, mes abreviado con inicial mayúscula y sin punto, y año completo.
 *
 * @param {string|Date|null|undefined} value Fecha de solo día (ISO, YYYY-MM-DD o Date).
 * @returns {string} Fecha legible o el texto de respaldo si falta o no es válida.
 */
export function formatProjectDeliveryDate(value) {
  if (!value) return DELIVERY_DATE_FALLBACK;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return DELIVERY_DATE_FALLBACK;

  return DELIVERY_DATE_FORMATTER.formatToParts(date)
    .map(({ type, value: part }) => {
      if (type !== "month") return part;
      const month = part.replace(".", "");
      return month.charAt(0).toUpperCase() + month.slice(1);
    })
    .join("");
}
