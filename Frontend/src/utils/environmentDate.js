const ENVIRONMENT_DATE_FORMATTER = new Intl.DateTimeFormat("es-VE", {
  day: "numeric",
  month: "long",
  weekday: "long",
});

/**
 * Capitaliza la primera letra respetando caracteres acentuados.
 *
 * @param {string} value Texto en minúsculas devuelto por Intl.
 * @returns {string} Texto con inicial mayúscula.
 */
function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Formatea la fecha del navbar como en Figma ("Lunes, 23 de Marzo"): día de la semana y
 * mes con inicial mayúscula. Usa formatToParts para no depender de la puntuación local.
 *
 * @param {Date} [date=new Date()] Fecha a presentar.
 * @returns {string} Fecha legible del navbar.
 */
export function formatEnvironmentDate(date = new Date()) {
  const parts = Object.fromEntries(
    ENVIRONMENT_DATE_FORMATTER.formatToParts(date).map(({ type, value }) => [type, value]),
  );

  return `${capitalize(parts.weekday)}, ${parts.day} de ${capitalize(parts.month)}`;
}
