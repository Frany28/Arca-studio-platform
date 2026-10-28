import { query } from "../config/db.js";
import { formatUnitOptionLabel } from "../domain/serviceUnitOptions.js";
import { toContainsPattern } from "../utils/sqlPatterns.js";

const SERVICE_COLUMNS = `
  s.id, s.code, s.name, s.description, s.kind, s.reference_rate, s.currency_code, s.is_active, s.sort_order,
  s.created_at, s.updated_at,
  u.id as unit_id, u.code as unit_code, u.name as unit_name, u.symbol as unit_symbol,
  u.allows_decimals as unit_allows_decimals, u.is_active as unit_is_active,
  d.id as denomination_id, d.denomination as denomination_text, d.is_active as denomination_is_active,
  v.version_number as current_version,
  exists (select 1 from public.quote_items qi where qi.service_id = s.id) as kind_locked`;

const SERVICE_FROM = `
  from public.services s
  inner join public.measurement_units u on u.id = s.measurement_unit_id
  left join public.measurement_unit_denominations d on d.id = s.unit_denomination_id
  left join public.service_versions v on v.service_id = s.id and v.is_current`;

/**
 * Transforma la denominación opcional de un servicio en su forma pública.
 * Devuelve null cuando el servicio usa solo la unidad base.
 *
 * @param {object} row - Fila del catálogo con las columnas de la denominación.
 * @returns {{ id: number, denomination: string, isActive: boolean }|null} Denominación o null.
 */
function toServiceDenomination(row) {
  if (row.denomination_id === null || row.denomination_id === undefined) return null;
  return { denomination: row.denomination_text, id: Number(row.denomination_id), isActive: row.denomination_is_active };
}

/**
 * Transforma una unidad vigente del servicio en su forma pública: unidad base, denominación,
 * texto comercial, etiqueta visible y tarifa (null = pendiente de validación comercial).
 *
 * @param {object} row - Fila de service_unit_options unida a su unidad y denominación.
 * @returns {object} Unidad del servicio.
 */
function toServiceUnitOption(row) {
  const unitDenomination = toServiceDenomination(row);
  return {
    id: Number(row.option_id),
    label: formatUnitOptionLabel({ denomination: unitDenomination?.denomination, presentationLabel: row.presentation_label, symbol: row.unit_symbol }),
    measurementUnit: {
      allowsDecimals: row.unit_allows_decimals,
      code: row.unit_code,
      id: Number(row.unit_id),
      isActive: row.unit_is_active,
      name: row.unit_name,
      symbol: row.unit_symbol,
    },
    position: row.position,
    presentationLabel: row.presentation_label,
    ratePending: row.reference_rate === null,
    referenceRate: row.reference_rate,
    unitDenomination,
  };
}

/**
 * Lee en una sola consulta las unidades vigentes de varios servicios, en su orden, con su unidad
 * base y su denominación. Evita una consulta por servicio al listar el catálogo.
 *
 * @param {Array<number>} serviceIds - Servicios consultados.
 * @param {{ query: Function }} executor - Pool o cliente de una transacción.
 * @returns {Promise<Map<number, Array<object>>>} Unidades por servicio.
 */
async function listServiceUnitOptions(serviceIds, executor) {
  const byService = new Map(serviceIds.map((id) => [id, []]));
  if (serviceIds.length === 0) return byService;
  const result = await executor.query(
    `select o.id as option_id, o.service_id, o.position, o.presentation_label, o.reference_rate,
       u.id as unit_id, u.code as unit_code, u.name as unit_name, u.symbol as unit_symbol,
       u.allows_decimals as unit_allows_decimals, u.is_active as unit_is_active,
       d.id as denomination_id, d.denomination as denomination_text, d.is_active as denomination_is_active
     from public.service_unit_options o
     inner join public.measurement_units u on u.id = o.measurement_unit_id
     left join public.measurement_unit_denominations d on d.id = o.unit_denomination_id
     where o.service_id = any($1::bigint[])
     order by o.service_id, o.position`,
    [serviceIds],
  );
  for (const row of result.rows) byService.get(Number(row.service_id))?.push(toServiceUnitOption(row));
  return byService;
}

