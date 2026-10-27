import { query } from "../config/db.js";
import { formatUnitLabel } from "../domain/measurementUnitLabel.js";
import { QUOTE_SORT_DIRECTIONS, QUOTE_SORT_FIELDS } from "../domain/quote.js";
import { toContainsPattern } from "../utils/sqlPatterns.js";

const QUOTE_SUMMARY_COLUMNS = `
  q.id, q.code, q.created_at, q.updated_at,
  v.version_number, v.client_id, v.client_name, v.project_id, v.project_name, v.services_total, v.currency_code`;

const QUOTE_FROM = `
  from public.quotes q
  inner join public.quote_versions v on v.quote_id = q.id and v.is_current`;

// Fragmentos de orden en lista blanca: la consulta solo interpola estas constantes, nunca la entrada.
// Los valores del cursor ocupan los parámetros $4 (y $5 por total); el código deriva del id.
const LIST_ORDERS = Object.freeze({
  [QUOTE_SORT_FIELDS.CODE]: Object.freeze({
    [QUOTE_SORT_DIRECTIONS.ASC]: { cursor: "q.id > $4::bigint", order: "q.id asc" },
    [QUOTE_SORT_DIRECTIONS.DESC]: { cursor: "q.id < $4::bigint", order: "q.id desc" },
  }),
  [QUOTE_SORT_FIELDS.TOTAL]: Object.freeze({
    [QUOTE_SORT_DIRECTIONS.ASC]: { cursor: "(v.services_total, q.id) > ($4::numeric, $5::bigint)", order: "v.services_total asc, q.id asc" },
    [QUOTE_SORT_DIRECTIONS.DESC]: { cursor: "(v.services_total, q.id) < ($4::numeric, $5::bigint)", order: "v.services_total desc, q.id desc" },
  }),
});

/**
 * Valores del cursor en el orden de sus parámetros: por código solo el id; por total, el
 * total y el id de desempate.
 *
 * @param {string} sort - Campo de orden.
 * @param {Array<string>|null} cursor - [clave, id] del último registro visto.
 * @returns {Array<string>} Parámetros a partir de $4.
 */
function cursorParameters(sort, cursor) {
  if (!cursor) return [];
  return sort === QUOTE_SORT_FIELDS.TOTAL ? [cursor[0], cursor[1]] : [cursor[1]];
}

/**
 * Compone el nombre visible de un usuario a partir de sus columnas de nombre y apellido.
 * Omite las partes vacías para no dejar espacios sobrantes.
 *
 * @param {string|null} firstName - Nombre.
 * @param {string|null} lastName - Apellido.
 * @returns {string} Nombre completo sin espacios sobrantes.
 */
