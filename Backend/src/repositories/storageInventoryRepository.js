// Lecturas del inventario de almacenamiento (E0). Trabaja sobre un cliente PostgreSQL inyectado y
// explícito: no importa `config/db.js`, cuyo pool se conecta con el DATABASE_URL del proceso. Todas
// las consultas se ejecutan dentro de una transacción READ ONLY que termina siempre con ROLLBACK, y
// una guardia rechaza en el cliente cualquier sentencia que no sea de lectura antes de enviarla.

// Sentencias admitidas. El servidor ya rechaza escrituras en una transacción READ ONLY; esta lista
// blanca añade una segunda barrera independiente del servidor.
const READ_ONLY_STATEMENT_PATTERNS = Object.freeze([
  /^begin transaction isolation level repeatable read read only$/i,
  /^set local (statement_timeout|lock_timeout|idle_in_transaction_session_timeout) = '\d+ms'$/i,
  /^savepoint inventory_source$/i,
  /^release savepoint inventory_source$/i,
  /^rollback to savepoint inventory_source$/i,
  /^rollback$/i,
  /^select\b/i,
]);

// Palabras que nunca deben aparecer dentro de un SELECT del inventario (por ejemplo, CTE con
// modificación de datos, SELECT INTO o funciones con efectos). Las sentencias independientes de
// escritura o estructura ya quedan fuera porque la lista blanca solo admite SELECT y control.
const FORBIDDEN_STATEMENT_PATTERN = /\b(insert|update|delete|merge|alter|create|drop|grant|revoke|copy|call|do|lock|vacuum|refresh|into|nextval|setval|pg_advisory\w*|for\s+(update|share|no\s+key\s+update|key\s+share))\b/i;

// Consultas por fuente. Seleccionan solo ids, claves/URLs (que el dominio redacta), tamaños y estado
// de la fila; nunca nombres originales, títulos ni datos de personas. Se paginan por id ascendente.
const SOURCE_QUERIES = Object.freeze({
  file_versions: `
    select
      version.id,
      version.file_name as storage_key,
      version.file_url,
      version.file_size,
      (version.deleted_at is not null) as version_deleted,
      (file.id is null or file.deleted_at is not null or file.status = 'deleted') as owner_deleted,
      case
        when file.project_id is not null then 'project'
        when file.project_request_id is not null then 'project_request'
        else 'unknown'
      end as context
    from public.file_versions version
    left join public.files file on file.id = version.file_id
    where version.id > $1
    order by version.id
    limit $2
  `,
  quote_pdf_documents: `
    select
      document.quote_version_id as id,
      document.object_key as storage_key,
      document.bucket,
      document.size_bytes as file_size,
      document.status
    from public.quote_pdf_documents document
    where document.quote_version_id > $1
    order by document.quote_version_id
    limit $2
  `,
  support_request_files: `
    select
      attachment.id,
      attachment.storage_key,
      attachment.file_url,
      attachment.file_size,
      (attachment.deleted_at is not null) as version_deleted,
      (request.id is null or request.deleted_at is not null) as owner_deleted,
      'support' as context
    from public.support_request_files attachment
    left join public.support_requests request on request.id = attachment.support_request_id
    where attachment.id > $1
    order by attachment.id
    limit $2
  `,
  users: `
    select
      account.id,
      account.profile_photo_url,
      account.signature_url,
      (account.deleted_at is not null) as owner_deleted
    from public.users account
    where account.id > $1
      and (account.profile_photo_url is not null or account.signature_url is not null)
    order by account.id
    limit $2
  `,
});

const BUCKET_PRIVACY_QUERY = "select id, public from storage.buckets where id = any($1::text[])";

/**
 * Comprueba que una sentencia sea de solo lectura antes de enviarla a PostgreSQL.
 * Normaliza espacios y rechaza varias sentencias, palabras de escritura y cualquier forma no prevista.
 *
 * @param {string} text - Sentencia SQL.
 * @returns {void}
 * @throws {Error} READ_ONLY_STATEMENT_REQUIRED si la sentencia no es de lectura.
 */
export function assertReadOnlyInventoryStatement(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim().replace(/;$/, "");
  const allowed = READ_ONLY_STATEMENT_PATTERNS.some((pattern) => pattern.test(normalized));
  const isTransactionControl = !/^select\b/i.test(normalized);
  if (!allowed || normalized.includes(";") || (!isTransactionControl && FORBIDDEN_STATEMENT_PATTERN.test(normalized))) {
    const error = new Error("El inventario solo puede ejecutar sentencias de lectura.");
    error.code = "READ_ONLY_STATEMENT_REQUIRED";
    throw error;
  }
}

/**
 * Envuelve un cliente PostgreSQL para que solo ejecute sentencias de lectura comprobadas.
 * Todas las consultas del inventario pasan por aquí; el cliente original no se expone.
 *
 * @param {{ query: Function }} client - Cliente `pg` ya conectado.
 * @returns {{ query: (text: string, params?: unknown[]) => Promise<{ rows: Array<object> }> }} Cliente guardado.
 */
