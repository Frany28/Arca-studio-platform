const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Interpreta el valor de página limit y descarta los formatos que no sean válidos.
 * Centraliza este comportamiento para que sus consumidores utilicen el mismo criterio.
 *
 * @param {unknown} value - Valor de `value` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
export function parsePageLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

/**
 * Devuelve la expresión SQL que serializa una marca temporal del cursor en ISO-8601 UTC con
 * microsegundos, la precisión de `timestamptz`. Un `Date` de JavaScript la trunca a milisegundos:
 * filas creadas en el mismo milisegundo (p. ej. en una sola transacción) quedarían fuera de la
 * comparación `(fecha, id) < cursor` y la página siguiente las omitiría.
 *
 * @param {string} column - Columna `timestamptz` calificada (constante del código, nunca entrada externa).
 * @returns {string} Expresión SQL para seleccionar el valor del cursor como texto.
 */
export function preciseCursorTimestampSql(column) {
  return `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/**
 * Codifica el valor de cursor en una representación segura para transporte.
 * Centraliza este comportamiento para que sus consumidores utilicen el mismo criterio.
 *
 * @param {Array<unknown>} values - Valor de `values` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
export function encodeCursor(values) {
  return Buffer.from(JSON.stringify(values), "utf8").toString("base64url");
}

/**
 * Decodifica el valor de cursor y valida que conserve la estructura esperada.
 * Centraliza este comportamiento para que sus consumidores utilicen el mismo criterio.
 *
 * @param {unknown} value - Valor de `value` requerido por esta operación.
 * @param {number} [expectedLength] - Valor de `expectedLength` requerido por esta operación.
 * @returns {object} Resultado producido por la operación.
 */
export function decodeCursor(value, expectedLength = 2) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    return Array.isArray(parsed) && parsed.length === expectedLength ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Construye el valor de result incluyendo el cursor necesario para continuar la consulta.
 * Centraliza este comportamiento para que sus consumidores utilicen el mismo criterio.
 *
 * @param {Array<unknown>} rows - Filas obtenidas desde PostgreSQL.
 * @param {number} limit - Valor de `limit` requerido por esta operación.
 * @param {Function} mapper - Valor de `mapper` requerido por esta operación.
 * @param {Array<unknown>} cursorValues - Valor de `cursorValues` requerido por esta operación.
 * @returns {object} Resultado producido por la operación.
 */
export function pageResult(rows, limit, mapper, cursorValues) {
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  const last = visible.at(-1);
  return {
    items: visible.map(mapper),
    nextCursor: hasMore && last ? encodeCursor(cursorValues(last)) : null,
  };
}
