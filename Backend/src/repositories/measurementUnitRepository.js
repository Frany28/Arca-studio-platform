import { query } from "../config/db.js";

const UNIT_COLUMNS = "id, code, name, symbol, allows_decimals, is_active, sort_order";

/**
 * Transforma una fila de measurement_units en la representación pública estable.
 * Convierte el identificador BIGINT a número y expone los nombres en camelCase.
 *
 * @param {object} row - Fila de PostgreSQL.
 * @returns {{ id: number, code: string, name: string, symbol: string, allowsDecimals: boolean,
 *   isActive: boolean, sortOrder: number }} Unidad de medida base.
 */
function toMeasurementUnit(row) {
  return {
    allowsDecimals: row.allows_decimals,
    code: row.code,
    id: Number(row.id),
    isActive: row.is_active,
    name: row.name,
    sortOrder: row.sort_order,
    symbol: row.symbol,
  };
}

/**
 * Lista el catálogo de unidades base en orden de visualización estable (sort_order, id).
 * Es un catálogo acotado que solo crece mediante cargas autorizadas, por eso no se pagina.
 * Por defecto devuelve solo las activas, que son las seleccionables en formularios.
 *
 * @param {object} [options] - Opciones de consulta.
 * @param {boolean} [options.includeInactive] - Incluye unidades inactivas.
 * @returns {Promise<Array<object>>} Unidades base.
 */
export async function listMeasurementUnits({ includeInactive = false } = {}) {
  const result = await query(
    `select ${UNIT_COLUMNS}
     from public.measurement_units
     where $1::boolean or is_active
     order by sort_order, id`,
    [includeInactive],
  );
  return result.rows.map(toMeasurementUnit);
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
    `select ${UNIT_COLUMNS}
     from public.measurement_units
     where id = $1
     ${lockForShare ? "for share" : ""}`,
    [unitId],
  );
  return result.rows[0] ? toMeasurementUnit(result.rows[0]) : null;
}