function toUserName(firstName, lastName) {
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

/**
 * Transforma una fila del listado en la representación pública de una cotización.
 * Los importes se conservan como texto decimal de PostgreSQL para no perder precisión.
 *
 * @param {object} row - Fila con la cotización y su versión vigente.
 * @returns {object} Resumen de la cotización.
 */
function toQuoteSummary(row) {
  return {
    client: { id: Number(row.client_id), name: row.client_name },
    code: row.code,
    createdAt: new Date(row.created_at).toISOString(),
    currency: row.currency_code,
    currentVersion: Number(row.version_number),
    id: Number(row.id),
    project: { id: Number(row.project_id), name: row.project_name },
    servicesTotal: row.services_total,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/**
 * Transforma un concepto con la copia de la versión del servicio cotizada. `serviceIsActive`
 * describe el estado actual del servicio en el tabulador (no el histórico), para que el
 * formulario de edición sepa si puede volver a ofrecerlo.
 *
 * @param {object} row - Fila de quote_items unida a service_versions y services.
 * @returns {object} Concepto público.
 */
function toQuoteItem(row) {
  return {
    lineNumber: row.line_number,
    quantity: row.quantity,
    referenceRate: row.reference_rate,
    service: {
      code: row.service_code,
      description: row.service_description,
      id: Number(row.service_id),
      isActive: row.service_is_active,
      kind: row.service_kind,
      name: row.service_name,
      versionId: Number(row.service_version_id),
    },
    subtotal: row.subtotal,
    unit: {
      allowsDecimals: row.unit_allows_decimals,
      label: formatUnitLabel(row.unit_symbol, row.unit_denomination),
    },
    unitRate: row.unit_rate,
  };
}

/**
 * Lista cotizaciones con su versión vigente, búsqueda, intervalo de fechas y cursor estable.
 * Pide un elemento adicional para que el servicio determine si existe otra página. Busca en el
 * código y en los nombres copiados del cliente y del proyecto.
 *
 * @param {object} options - Filtros, orden y paginación ya validados.
 * @param {string} [options.search] - Texto a buscar.
 * @param {string} [options.createdFrom] - Instante inicial incluido (ISO 8601).
 * @param {string} [options.createdBefore] - Instante final excluido (ISO 8601).
 * @param {string} options.sort - Campo de orden (QUOTE_SORT_FIELDS).
 * @param {string} options.direction - Dirección (QUOTE_SORT_DIRECTIONS).
 * @param {Array<string>|null} options.cursor - [clave, id] del último registro visto.
 * @param {number} options.limit - Tamaño de página.
 * @returns {Promise<Array<object>>} Hasta limit + 1 cotizaciones.
 */
export async function listQuotes({ createdBefore, createdFrom, cursor, direction, limit, search, sort }) {
  const order = LIST_ORDERS[sort][direction];
  const cursorValues = cursorParameters(sort, cursor);
  const result = await query(
    `select ${QUOTE_SUMMARY_COLUMNS}
     ${QUOTE_FROM}
     where ($1::text is null or q.code ilike $1 escape '\\' or v.client_name ilike $1 escape '\\' or v.project_name ilike $1 escape '\\')
       and ($2::timestamptz is null or q.created_at >= $2)
       and ($3::timestamptz is null or q.created_at < $3)
       and ${cursorValues.length ? order.cursor : "true"}
     order by ${order.order}
     limit $${4 + cursorValues.length}`,
    [search ? toContainsPattern(search) : null, createdFrom ?? null, createdBefore ?? null, ...cursorValues, limit + 1],
  );
  return result.rows.map(toQuoteSummary);
}

/**
 * Cuenta las cotizaciones registradas, para el indicador «Cotizaciones totales».
 *
 * @returns {Promise<number>} Total de cotizaciones.
 */
export async function countQuotes() {
  const result = await query("select count(*)::bigint as total from public.quotes");
  return Number(result.rows[0].total);
}

/**
 * Lee los conceptos de una versión con la copia de la versión del servicio cotizada y el
 * estado actual del servicio en el tabulador, en el orden del documento.
 *
 * @param {number} quoteVersionId - Versión de la cotización.
 * @param {{ query: Function }} executor - Pool o cliente de una transacción.
 * @returns {Promise<Array<object>>} Conceptos en su orden.
 */
async function listQuoteItems(quoteVersionId, executor) {
  const result = await executor.query(
    `select i.line_number, i.service_id, i.service_version_id, i.quantity, i.unit_rate, i.reference_rate, i.subtotal,
       sv.code as service_code, sv.name as service_name, sv.description as service_description, sv.kind as service_kind,
       sv.unit_symbol, sv.unit_denomination, sv.unit_allows_decimals, s.is_active as service_is_active
     from public.quote_items i
     inner join public.service_versions sv on sv.id = i.service_version_id
     inner join public.services s on s.id = i.service_id
     where i.quote_version_id = $1
     order by i.line_number`,
    [quoteVersionId],
  );
  return result.rows.map(toQuoteItem);
}

/**
 * Busca una cotización con su versión vigente, sus conceptos, su autor y el autor de la versión.
 * Dentro de una transacción ve los cambios no confirmados de esa misma transacción.
 *
 * @param {number} quoteId - Identificador de la cotización.
 * @param {{ query: Function }} [executor] - Cliente de una transacción; por defecto el pool.
 * @returns {Promise<object|null>} Cotización completa o null si no existe.
 */
export async function findQuoteById(quoteId, executor = { query }) {
  const result = await executor.query(
    `select ${QUOTE_SUMMARY_COLUMNS},
       v.id as version_id, v.notes, v.created_at as version_created_at,
       author.id as author_id, author.first_name as author_first_name, author.last_name as author_last_name,
       editor.id as editor_id, editor.first_name as editor_first_name, editor.last_name as editor_last_name,
       (editor.profile_photo_url is not null and btrim(editor.profile_photo_url) <> '') as editor_has_profile_photo
     ${QUOTE_FROM}
     inner join public.users author on author.id = q.created_by
     inner join public.users editor on editor.id = v.created_by
     where q.id = $1`,
    [quoteId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    ...toQuoteSummary(row),
    createdBy: { id: Number(row.author_id), name: toUserName(row.author_first_name, row.author_last_name) },
    items: await listQuoteItems(row.version_id, executor),
    notes: row.notes,
    version: {
      createdAt: new Date(row.version_created_at).toISOString(),
      createdBy: {
        hasProfilePhoto: row.editor_has_profile_photo,
        id: Number(row.editor_id),
        name: toUserName(row.editor_first_name, row.editor_last_name),
      },
      id: Number(row.version_id),
    },
  };
}

/**
 * Bloquea la fila de la cotización (FOR UPDATE) y devuelve su estado vigente. La versión se lee
 * en una sentencia posterior al bloqueo: en READ COMMITTED cada sentencia toma una instantánea
 * nueva, así que tras esperar a otra edición se obtiene la versión que esta acaba de confirmar.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {number} quoteId - Identificador de la cotización.
 * @returns {Promise<object|null>} Cotización bloqueada o null si no existe.
 */
export async function lockQuoteForUpdate(client, quoteId) {
  const locked = await client.query("select id from public.quotes where id = $1 for update", [quoteId]);
  if (!locked.rows[0]) return null;
  return findQuoteById(quoteId, client);
}

/**
 * Reserva el id de la próxima cotización desde la secuencia de `quotes.id`, para componer el
 * código `COT-001` antes de insertar. La reserva no se revierte si la transacción falla.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @returns {Promise<number>} Id reservado.
 */
export async function reserveQuoteId(client) {
  const result = await client.query("select nextval(pg_get_serial_sequence('public.quotes', 'id')) as id");
  return Number(result.rows[0].id);
}

/**
 * Inserta la identidad de una cotización nueva con el id reservado y su código generado.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {{ id: number, code: string, userId: number }} quote - Datos de la cotización.
 * @returns {Promise<void>}
 */
export async function insertQuoteRecord(client, { code, id, userId }) {
  await client.query(
    "insert into public.quotes (id, code, created_by, updated_by) values ($1, $2, $3, $3)",
    [id, code, userId],
  );
}

/**
 * Registra el responsable y la fecha de la última modificación de una cotización.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {number} quoteId - Cotización modificada.
 * @param {number} userId - Administrador responsable.
 * @returns {Promise<void>}
 * @throws {Error} Si la fila no existe (no debería ocurrir tras el bloqueo).
 */
export async function touchQuoteRecord(client, quoteId, userId) {
  const result = await client.query(
    "update public.quotes set updated_by = $2, updated_at = now() where id = $1",
    [quoteId, userId],
  );
  if (result.rowCount !== 1) throw new Error("quotes: la cotización bloqueada no se pudo actualizar.");
}

/**
 * Retira la vigencia de la versión actual (único cambio que permite el trigger de inmutabilidad).
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {number} quoteId - Cotización.
 * @returns {Promise<void>}
 * @throws {Error} Si no había exactamente una versión vigente.
 */
export async function retireCurrentQuoteVersion(client, quoteId) {
  const result = await client.query(
    "update public.quote_versions set is_current = false where quote_id = $1 and is_current",
    [quoteId],
  );
  if (result.rowCount !== 1) throw new Error("quotes: la cotización no tenía exactamente una versión vigente.");
}

/**
 * Inserta una versión vigente con el contenido completo de la cotización y devuelve su id.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {object} version - Contenido de la versión.
 * @param {number} version.quoteId - Cotización.
 * @param {number} version.versionNumber - Número de la versión.
 * @param {{ id: number, name: string }} version.client - Cliente y su nombre copiado.
 * @param {{ id: number, name: string }} version.project - Proyecto y su nombre copiado.
 * @param {string|null} version.notes - Observaciones.
 * @param {string} version.servicesTotal - Total calculado por el motor.
 * @param {string} version.currency - Moneda (USD).
 * @param {number} version.userId - Administrador responsable.
 * @returns {Promise<number>} Id de la versión.
 */
export async function insertQuoteVersion(client, version) {
  const result = await client.query(
    `insert into public.quote_versions (
       quote_id, version_number, client_id, client_name, project_id, project_name, notes, services_total, currency_code, created_by
     ) values ($1, $2, $3, $4, $5, $6, $7, $8::numeric, $9, $10)
     returning id`,
    [version.quoteId, version.versionNumber, version.client.id, version.client.name, version.project.id,
      version.project.name, version.notes, version.servicesTotal, version.currency, version.userId],
  );
  return Number(result.rows[0].id);
}

/**
 * Inserta en una sola sentencia todos los conceptos de una versión, numerados desde 1 en el
 * orden recibido. Los importes ya vienen calculados por el motor; el CHECK de PostgreSQL
 * vuelve a comprobar cada subtotal.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {number} quoteVersionId - Versión a la que pertenecen.
 * @param {Array<{ serviceId: number, serviceVersionId: number, quantity: string, unitRate: string, referenceRate: string, subtotal: string }>} lines - Conceptos.
 * @returns {Promise<void>}
 * @throws {Error} Si no se insertaron todos los conceptos.
 */
export async function insertQuoteItems(client, quoteVersionId, lines) {
  const result = await client.query(
    `insert into public.quote_items (
       quote_version_id, line_number, service_id, service_version_id, quantity, unit_rate, reference_rate, subtotal
     )
     select $1, line.line_number, line.service_id, line.service_version_id, line.quantity, line.unit_rate, line.reference_rate, line.subtotal
     from unnest($2::integer[], $3::bigint[], $4::bigint[], $5::numeric[], $6::numeric[], $7::numeric[], $8::numeric[])
       as line(line_number, service_id, service_version_id, quantity, unit_rate, reference_rate, subtotal)`,
    [
      quoteVersionId,
      lines.map((_line, index) => index + 1),
      lines.map((line) => line.serviceId),
      lines.map((line) => line.serviceVersionId),
      lines.map((line) => line.quantity),
      lines.map((line) => line.unitRate),
      lines.map((line) => line.referenceRate),
      lines.map((line) => line.subtotal),
    ],
  );
  if (result.rowCount !== lines.length) throw new Error("quotes: no se registraron todos los conceptos de la versión.");
}

/**
 * Indica si algún concepto de cualquier cotización (de cualquier versión o estado) usa el
 * servicio. Se ejecuta con el cliente de la transacción que tiene el servicio bloqueado FOR
 * UPDATE, de modo que un alta concurrente de un concepto (que lo bloquea FOR SHARE) ya
 * confirmada sea visible en esta sentencia.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {number} serviceId - Servicio.
 * @returns {Promise<boolean>} true si el servicio está incluido en alguna cotización.
 */
export async function serviceHasQuoteReferences(client, serviceId) {
  const result = await client.query("select exists (select 1 from public.quote_items where service_id = $1) as used", [serviceId]);
  return result.rows[0].used;
}
