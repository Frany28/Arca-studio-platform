import { query } from "../config/db.js";
import { formatUnitLabel } from "../domain/measurementUnitLabel.js";

const DENOMINATION_COLUMNS = `
  d.id, d.public_code, d.denomination, d.is_active, d.created_at, d.updated_at,
  u.id as unit_id, u.code as unit_code, u.name as unit_name, u.symbol as unit_symbol,
  u.allows_decimals as unit_allows_decimals, u.is_active as unit_is_active, u.sort_order as unit_sort_order,
  (select count(*) from public.services s where s.unit_denomination_id = d.id and s.is_active)::int as active_service_count,
  (not exists (select 1 from public.services s where s.unit_denomination_id = d.id)
    and not exists (select 1 from public.service_versions v where v.unit_denomination_id = d.id)) as base_unit_editable`;

const DENOMINATION_FROM = `
  from public.measurement_unit_denominations d
  inner join public.measurement_units u on u.id = d.measurement_unit_id`;

/**
 * Transforma una fila de denominación en la representación pública estable, con su código
 * público (UNID-001, generado por PostgreSQL), su unidad base, la etiqueta compuesta, los servicios
 * activos que la usan y si su base puede cambiar (sin servicios ni versiones que la referencien).
 *
 * @param {object} row - Fila con columnas de la denominación y de su unidad base.
 * @returns {object} Denominación pública.
 */
