import { query } from "../config/db.js";

const SERVICE_COLUMNS = `
  s.id, s.code, s.name, s.description, s.kind, s.reference_rate, s.currency_code, s.is_active, s.sort_order,
  s.created_at, s.updated_at,
  u.id as unit_id, u.code as unit_code, u.name as unit_name, u.symbol as unit_symbol,
  u.allows_decimals as unit_allows_decimals, u.is_active as unit_is_active,
  v.version_number as current_version`;

const SERVICE_FROM = `
  from public.services s
  inner join public.measurement_units u on u.id = s.measurement_unit_id
  left join public.service_versions v on v.service_id = s.id and v.is_current`;

/**
 * Transforma una fila del catálogo en la representación pública estable de un servicio.
 * La tarifa se conserva como texto decimal de PostgreSQL ("12.00") para no perder precisión.
 *
 * @param {object} row - Fila con columnas del servicio, su unidad y su versión vigente.
 * @returns {object} Servicio con su unidad de medida y número de versión vigente.
 */
function toService(row) {
  return {
    code: row.code,
    createdAt: new Date(row.created_at).toISOString(),
    currency: row.currency_code,
    currentVersion: row.current_version === null ? null : Number(row.current_version),
    description: row.description,
    id: Number(row.id),
    isActive: row.is_active,
    kind: row.kind,
    measurementUnit: {
      allowsDecimals: row.unit_allows_decimals,
      code: row.unit_code,
      id: Number(row.unit_id),
      isActive: row.unit_is_active,
      name: row.unit_name,
      symbol: row.unit_symbol,
    },
    name: row.name,
    referenceRate: row.reference_rate,
    sortOrder: row.sort_order,
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
 * Lista servicios del catálogo en orden de visualización estable (sort_order, id) con cursor.
 * Pide un elemento adicional para que el servicio determine si existe otra página. Filtra
 * por texto en nombre o código, estado, unidad y tipo, siempre con parámetros.
 *
 * @param {object} options - Filtros y paginación.
 * @param {Array<number>|null} options.cursor - [sortOrder, id] del último servicio visto.
 * @param {number} options.limit - Tamaño de página.
 * @param {string} [options.search] - Texto a buscar en nombre o código.
 * @param {boolean} [options.isActive] - Filtra por estado.
 * @param {number} [options.measurementUnitId] - Filtra por unidad.
 * @param {string} [options.kind] - Filtra por tipo de servicio.
 * @returns {Promise<Array<object>>} Hasta limit + 1 servicios.
 */
export async function listServices({ cursor, isActive, kind, limit, measurementUnitId, search }) {
  const result = await query(
    `select ${SERVICE_COLUMNS}
     ${SERVICE_FROM}
     where ($1::text is null or s.name ilike $1 escape '\\' or s.code ilike $1 escape '\\')
       and ($2::boolean is null or s.is_active = $2)
       and ($3::bigint is null or s.measurement_unit_id = $3)
       and ($4::public.service_kind is null or s.kind = $4)
       and ($5::integer is null or (s.sort_order, s.id) > ($5, $6::bigint))
     order by s.sort_order, s.id
     limit $7`,
    [
      search ? toContainsPattern(search) : null,
      isActive ?? null,
      measurementUnitId ?? null,
      kind ?? null,
      cursor?.[0] ?? null,
      cursor?.[1] ?? null,
      limit + 1,
    ],
  );
  return result.rows.map(toService);
}

/**
 * Busca un servicio por id con su unidad y su versión vigente.
 * Dentro de una transacción ve los cambios no confirmados de esa misma transacción.
 *
 * @param {number} serviceId - Identificador del servicio.
 * @param {{ query: Function }} [executor] - Cliente de una transacción; por defecto el pool.
 * @returns {Promise<object|null>} Servicio o null si no existe.
 */
export async function findServiceById(serviceId, executor = { query }) {
  const result = await executor.query(`select ${SERVICE_COLUMNS} ${SERVICE_FROM} where s.id = $1`, [serviceId]);
  return result.rows[0] ? toService(result.rows[0]) : null;
}

/**
 * Bloquea la fila del servicio (FOR UPDATE) y devuelve su estado con la versión vigente.
 * La versión se lee en una sentencia posterior al bloqueo: en READ COMMITTED cada sentencia
 * toma una instantánea nueva, de modo que tras esperar a otra transacción se obtiene la
 * versión que esta acaba de confirmar (un JOIN en la sentencia del bloqueo podría devolver
 * la versión anterior de la tabla unida).
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {number} serviceId - Identificador del servicio.
 * @returns {Promise<object|null>} Servicio bloqueado o null si no existe.
 */
export async function lockServiceForUpdate(client, serviceId) {
  const locked = await client.query("select id from public.services where id = $1 for update", [serviceId]);
  if (!locked.rows[0]) return null;
  return findServiceById(serviceId, client);
}

/**
 * Inserta un servicio nuevo con moneda USD y devuelve su id. No crea la versión: el servicio
 * llama a insertServiceVersionSnapshot en la misma transacción.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {object} service - Datos validados del servicio.
 * @param {string} service.code - Código único en mayúsculas.
 * @param {string} service.name - Nombre.
 * @param {string|null} service.description - Descripción opcional.
 * @param {string} service.kind - Tipo de servicio.
 * @param {number} service.measurementUnitId - Unidad de medida.
 * @param {string} service.referenceRate - Tarifa como texto decimal.
 * @param {string} service.currency - Moneda (USD).
 * @param {boolean} service.isActive - Estado inicial.
 * @param {number} service.sortOrder - Orden de visualización.
 * @param {number} service.userId - Administrador responsable.
 * @returns {Promise<number>} Id del servicio creado.
 */
export async function insertServiceRecord(client, service) {
  const result = await client.query(
    `insert into public.services (
       code, name, description, kind, measurement_unit_id, reference_rate, currency_code, is_active, sort_order,
       created_by, updated_by
     ) values ($1, $2, $3, $4, $5, $6::numeric, $7, $8, $9, $10, $10)
     returning id`,
    [service.code, service.name, service.description, service.kind, service.measurementUnitId,
      service.referenceRate, service.currency, service.isActive, service.sortOrder, service.userId],
  );
  return Number(result.rows[0].id);
}

/**
 * Actualiza los campos editables de un servicio y registra al responsable y la fecha.
 * El código y la moneda no se modifican.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {number} serviceId - Identificador del servicio.
 * @param {object} state - Estado completo resultante (mergeServiceChanges).
 * @param {number} userId - Administrador responsable.
 * @returns {Promise<void>}
 * @throws {Error} Si la fila no existe (no debería ocurrir tras el bloqueo).
 */
export async function updateServiceRecord(client, serviceId, state, userId) {
  const result = await client.query(
    `update public.services
     set name = $2, description = $3, kind = $4, measurement_unit_id = $5, reference_rate = $6::numeric,
         is_active = $7, sort_order = $8, updated_by = $9, updated_at = now()
     where id = $1`,
    [serviceId, state.name, state.description, state.kind, state.measurementUnitId, state.referenceRate,
      state.isActive, state.sortOrder, userId],
  );
  if (result.rowCount !== 1) throw new Error("service_catalog: el servicio bloqueado no se pudo actualizar.");
}

/**
 * Retira la marca de vigencia de la versión actual del servicio (único cambio que permite
 * el trigger de inmutabilidad). Exige que exista exactamente una versión vigente.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {number} serviceId - Identificador del servicio.
 * @returns {Promise<void>}
 * @throws {Error} Si no había exactamente una versión vigente.
 */
export async function retireCurrentServiceVersion(client, serviceId) {
  const result = await client.query(
    "update public.service_versions set is_current = false where service_id = $1 and is_current",
    [serviceId],
  );
  if (result.rowCount !== 1) throw new Error("service_catalog: el servicio no tenía exactamente una versión vigente.");
}

/**
 * Registra una versión vigente copiando el estado actual del servicio y de su unidad.
 * Copiar la unidad conserva su nombre y símbolo históricos aunque la unidad cambie después.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {object} version - Datos de la versión.
 * @param {number} version.serviceId - Servicio versionado.
 * @param {number} version.versionNumber - Número de la nueva versión.
 * @param {number} version.userId - Administrador responsable.
 * @param {string|null} version.changeNote - Motivo del cambio.
 * @returns {Promise<void>}
 * @throws {Error} Si no se insertó exactamente una versión.
 */
export async function insertServiceVersionSnapshot(client, { changeNote, serviceId, userId, versionNumber }) {
  const result = await client.query(
    `insert into public.service_versions (
       service_id, version_number, code, name, description, kind, measurement_unit_id, unit_code, unit_name,
       unit_symbol, unit_allows_decimals, reference_rate, currency_code, is_active, sort_order, change_note, changed_by
     )
     select s.id, $2, s.code, s.name, s.description, s.kind, u.id, u.code, u.name, u.symbol, u.allows_decimals,
       s.reference_rate, s.currency_code, s.is_active, s.sort_order, $3, $4
     from public.services s
     inner join public.measurement_units u on u.id = s.measurement_unit_id
     where s.id = $1`,
    [serviceId, versionNumber, changeNote, userId],
  );
  if (result.rowCount !== 1) throw new Error("service_catalog: no se pudo registrar la versión del servicio.");
}
