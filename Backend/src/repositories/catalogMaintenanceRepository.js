import { pool, query } from "../config/db.js";

/*
 * Consultas de solo lectura para el mantenimiento del catálogo (carga oficial del tabulador):
 * identidad de la base, estado de la migración de unidades, próximos ids de las secuencias,
 * unidades por código, denominaciones equivalentes y resumen de versiones. Las escrituras las
 * hacen siempre los servicios del dominio (serviceCatalogService, measurementUnitService).
 */

const SERVICE_UNIT_OPTIONS_MIGRATION = "20261027120000_service_unit_options";

// Clave del bloqueo consultivo de la carga del catálogo: dos ejecuciones simultáneas del comando
// se excluyen aunque usen procesos distintos. No bloquea la API.
const CATALOG_LOAD_LOCK_KEY = "4171101120251032";

/**
 * Identifica la base conectada sin exponer credenciales: nombre, versión del servidor y si es
 * una réplica en recuperación (solo lectura). Sirve para confirmar el destino antes de escribir.
 *
 * @returns {Promise<{ database: string, serverVersion: string, inRecovery: boolean }>} Identidad.
 */
export async function readDatabaseIdentity() {
  const result = await query(
    "select current_database() as database, current_setting('server_version') as server_version, pg_is_in_recovery() as in_recovery",
  );
  const [row] = result.rows;
  return { database: row.database, inRecovery: row.in_recovery, serverVersion: row.server_version };
}

/**
 * Comprueba que la estructura de varias unidades por servicio exista (tablas y columna de
 * `quote_items`) y, si la base tiene historial de Prisma, que la migración figure como terminada
 * y no revertida. Una base sin `_prisma_migrations` (pruebas aisladas) solo valida la estructura.
 *
 * @returns {Promise<{ structureReady: boolean, historyAvailable: boolean,
 *   migrationFinished: boolean|null }>} Estado de la migración.
 */
export async function readServiceUnitOptionsMigrationState() {
  const structure = await query(
    `select to_regclass('public.service_unit_options') is not null
        and to_regclass('public.service_version_unit_options') is not null
        and exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'quote_items'
                      and column_name = 'service_version_unit_option_id') as structure_ready,
       to_regclass('public._prisma_migrations') is not null as history_available`,
  );
  const { history_available: historyAvailable, structure_ready: structureReady } = structure.rows[0];
  if (!historyAvailable) return { historyAvailable, migrationFinished: null, structureReady };
  const history = await query(
    `select exists (select 1 from public._prisma_migrations
       where migration_name = $1 and finished_at is not null and rolled_back_at is null) as finished`,
    [SERVICE_UNIT_OPTIONS_MIGRATION],
  );
  return { historyAvailable, migrationFinished: history.rows[0].finished, structureReady };
}

/**
 * Calcula el próximo id que entregará la secuencia de una columna serial sin consumirlo
 * (`pg_sequence_last_value` es null mientras la secuencia no se ha usado). Los valores de una
 * secuencia no son transaccionales: el resultado es una predicción válida solo sin escrituras
 * concurrentes, por eso la carga lo vuelve a comprobar antes de cada alta.
 *
 * @param {string} table - Tabla calificada (`public.services`).
 * @param {string} column - Columna serial (`id`).
 * @returns {Promise<number>} Próximo id.
 */
export async function readNextSerialId(table, column) {
  const result = await query(
    `select pg_sequence_last_value(seq.seqrelid) as last_value, seq.seqstart as start_value, seq.seqincrement as increment_by
     from pg_catalog.pg_sequence seq
     where seq.seqrelid = pg_get_serial_sequence($1, $2)::regclass`,
    [table, column],
  );
  const [row] = result.rows;
  if (!row) throw new Error(`catalog_maintenance: ${table}.${column} no tiene secuencia.`);
  return row.last_value === null ? Number(row.start_value) : Number(row.last_value) + Number(row.increment_by);
}

/**
 * Lee las unidades base por su código estable (`square_meter`, `project`...), incluidas las
 * inactivas, para resolver sus ids y comprobar su estado antes de asignarlas.
 *
 * @param {Array<string>} codes - Códigos buscados.
 * @returns {Promise<Map<string, { id: number, code: string, symbol: string, isActive: boolean }>>} Unidades por código.
 */