export function createReadOnlyInventoryClient(client) {
  /**
   * Ejecuta una sentencia después de validar que sea de solo lectura.
   * Rechaza en el cliente antes de que la sentencia llegue al servidor.
   *
   * @param {string} text - Sentencia SQL.
   * @param {unknown[]} [params] - Parámetros posicionales.
   * @returns {Promise<{ rows: Array<object> }>} Resultado de PostgreSQL.
   */
  function guardedQuery(text, params) {
    assertReadOnlyInventoryStatement(text);
    return client.query(text, params);
  }
  return Object.freeze({ query: guardedQuery });
}

/**
 * Abre una instantánea coherente y de solo lectura con límites de tiempo locales a la transacción.
 * REPEATABLE READ garantiza que todas las fuentes se lean en el mismo instante lógico.
 *
 * @param {{ query: Function }} client - Cliente guardado.
 * @param {{ statementTimeoutMs: number, lockTimeoutMs: number, idleTimeoutMs: number }} limits - Plazos.
 * @returns {Promise<void>} Finalización de la apertura.
 */
export async function beginReadOnlySnapshot(client, { idleTimeoutMs, lockTimeoutMs, statementTimeoutMs }) {
  await client.query("begin transaction isolation level repeatable read read only");
  await client.query(`set local statement_timeout = '${toMilliseconds(statementTimeoutMs)}ms'`);
  await client.query(`set local lock_timeout = '${toMilliseconds(lockTimeoutMs)}ms'`);
  await client.query(`set local idle_in_transaction_session_timeout = '${toMilliseconds(idleTimeoutMs)}ms'`);
}

/**
 * Termina la instantánea con ROLLBACK: el inventario nunca confirma una transacción.
 * Se llama siempre, también tras un error, y no oculta el error original.
 *
 * @param {{ query: Function }} client - Cliente guardado.
 * @returns {Promise<void>} Finalización del cierre.
 */
export async function endReadOnlySnapshot(client) {
  await client.query("rollback");
}

/**
 * Lee todas las filas de una fuente por páginas de id ascendente dentro de un punto de guardado.
 * Un fallo (tabla inexistente, permisos, plazo) se informa como fuente fallida sin abortar las demás.
 *
 * @param {{ query: Function }} client - Cliente guardado dentro de la instantánea.
 * @param {string} source - Fuente de `SOURCE_QUERIES`.
 * @param {{ pageSize: number }} options - Tamaño de página.
 * @returns {Promise<{ status: "complete"|"failed", rows: Array<object>, pages: number, error?: unknown }>}
 *   Filas leídas y estado de la lectura.
 * @throws {Error} Si la fuente no es conocida.
 */
export async function readReferenceSource(client, source, { pageSize }) {
  const sql = SOURCE_QUERIES[source];
  if (!sql) throw new Error(`Fuente de referencias desconocida: ${source}`);
  return withSavepoint(client, async () => {
    const rows = [];
    let afterId = 0;
    let pages = 0;
    for (;;) {
      const result = await client.query(sql, [afterId, pageSize]);
      pages += 1;
      rows.push(...result.rows);
      if (result.rows.length < pageSize) break;
      afterId = result.rows.at(-1).id;
    }
    return { pages, rows };
  });
}

/**
 * Lee la privacidad declarada de los buckets en los metadatos de Supabase (`storage.buckets`).
 * En un PostgreSQL sin ese esquema o sin permiso, la lectura queda fallida y la privacidad sin confirmar.
 *
 * @param {{ query: Function }} client - Cliente guardado dentro de la instantánea.
 * @param {string[]} buckets - Buckets configurados.
 * @returns {Promise<{ status: "complete"|"failed", rows: Array<{ id: string, public: boolean }>, error?: unknown }>}
 *   Filas de privacidad.
 */
export async function readBucketPrivacy(client, buckets) {
  return withSavepoint(client, async () => {
    const result = await client.query(BUCKET_PRIVACY_QUERY, [buckets]);
    return { rows: result.rows.map((row) => ({ id: String(row.id), public: row.public })) };
  });
}

/**
 * Ejecuta una lectura dentro de un punto de guardado para aislar su posible fallo.
 * En PostgreSQL un error aborta la transacción; volver al punto de guardado permite seguir leyendo.
 *
 * @param {{ query: Function }} client - Cliente guardado.
 * @param {() => Promise<object>} read - Lectura a ejecutar.
 * @returns {Promise<object>} Resultado con `status: "complete"` o `status: "failed"` y el error.
 */
async function withSavepoint(client, read) {
  await client.query("savepoint inventory_source");
  try {
    const result = await read();
    await client.query("release savepoint inventory_source");
    return { ...result, status: "complete" };
  } catch (error) {
    await client.query("rollback to savepoint inventory_source");
    return { error, pages: 0, rows: [], status: "failed" };
  }
}

/**
 * Convierte un plazo en un entero positivo de milisegundos para interpolarlo con seguridad.
 * Solo admite enteros: el valor nunca procede del usuario sin esta validación.
 *
 * @param {number} value - Plazo en milisegundos.
 * @returns {number} Plazo validado.
 * @throws {Error} Si el plazo no es un entero positivo.
 */
function toMilliseconds(value) {
  const milliseconds = Number(value);
  if (!Number.isInteger(milliseconds) || milliseconds <= 0) throw new Error("Plazo de PostgreSQL inválido.");
  return milliseconds;
}
