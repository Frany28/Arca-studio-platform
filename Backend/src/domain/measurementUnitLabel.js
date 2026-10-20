/*
 * Presentación de unidades de medida: abreviatura de la unidad base más una denominación
 * opcional ("m²" + "de construcción" = "m² de construcción"). Es la única composición que
 * deben usar la API, las cotizaciones y el PDF. Solo es presentación: ninguna regla de
 * negocio debe depender de estos textos (las reglas usan el código estable de la base).
 */

/** Longitud máxima de una denominación personalizada (VARCHAR(80)). */
export const DENOMINATION_MAX_LENGTH = 80;

/**
 * Normaliza un texto de unidad: forma Unicode NFC, sin espacios al principio ni al final y
 * con un único espacio entre palabras. Coincide con el CHECK de PostgreSQL (sin espacios
 * sobrantes ni dobles), de modo que lo validado aquí se guarda sin rechazos.
 *
 * @param {unknown} value - Texto recibido.
 * @returns {string} Texto normalizado; cadena vacía si no hay contenido.
 */
export function normalizeUnitText(value) {
  if (value === null || value === undefined) return "";
  return String(value).normalize("NFC").trim().replace(/\s+/g, " ");
}

/**
 * Compone la etiqueta visible de una unidad a partir de su abreviatura y su denominación.
 * Sin denominación devuelve solo la abreviatura. Normaliza ambos textos para no producir
 * espacios duplicados ni resultados distintos para la misma combinación.
 *
 * @param {string} symbol - Abreviatura de la unidad base (por ejemplo, "m²").
 * @param {string|null} [denomination] - Denominación personalizada (por ejemplo, "de construcción").
 * @returns {string} Etiqueta ("m² de construcción" o "m²").
 * @throws {TypeError} Si falta la abreviatura de la unidad base.
 */
export function formatUnitLabel(symbol, denomination = null) {
  const base = normalizeUnitText(symbol);
  if (!base) throw new TypeError("formatUnitLabel requiere la abreviatura de la unidad base.");
  const detail = normalizeUnitText(denomination);
  return detail ? `${base} ${detail}` : base;
}
