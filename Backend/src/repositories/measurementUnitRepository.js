import { query } from "../config/db.js";

/**
 * Transforma una fila de measurement_units en la representación pública estable.
 * Convierte el identificador BIGINT a número y expone los nombres en camelCase.
 *
 * @param {object} row - Fila de PostgreSQL.
 * @returns {{ id: number, code: string, name: string, symbol: string, allowsDecimals: boolean,
 *   isActive: boolean }} Unidad de medida.
 */
function toMeasurementUnit(row) {
  return {
    allowsDecimals: row.allows_decimals,
    code: row.code,
    id: Number(row.id),
    isActive: row.is_active,
    name: row.name,
    symbol: row.symbol,
  };
}

/**
 * Busca una unidad de medida por id, incluidas las inactivas, para validar asignaciones.
 * Con `lockForShare` bloquea la fila hasta el fin de la transacción para que nadie la
 * desactive mientras se asigna a un servicio. Solo lee PostgreSQL.
 *
 * @param {number} unitId - Identificador de la unidad.
 * @param {object} [options] - Opciones de lectura.
 * @param {{ query: Function }} [options.executor] - Cliente de una transacción; por defecto el pool.
 * @param {boolean} [options.lockForShare] - Aplica FOR SHARE (requiere una transacción).
 * @returns {Promise<object|null>} Unidad o null si no existe.
 */
export async function findMeasurementUnitById(unitId, { executor = { query }, lockForShare = false } = {}) {
  const result = await executor.query(
    `select id, code, name, symbol, allows_decimals, is_active
     from public.measurement_units
     where id = $1
     ${lockForShare ? "for share" : ""}`,
    [unitId],
  );
  return result.rows[0] ? toMeasurementUnit(result.rows[0]) : null;
}
