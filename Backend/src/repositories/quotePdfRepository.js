import { query } from "../config/db.js";
import { QUOTE_PDF_LAYOUT_REVISION, QUOTE_PDF_TIME_ZONE } from "../domain/quotePdfDocument.js";

/**
 * Reserva el documento en la misma transacción que su versión comercial, o conserva el existente.
 * La unicidad por versión hace recuperables las subidas aun si el proceso termina antes de confirmarlas.
 *
 * @param {object} reservation - Identidad, modelo y huella del documento.
 * @param {{query: Function}} [executor] - Transacción o pool de PostgreSQL.
 * @returns {Promise<object>} Fila reservada o previamente registrada.
 */
export async function reserveQuotePdf(reservation, executor = { query }) {
  const { fileName, model, objectKey, sourceHash, versionId } = reservation;
  await executor.query(
    `insert into public.quote_pdf_documents
       (quote_version_id, object_key, file_name, document_model, source_hash, time_zone, layout_revision)
     values ($1, $2, $3, $4::jsonb, $5, $6, $7)
     on conflict (quote_version_id) do nothing`,
    [versionId, objectKey, fileName, JSON.stringify(model), sourceHash, QUOTE_PDF_TIME_ZONE, QUOTE_PDF_LAYOUT_REVISION],
  );
  return findQuotePdf(versionId, executor);
}

/**
 * Lee la referencia de un PDF sin consultar S3 ni mantener conexiones entre operaciones.
 * La fila pertenece a una versión inmutable y puede estar pendiente, disponible o en error.
 *
 * @param {number} versionId - Versión comercial de la cotización.
 * @param {{query: Function}} [executor] - Transacción o pool.
 * @returns {Promise<object|null>} Documento o null para versiones anteriores a la migración.
 */
export async function findQuotePdf(versionId, executor = { query }) {
  const result = await executor.query("select * from public.quote_pdf_documents where quote_version_id = $1", [versionId]);
  return result.rows[0] ?? null;
}

/**
 * Comprueba la visibilidad real del bucket en los metadatos Supabase de PostgreSQL.
 * No crea buckets ni modifica su visibilidad; una consulta fallida impide transferir documentos.
 *
 * @param {string} bucket - Bucket exclusivo configurado para cotizaciones.
 * @returns {Promise<boolean>} True solo si existe y está declarado privado.
 */
export async function isQuotePdfBucketPrivate(bucket) {
  const result = await query("select public from storage.buckets where id = $1", [bucket]);
  return result.rows[0]?.public === false;
}

/**
 * Adquiere una reserva temporal mediante una escritura atómica y libera enseguida la conexión.
 * Un proceso interrumpido deja de excluir a otros tras diez minutos; el token cerca sus escrituras.
 *
 * @param {number} versionId - Versión comercial.
 * @param {string} token - UUID de esta ejecución.
 * @returns {Promise<object|null>} Fila adquirida o null si otra ejecución trabaja o ya terminó.
 */
export async function claimQuotePdf(versionId, token) {
  const result = await query(
    `update public.quote_pdf_documents set status = 'pending', lease_token = $2::uuid,
       lease_until = now() + interval '10 minutes', attempts = attempts + 1, error_code = null
     where quote_version_id = $1 and status <> 'available'
       and (lease_until is null or lease_until < now()) returning *`, [versionId, token],
  );
  return result.rows[0] ?? null;
}

/**
 * Guarda la identidad del contenido antes de subirlo, sin mantener una transacción abierta.
 * Conserva el bucket elegido para que un cambio de configuración no desvíe una recuperación.
 *
 * @param {number} versionId - Versión comercial.
 * @param {string} token - Reserva adquirida.
 * @param {object} data - Bucket, tamaño y SHA-256 del contenido generado.
 * @param {string} data.bucket - Bucket privado elegido.
 * @param {string} data.hash - SHA-256 de los bytes.
 * @param {number} data.size - Tamaño en bytes.
 * @returns {Promise<boolean>} False si una ejecución más reciente tomó la reserva.
 */
export async function prepareQuotePdfUpload(versionId, token, { bucket, hash, size }) {
  const result = await query(
    `update public.quote_pdf_documents set bucket = $3, content_hash = $4, size_bytes = $5,
       generated_at = coalesce(generated_at, now())
     where quote_version_id = $1 and lease_token = $2::uuid and lease_until > now()
       and (content_hash is null or content_hash = $4) and (size_bytes is null or size_bytes = $5)`,
    [versionId, token, bucket, hash, size],
  );
  return result.rowCount === 1;
}

/**
 * Confirma el almacenamiento solo desde la ejecución que conserva la reserva temporal.
 * Si se pierde la respuesta del COMMIT, un reintento reconoce el objeto por su hash y origen.
 *
 * @param {number} versionId - Versión comercial.
 * @param {string} token - Reserva adquirida.
 * @returns {Promise<object|null>} Documento confirmado o null si la reserva ya no es propia.
 */
export async function completeQuotePdf(versionId, token) {
  const result = await query(
    `update public.quote_pdf_documents set status = 'available', stored_at = now(), error_code = null,
       lease_token = null, lease_until = null
     where quote_version_id = $1 and lease_token = $2::uuid and lease_until > now() returning *`, [versionId, token],
  );
  return result.rows[0] ?? null;
}

/**
 * Registra un fallo recuperable sin borrar el objeto de resultado incierto ni su referencia.
 * Un trabajador antiguo no puede cambiar el estado que pertenece a una reserva más reciente.
 *
 * @param {number} versionId - Versión comercial.
 * @param {string|null} token - Reserva propia; null permite invalidar un documento disponible.
 * @param {string} code - Código público controlado del fallo.
 * @returns {Promise<void>} Estado persistido cuando sigue siendo aplicable.
 */
export async function failQuotePdf(versionId, token, code) {
  await query(
    `update public.quote_pdf_documents set status = 'error', error_code = $3,
       lease_token = null, lease_until = null
     where quote_version_id = $1 and
       (($2::uuid is not null and lease_token = $2::uuid) or ($2::uuid is null and status = 'available'))`,
    [versionId, token, code],
  );
}