export async function listMeasurementUnitsByCode(codes) {
  const result = await query(
    "select id, code, symbol, is_active from public.measurement_units where code = any($1::text[])",
    [codes],
  );
  return new Map(result.rows.map((row) => [row.code, { code: row.code, id: Number(row.id), isActive: row.is_active, symbol: row.symbol }]));
}

/**
 * Busca la denominación equivalente de una unidad base con la misma clave que el índice único
 * `uq_measurement_unit_denominations_key` (NFKC y minúsculas), activa o inactiva. Así se detecta
 * antes de escribir cualquier alta que PostgreSQL rechazaría como duplicada.
 *
 * @param {number} measurementUnitId - Unidad base.
 * @param {string} denomination - Texto normalizado.
 * @returns {Promise<{ id: number, publicCode: string, denomination: string, isActive: boolean }|null>} Denominación o null.
 */
export async function findEquivalentDenomination(measurementUnitId, denomination) {
  const result = await query(
    `select id, public_code, denomination, is_active
     from public.measurement_unit_denominations
     where measurement_unit_id = $1
       and lower(normalize(denomination, NFKC) collate pg_c_utf8) = lower(normalize($2::text, NFKC) collate pg_c_utf8)`,
    [measurementUnitId, denomination],
  );
  const [row] = result.rows;
  return row ? { denomination: row.denomination, id: Number(row.id), isActive: row.is_active, publicCode: row.public_code } : null;
}

/**
 * Lista los ids de todos los servicios, activos o inactivos, en orden de creación.
 *
 * @returns {Promise<Array<number>>} Ids de servicios.
 */
export async function listAllServiceIds() {
  const result = await query("select id from public.services order by id");
  return result.rows.map((row) => Number(row.id));
}

/**
 * Resume el historial de cada servicio: número de versiones, versión vigente y unidades
 * copiadas en la vigente. Permite verificar tras la carga que cada servicio tiene su versión 1
 * con todas sus unidades.
 *
 * @param {Array<number>} serviceIds - Servicios consultados.
 * @returns {Promise<Map<number, { versionCount: number, currentVersion: number|null,
 *   currentVersionUnitCount: number }>>} Resumen por servicio.
 */
export async function summarizeServiceVersions(serviceIds) {
  const result = await query(
    `select s.id as service_id,
       (select count(*) from public.service_versions v where v.service_id = s.id)::int as version_count,
       cv.version_number as current_version,
       (select count(*) from public.service_version_unit_options o where o.service_version_id = cv.id)::int as current_unit_count
     from public.services s
     left join public.service_versions cv on cv.service_id = s.id and cv.is_current
     where s.id = any($1::bigint[])`,
    [serviceIds],
  );
  return new Map(result.rows.map((row) => [Number(row.service_id), {
    currentVersion: row.current_version === null ? null : Number(row.current_version),
    currentVersionUnitCount: row.current_unit_count,
    versionCount: row.version_count,
  }]));
}

/**
 * Toma el bloqueo consultivo de la carga del catálogo en una conexión dedicada y la conserva
 * hasta llamar a `release`, que cierra el bloqueo y devuelve la conexión al pool. Si otra
 * ejecución ya lo tiene, devuelve null sin esperar.
 *
 * @returns {Promise<{ release: () => Promise<void> }|null>} Bloqueo tomado o null.
 */
export async function tryAcquireCatalogLoadLock() {
  const client = await pool.connect();
  try {
    const result = await client.query("select pg_try_advisory_lock($1::bigint) as locked", [CATALOG_LOAD_LOCK_KEY]);
    if (!result.rows[0].locked) {
      client.release();
      return null;
    }
  } catch (error) {
    client.release();
    throw error;
  }
  return {
    /**
     * Libera el bloqueo tomado por esta llamada y devuelve su conexión al pool.
     * Debe llamarse una sola vez, al terminar la carga (también si falla).
     *
     * @returns {Promise<void>}
     */
    release: () => releaseCatalogLoadLock(client),
  };
}

/**
 * Libera el bloqueo consultivo de la carga y devuelve la conexión dedicada al pool, aunque el
 * desbloqueo falle (al cerrarse la sesión PostgreSQL libera el bloqueo igualmente).
 *
 * @param {import("pg").PoolClient} client - Conexión que tiene el bloqueo.
 * @returns {Promise<void>}
 */
async function releaseCatalogLoadLock(client) {
  try {
    await client.query("select pg_advisory_unlock($1::bigint)", [CATALOG_LOAD_LOCK_KEY]);
  } finally {
    client.release();
  }
}