function toDenomination(row) {
  return {
    activeServiceCount: row.active_service_count,
    baseUnitEditable: row.base_unit_editable,
    createdAt: new Date(row.created_at).toISOString(),
    denomination: row.denomination,
    id: Number(row.id),
    isActive: row.is_active,
    label: formatUnitLabel(row.unit_symbol, row.denomination),
    publicCode: row.public_code,
    measurementUnit: {
      allowsDecimals: row.unit_allows_decimals,
      code: row.unit_code,
      id: Number(row.unit_id),
      isActive: row.unit_is_active,
      name: row.unit_name,
      sortOrder: row.unit_sort_order,
      symbol: row.unit_symbol,
    },
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/**
 * Escapa los comodines de ILIKE para que la búsqueda trate %, _ y \ como texto literal.
 * Se usa junto con `escape '\'` en la consulta.
 *
 * @param {string} value - Texto buscado por el usuario.
 * @returns {string} Patrón `%texto%` con comodines escapados.
 */
function toContainsPattern(value) {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/**
 * Lista denominaciones en orden estable (orden de la unidad base, texto, id) con cursor.
 * Pide un elemento adicional para que el servicio determine si existe otra página. Busca
 * literalmente en el código público, la denominación y la abreviatura de la base.
 *
 * @param {object} options - Filtros y paginación.
 * @param {Array<unknown>|null} options.cursor - [sortOrder, denominación, id] del último elemento visto.
 * @param {number} options.limit - Tamaño de página.
 * @param {number} [options.measurementUnitId] - Filtra por unidad base.
 * @param {boolean} [options.isActive] - Filtra por estado.
 * @param {string} [options.search] - Texto a buscar.
 * @returns {Promise<Array<object>>} Hasta limit + 1 denominaciones.
 */
export async function listDenominations({ cursor, isActive, limit, measurementUnitId, search }) {
  const result = await query(
    `select ${DENOMINATION_COLUMNS}
     ${DENOMINATION_FROM}
     where ($1::bigint is null or d.measurement_unit_id = $1)
       and ($2::boolean is null or d.is_active = $2)
       and ($3::text is null or d.public_code ilike $3 escape '\\' or d.denomination ilike $3 escape '\\'
         or u.symbol ilike $3 escape '\\')
       and ($4::integer is null or (u.sort_order, d.denomination, d.id) > ($4, $5::text, $6::bigint))
     order by u.sort_order, d.denomination, d.id
     limit $7`,
    [
      measurementUnitId ?? null,
      isActive ?? null,
      search ? toContainsPattern(search) : null,
      cursor?.[0] ?? null,
      cursor?.[1] ?? null,
      cursor?.[2] ?? null,
      limit + 1,
    ],
  );
  return result.rows.map(toDenomination);
}

/**
 * Busca una denominación por id con su unidad base y su uso por servicios activos.
 * Dentro de una transacción ve los cambios no confirmados de esa misma transacción.
 *
 * @param {number} denominationId - Identificador de la denominación.
 * @param {{ query: Function }} [executor] - Cliente de una transacción; por defecto el pool.
 * @returns {Promise<object|null>} Denominación o null si no existe.
 */
export async function findDenominationById(denominationId, executor = { query }) {
  const result = await executor.query(`select ${DENOMINATION_COLUMNS} ${DENOMINATION_FROM} where d.id = $1`, [denominationId]);
  return result.rows[0] ? toDenomination(result.rows[0]) : null;
}

/**
 * Bloquea una denominación y devuelve su estado actual leído en una sentencia posterior.
 * FOR UPDATE se usa para editarla o desactivarla; FOR SHARE para asignarla a un servicio.
 * Ambos modos se excluyen entre sí, de modo que nadie puede desactivar una denominación
 * mientras otra transacción la asigna, y la lectura posterior ve lo confirmado por la otra.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {number} denominationId - Identificador de la denominación.
 * @param {"update"|"share"} mode - Modo de bloqueo.
 * @returns {Promise<object|null>} Denominación o null si no existe.
 */
export async function lockDenomination(client, denominationId, mode) {
  const lockClause = mode === "update" ? "for update" : "for share";
  const locked = await client.query(
    `select id from public.measurement_unit_denominations where id = $1 ${lockClause}`,
    [denominationId],
  );
  if (!locked.rows[0]) return null;
  return findDenominationById(denominationId, client);
}

/**
 * Inserta una denominación activa para una unidad base y devuelve su id. La unicidad de
 * denominaciones equivalentes la garantiza el índice uq_measurement_unit_denominations_key.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {object} denomination - Datos validados.
 * @param {number} denomination.measurementUnitId - Unidad base.
 * @param {string} denomination.denomination - Texto normalizado.
 * @param {number} denomination.userId - Administrador responsable.
 * @returns {Promise<number>} Id de la denominación creada.
 */
export async function insertDenomination(client, { denomination, measurementUnitId, userId }) {
  const result = await client.query(
    `insert into public.measurement_unit_denominations (measurement_unit_id, denomination, created_by, updated_by)
     values ($1, $2, $3, $3)
     returning id`,
    [measurementUnitId, denomination, userId],
  );
  return Number(result.rows[0].id);
}

/**
 * Cuenta las referencias de una denominación en servicios (de cualquier estado) y en versiones
 * históricas. Se llama tras bloquearla FOR UPDATE para ver las referencias ya confirmadas.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {number} denominationId - Identificador de la denominación.
 * @returns {Promise<{ serviceCount: number, versionCount: number }>} Referencias encontradas.
 */
export async function countDenominationReferences(client, denominationId) {
  const result = await client.query(
    `select (select count(*) from public.services where unit_denomination_id = $1)::int as service_count,
       (select count(*) from public.service_versions where unit_denomination_id = $1)::int as version_count`,
    [denominationId],
  );
  return { serviceCount: result.rows[0].service_count, versionCount: result.rows[0].version_count };
}

/**
 * Actualiza el texto, el estado y la unidad base de una denominación y registra al responsable.
 * El trigger de PostgreSQL rechaza el cambio de base si existen servicios o versiones que la usen.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {number} denominationId - Identificador de la denominación.
 * @param {{ denomination: string, isActive: boolean, measurementUnitId: number }} state - Estado completo resultante.
 * @param {number} userId - Administrador responsable.
 * @returns {Promise<void>}
 * @throws {Error} Si la fila no existe (no debería ocurrir tras el bloqueo).
 */
export async function updateDenominationRecord(client, denominationId, { denomination, isActive, measurementUnitId }, userId) {
  const result = await client.query(
    `update public.measurement_unit_denominations
     set denomination = $2, is_active = $3, measurement_unit_id = $4, updated_by = $5, updated_at = now()
     where id = $1`,
    [denominationId, denomination, isActive, measurementUnitId, userId],
  );
  if (result.rowCount !== 1) throw new Error("measurement_units: la denominación bloqueada no se pudo actualizar.");
}