/**
 * Transforma una fila del catálogo en la representación pública de un servicio: tarifa como texto
 * decimal, unidades (`unitOptions`, la primera es la principal), etiqueta de la principal
 * (`unitLabel`) y `kindLocked` si está incluido en alguna cotización (SERVICE_MODALITY_IN_USE).
 *
 * @param {object} row - Fila con columnas del servicio, su unidad, denominación y versión vigente.
 * @param {Array<object>} unitOptions - Unidades vigentes del servicio en su orden.
 * @returns {object} Servicio con su unidad de medida, denominación, unidades y versión vigente.
 */
function toService(row, unitOptions) {
  const unitDenomination = toServiceDenomination(row);
  return {
    code: row.code,
    createdAt: new Date(row.created_at).toISOString(),
    currency: row.currency_code,
    currentVersion: row.current_version === null ? null : Number(row.current_version),
    description: row.description,
    id: Number(row.id),
    isActive: row.is_active,
    kind: row.kind,
    kindLocked: row.kind_locked === true,
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
    unitDenomination,
    unitLabel: unitOptions[0]?.label
      ?? formatUnitOptionLabel({ denomination: unitDenomination?.denomination, symbol: row.unit_symbol }),
    unitOptions,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/**
 * Completa filas del catálogo con sus unidades leídas en una sola consulta adicional y las
 * transforma en servicios públicos, conservando el orden de las filas.
 *
 * @param {Array<object>} rows - Filas de servicios.
 * @param {{ query: Function }} executor - Pool o cliente de una transacción.
 * @returns {Promise<Array<object>>} Servicios públicos en el mismo orden.
 */
async function toServices(rows, executor) {
  const unitOptions = await listServiceUnitOptions(rows.map((row) => Number(row.id)), executor);
  return rows.map((row) => toService(row, unitOptions.get(Number(row.id)) ?? []));
}

/**
 * Lista servicios del catálogo en orden de visualización estable (sort_order, id) con cursor.
 * Pide un elemento adicional para que el servicio determine si existe otra página. Filtra
 * por texto en nombre o código, estado, unidad y tipo, siempre con parámetros. La unidad y la
 * denominación coinciden con cualquiera de las unidades del servicio, no solo la principal.
 *
 * @param {object} options - Filtros y paginación.
 * @param {Array<number>|null} options.cursor - [sortOrder, id] del último servicio visto.
 * @param {number} options.limit - Tamaño de página.
 * @param {string} [options.search] - Texto a buscar en nombre o código.
 * @param {boolean} [options.isActive] - Filtra por estado.
 * @param {number} [options.measurementUnitId] - Filtra por unidad (principal o alternativa).
 * @param {number} [options.unitDenominationId] - Filtra por denominación (útil para reasignar servicios).
 * @param {string} [options.kind] - Filtra por tipo de servicio.
 * @returns {Promise<Array<object>>} Hasta limit + 1 servicios.
 */
export async function listServices({ cursor, isActive, kind, limit, measurementUnitId, search, unitDenominationId }) {
  const result = await query(
    `select ${SERVICE_COLUMNS}
     ${SERVICE_FROM}
     where ($1::text is null or s.name ilike $1 escape '\\' or s.code ilike $1 escape '\\')
       and ($2::boolean is null or s.is_active = $2)
       and ($3::bigint is null or exists (
         select 1 from public.service_unit_options o where o.service_id = s.id and o.measurement_unit_id = $3))
       and ($4::public.service_kind is null or s.kind = $4)
       and ($5::integer is null or (s.sort_order, s.id) > ($5, $6::bigint))
       and ($8::bigint is null or exists (
         select 1 from public.service_unit_options o where o.service_id = s.id and o.unit_denomination_id = $8))
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
      unitDenominationId ?? null,
    ],
  );
  return toServices(result.rows, { query });
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
  if (!result.rows[0]) return null;
  const [service] = await toServices(result.rows, executor);
  return service;
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
 * Reserva el id del próximo servicio desde la secuencia de `services.id` (BIGSERIAL), para que
 * el alta pueda componer el código generado (`SERV-001`) antes de insertar. La reserva no se
 * revierte si la transacción falla: deja un salto en la numeración, igual que el autoincremento.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @returns {Promise<number>} Id reservado.
 */
export async function reserveServiceId(client) {
  const result = await client.query("select nextval(pg_get_serial_sequence('public.services', 'id')) as id");
  return Number(result.rows[0].id);
}

/**
 * Indica si ya existe un servicio con ese código (por ejemplo, uno heredado escrito a mano que
 * coincide con el formato generado). Lectura simple: la unicidad la impone uq_services_code.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {string} code - Código a comprobar.
 * @returns {Promise<boolean>} true si el código ya está en uso.
 */
export async function serviceCodeExists(client, code) {
  const result = await client.query("select 1 from public.services where code = $1 limit 1", [code]);
  return result.rowCount > 0;
}

/**
 * Inserta un servicio nuevo con el id reservado y moneda USD y devuelve su id. No crea la
 * versión: el servicio llama a insertServiceVersionSnapshot en la misma transacción.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {object} service - Datos validados del servicio.
 * @param {number} service.id - Id reservado con reserveServiceId.
 * @param {string} service.code - Código único en mayúsculas (enviado o generado).
 * @param {string} service.name - Nombre.
 * @param {string|null} service.description - Descripción opcional.
 * @param {string} service.kind - Tipo de servicio.
 * @param {number} service.measurementUnitId - Unidad de medida.
 * @param {number|null} service.unitDenominationId - Denominación opcional de esa unidad.
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
       id, code, name, description, kind, measurement_unit_id, reference_rate, currency_code, is_active, sort_order,
       created_by, updated_by, unit_denomination_id
     ) values ($1, $2, $3, $4, $5, $6, $7::numeric, $8, $9, $10, $11, $11, $12)
     returning id`,
    [service.id, service.code, service.name, service.description, service.kind, service.measurementUnitId,
      service.referenceRate, service.currency, service.isActive, service.sortOrder, service.userId,
      service.unitDenominationId ?? null],
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
         is_active = $7, sort_order = $8, updated_by = $9, unit_denomination_id = $10, updated_at = now()
     where id = $1`,
    [serviceId, state.name, state.description, state.kind, state.measurementUnitId, state.referenceRate,
      state.isActive, state.sortOrder, userId, state.unitDenominationId ?? null],
  );
  if (result.rowCount !== 1) throw new Error("service_catalog: el servicio bloqueado no se pudo actualizar.");
}

/**
 * Sustituye las unidades vigentes de un servicio por las indicadas, en posiciones 1..n. Las
 * unidades vigentes no tienen historial propio (lo conserva service_version_unit_options), así
 * que se reemplazan por completo. Debe llamarse antes de actualizar la fila del servicio (así un
 * intercambio entre la principal y una alternativa no choca con uq_service_unit_options_unit al
 * sincronizar la posición 1); el trigger diferido comprueba al COMMIT que la posición 1 coincida
 * con la unidad del servicio y que una sola unidad tenga la tarifa del servicio.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {number} serviceId - Servicio.
 * @param {Array<{ measurementUnitId: number, unitDenominationId: number|null, presentationLabel: string|null,
 *   referenceRate: string|null }>} unitOptions - Unidades canónicas en su orden.
 * @returns {Promise<void>}
 * @throws {Error} Si no se insertaron todas las unidades.
 */
export async function replaceServiceUnitOptions(client, serviceId, unitOptions) {
  await client.query("delete from public.service_unit_options where service_id = $1", [serviceId]);
  const result = await client.query(
    `insert into public.service_unit_options (service_id, position, measurement_unit_id, unit_denomination_id, presentation_label, reference_rate)
     select $1, option.position, option.measurement_unit_id, option.unit_denomination_id, option.presentation_label, option.reference_rate
     from unnest($2::smallint[], $3::bigint[], $4::bigint[], $5::varchar[], $6::numeric[])
       as option(position, measurement_unit_id, unit_denomination_id, presentation_label, reference_rate)`,
    [
      serviceId,
      unitOptions.map((_option, index) => index + 1),
      unitOptions.map((option) => option.measurementUnitId),
      unitOptions.map((option) => option.unitDenominationId),
      unitOptions.map((option) => option.presentationLabel),
      unitOptions.map((option) => option.referenceRate),
    ],
  );
  if (result.rowCount !== unitOptions.length) throw new Error("service_catalog: no se registraron todas las unidades del servicio.");
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
 * Registra una versión vigente copiando el estado actual del servicio, de su unidad principal y
 * de su denominación. El trigger service_versions_snapshot_unit_options copia además todas sus
 * unidades vigentes (unidad, denominación, texto comercial y tarifa), por lo que las unidades
 * deben estar ya escritas. La copia conserva los datos históricos aunque cambien después.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {object} version - Datos de la versión.
 * @param {number} version.serviceId - Servicio versionado.
 * @param {number} version.versionNumber - Número de la nueva versión.
 * @param {number} version.userId - Administrador responsable.
 * @param {string|null} version.changeNote - Motivo del cambio.
 * @returns {Promise<number>} Id de la versión registrada.
 * @throws {Error} Si no se insertó exactamente una versión.
 */
export async function insertServiceVersionSnapshot(client, { changeNote, serviceId, userId, versionNumber }) {
  const result = await client.query(
    `insert into public.service_versions (
       service_id, version_number, code, name, description, kind, measurement_unit_id, unit_code, unit_name,
       unit_symbol, unit_allows_decimals, reference_rate, currency_code, is_active, sort_order, change_note, changed_by,
       unit_denomination_id, unit_denomination
     )
     select s.id, $2, s.code, s.name, s.description, s.kind, u.id, u.code, u.name, u.symbol, u.allows_decimals,
       s.reference_rate, s.currency_code, s.is_active, s.sort_order, $3, $4, d.id, d.denomination
     from public.services s
     inner join public.measurement_units u on u.id = s.measurement_unit_id
     left join public.measurement_unit_denominations d on d.id = s.unit_denomination_id
     where s.id = $1
     returning id`,
    [serviceId, versionNumber, changeNote, userId],
  );
  if (result.rowCount !== 1) throw new Error("service_catalog: no se pudo registrar la versión del servicio.");
  return Number(result.rows[0].id);
}

/**
 * Bloquea con FOR SHARE, en orden de id, los servicios que se incluirán en una cotización y
 * devuelve su versión vigente leída en una sentencia posterior. FOR SHARE excluye el FOR UPDATE
 * de una edición del servicio: si la edición gana, esta lectura ve su versión nueva; si gana la
 * cotización, la edición espera y después ve el concepto (SERVICE_MODALITY_IN_USE). El orden por
 * id evita interbloqueos entre cotizaciones que comparten servicios.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {Array<number>} serviceIds - Servicios sin repetir.
 * @returns {Promise<Map<number, { isActive: boolean, currentVersionId: number|null }>>} Estado por servicio
 *   existente; los ausentes no existen.
 */
export async function lockQuotableServices(client, serviceIds) {
  await client.query("select id from public.services where id = any($1::bigint[]) order by id for share", [serviceIds]);
  const result = await client.query(
    `select s.id, s.is_active, v.id as version_id
     from public.services s
     left join public.service_versions v on v.service_id = s.id and v.is_current
     where s.id = any($1::bigint[])`,
    [serviceIds],
  );
  return new Map(result.rows.map((row) => [
    Number(row.id),
    { currentVersionId: row.version_id === null ? null : Number(row.version_id), isActive: row.is_active },
  ]));
}

/**
 * Lee las unidades copiadas de las versiones de servicios que fija una cotización: posición,
 * tarifa de referencia (null = pendiente de validación comercial) y si la unidad admite decimales.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {Array<number>} versionIds - Versiones de servicio.
 * @returns {Promise<Map<number, Array<{ id: number, position: number, referenceRate: string|null,
 *   unitAllowsDecimals: boolean }>>>} Unidades por versión, en su orden.
 */
export async function findServiceVersionUnitOptions(client, versionIds) {
  const result = await client.query(
    `select id, service_version_id, position, reference_rate, unit_allows_decimals
     from public.service_version_unit_options
     where service_version_id = any($1::bigint[])
     order by service_version_id, position`,
    [versionIds],
  );
  const byVersion = new Map(versionIds.map((id) => [id, []]));
  for (const row of result.rows) {
    byVersion.get(Number(row.service_version_id))?.push({
      id: Number(row.id),
      position: row.position,
      referenceRate: row.reference_rate,
      unitAllowsDecimals: row.unit_allows_decimals,
    });
  }
  return byVersion;
}
