/**
 * Escapa los comodines de ILIKE para que la búsqueda trate %, _ y \ como texto literal.
 * Se usa junto con `escape '\'` en la consulta parametrizada; nunca se concatena en el SQL.
 *
 * @param {string} value - Texto buscado por el usuario.
 * @returns {string} Patrón `%texto%` con comodines escapados.
 */
export function toContainsPattern(value) {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}
