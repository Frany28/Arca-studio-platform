import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import { AppError, NotFoundError } from "../errors/appError.js";
import { buildQuotePdfReservation, QUOTE_PDF_LAYOUTS, QUOTE_PDF_MAX_BYTES, toQuotePdfStatus } from "../domain/quotePdfDocument.js";
import { findQuoteById } from "../repositories/quoteRepository.js";
import * as documents from "../repositories/quotePdfRepository.js";
import { objectStorage } from "./objectStorage.js";
import { loadQuotePdfAssets } from "./quotePdfAssets.js";
import { renderQuotePdf } from "./quotePdfRenderer.js";

// La función desplegada tiene maxDuration=30 s. Estos plazos son exclusivos de los PDF pequeños.
const PDF_STORAGE_REQUEST_MS = 3000;
const PDF_STORAGE_UPLOAD_MS = 10000;
const PDF_BODY_TIMEOUT_MS = 8000;

/**
 * Construye un error público de documentos sin revelar claves, contenido ni mensajes de S3.
 * La causa original se conserva únicamente para el diagnóstico interno del servidor.
 *
 * @param {string} code - Código controlado.
 * @param {string} message - Explicación administrativa.
 * @param {Error} [cause] - Fallo original.
 * @returns {AppError} Error recuperable de disponibilidad.
 */
function pdfError(code, message, cause) {
  return new AppError({ code, message, cause, status: 503 });
}

/**
 * Lee un PDF pequeño con límite de memoria y plazo para el cuerpo completo, y libera el flujo.
 * El límite explícito evita acumular archivos grandes o mantener transferencias bloqueadas.
 *
 * @param {import("node:stream").Readable} stream - Generador PDF o cuerpo recibido de S3.
 * @param {AbortSignal} [signal] - Cancelación de la descarga HTTP.
 * @returns {Promise<Buffer>} Contenido acotado a ocho MiB.
 */
async function readPdfBytes(stream, signal) {
  /**
   * Detiene el cuerpo S3 cuando el administrador cierra o cambia el visor.
   * La destrucción libera la conexión y descarta el contenido parcialmente recibido.
   *
   * @returns {void} Flujo cancelado.
   */
  const cancel = () => stream.destroy(signal.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => stream.destroy(pdfError("QUOTE_PDF_TIMEOUT", "La transferencia del PDF agotó su plazo.")), PDF_BODY_TIMEOUT_MS);
  const chunks = [];
  let size = 0;
  try {
    signal?.throwIfAborted();
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > QUOTE_PDF_MAX_BYTES) throw pdfError("QUOTE_PDF_TOO_LARGE", "El PDF supera el tamaño permitido.");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    stream.destroy();
  }
}

/**
 * Genera los bytes usando los recursos compartidos y la revisión de maquetación persistida.
 * Traduce los fallos del generador para distinguirlos de las transferencias S3 fallidas.
 *
 * @param {object} model - Instantánea de presentación persistida con la reserva.
 * @param {number} layoutRevision - Revisión con que se reservó el PDF, incluida la histórica.
 * @returns {Promise<Buffer>} PDF acotado y reproducible.
 */
async function generateQuotePdfBytes(model, layoutRevision) {
  try {
    return await readPdfBytes(renderQuotePdf(model, await loadQuotePdfAssets(), { layoutRevision }));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw pdfError("QUOTE_PDF_GENERATION_ERROR", "No se pudo generar el documento de la cotización.", error);
  }
}

/**
 * Verifica bucket exclusivo y privado antes de cualquier lectura o escritura de cotizaciones.
 * La referencia persistida prevalece sobre cambios de entorno; nunca se usa el bucket general.
 *
 * @param {object} row - Documento reservado.
 * @returns {Promise<string>} Bucket comprobado sin caché de visibilidad.
 */
async function privateBucket(row) {
  const bucket = row.bucket || process.env.SUPABASE_QUOTE_PDF_BUCKET;
  if (!bucket || bucket === process.env.SUPABASE_STORAGE_BUCKET || !(await documents.isQuotePdfBucketPrivate(bucket))) {
    throw pdfError("QUOTE_PDF_STORAGE_PRIVATE_REQUIRED", "El almacenamiento privado de cotizaciones no está configurado.");
  }
  return bucket;
}

/**
 * Contrasta los metadatos S3 con la identidad y el contenido preparados en PostgreSQL.
 * Un objeto ajeno o inconsistente nunca se adopta, elimina ni sobrescribe automáticamente.
 *
 * @param {object} row - Referencia persistida con hash esperado.
 * @param {object} stored - Metadatos HEAD o GET de S3.
 * @returns {void} Finaliza si coincide.
 * @throws {AppError} QUOTE_PDF_INTEGRITY_ERROR si hay una inconsistencia.
 */
function assertStoredIdentity(row, stored) {
  if (stored.ContentType !== "application/pdf" || Number(stored.ContentLength) !== Number(row.size_bytes)
    || !row.content_hash || stored.Metadata?.sha256 !== row.content_hash
    || stored.Metadata?.source !== row.source_hash) {
    throw pdfError("QUOTE_PDF_INTEGRITY_ERROR", "El documento almacenado no coincide con su versión. Requiere revisión administrativa.");
  }
}

/**
 * Recupera y verifica los bytes almacenados antes de entregarlos al administrador o confirmarlos.
 * Los errores del flujo no dejan un cuerpo abierto y los documentos corruptos no se sirven.
 *
 * @param {object} row - Referencia con hash y tamaño.
 * @param {string} bucket - Bucket privado verificado.
 * @param {AbortSignal} [signal] - Cancelación de la descarga.
 * @returns {Promise<Buffer>} PDF íntegro leído desde S3.
 */
async function readStoredPdf(row, bucket, signal) {
  const stored = await objectStorage.get(row.object_key, { bucket, timeoutMs: PDF_STORAGE_REQUEST_MS, signal });
  try {
    assertStoredIdentity(row, stored);
    const bytes = await readPdfBytes(stored.Body, signal);
    if (createHash("sha256").update(bytes).digest("hex") !== row.content_hash || bytes.length !== Number(row.size_bytes)) {
      throw pdfError("QUOTE_PDF_INTEGRITY_ERROR", "La integridad del PDF no pudo verificarse. Requiere revisión administrativa.");
    }
    return bytes;
  } finally {
    stored.Body?.destroy();
  }
}

/**
 * Busca la versión solicitada o la vigente y comprueba su existencia antes de acceder a Storage.
 * Una versión histórica se lee desde sus instantáneas, aunque ya haya otra versión vigente.
 *
 * @param {number} quoteId - Cotización validada.
 * @param {number} [versionNumber] - Versión comercial explícita.
 * @returns {Promise<object>} Cotización completa de esa versión.
 */
async function requireQuoteVersion(quoteId, versionNumber) {
  const quote = await findQuoteById(quoteId, undefined, versionNumber);
  if (!quote) throw new NotFoundError("QUOTE_NOT_FOUND", "La cotización o su versión no existe.");
  return quote;
}

/**
 * Recupera una reserva adquirida: adopta una subida incierta o genera y sube una única vez.
 * No retiene transacciones; el hash inmutable impide sustituir bytes aunque S3 ignore la precondición.
 *
 * @param {object} row - Documento con la reserva adquirida.
 * @param {string} token - Token que cerca las escrituras PostgreSQL.
 * @returns {Promise<object>} Estado final público o pendiente si otra ejecución tomó la reserva.
 */
async function storeClaimedPdf(row, token) {
  const versionId = Number(row.quote_version_id);
  const bucket = await privateBucket(row);
  const existing = await objectStorage.head(row.object_key, { bucket, timeoutMs: PDF_STORAGE_REQUEST_MS });
  if (existing) {
    assertStoredIdentity(row, existing);
    await readStoredPdf(row, bucket);
  } else {
    if (!QUOTE_PDF_LAYOUTS[row.layout_revision]) throw pdfError("QUOTE_PDF_LAYOUT_UNSUPPORTED", "La revisión del generador del documento requiere recuperación administrativa.");
    const bytes = await generateQuotePdfBytes(row.document_model, row.layout_revision);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (row.content_hash && hash !== row.content_hash) {
      throw pdfError("QUOTE_PDF_INTEGRITY_ERROR", "El generador no reproduce el documento original. Requiere revisión administrativa.");
    }
    if (!(await documents.prepareQuotePdfUpload(versionId, token, { bucket, hash, size: bytes.length }))) {
      const current = await documents.findQuotePdf(versionId);
      if (current?.lease_token === token) throw pdfError("QUOTE_PDF_INTEGRITY_ERROR", "Los bytes preparados no coinciden con el documento original.");
      return toQuotePdfStatus(current);
    }
    try {
      await objectStorage.put({
        body: bytes, bucket, contentLength: bytes.length, contentType: "application/pdf", ifNoneMatch: "*",
        key: row.object_key, metadata: { sha256: hash, source: row.source_hash }, timeoutMs: PDF_STORAGE_UPLOAD_MS,
      });
    } catch (error) {
      // Un 412 implica que otro trabajador ya ganó. Verificarlo permite adoptar sus mismos bytes.
      if (error?.$metadata?.httpStatusCode !== 412) throw error;
      await readStoredPdf({ ...row, content_hash: hash, size_bytes: bytes.length }, bucket);
    }
  }
  const completed = await documents.completeQuotePdf(versionId, token);
  return toQuotePdfStatus(completed ?? await documents.findQuotePdf(versionId));
}

/**
 * Completa el PDF después del COMMIT comercial y registra fallos sin revertir la cotización.
 * La reserva y el hash inmutable coordinan instancias; una caída se recupera al reintentar.
 *
 * @param {object} quote - Versión comercial recién guardada o reenviada idempotentemente.
 * @returns {Promise<object>} Disponibilidad explícita, incluso cuando falla S3 o la confirmación.
 */
export async function ensureQuotePdf(quote) {
  const versionId = quote.version.id;
  let token = null;
  try {
    let row = await documents.findQuotePdf(versionId);
    // Solo recuperación explícita o replay crea reservas para cotizaciones anteriores a la migración.
    row ??= await documents.reserveQuotePdf(buildQuotePdfReservation(quote));
    if (row.status === "available") {
      const bucket = await privateBucket(row);
      const stored = await objectStorage.head(row.object_key, { bucket, timeoutMs: PDF_STORAGE_REQUEST_MS });
      if (stored) {
        assertStoredIdentity(row, stored);
        return toQuotePdfStatus(row);
      }
      await documents.failQuotePdf(versionId, null, "QUOTE_PDF_MISSING");
    }
    token = randomUUID();
    const claimed = await documents.claimQuotePdf(versionId, token);
    if (!claimed) return toQuotePdfStatus(await documents.findQuotePdf(versionId));
    return await storeClaimedPdf(claimed, token);
  } catch (error) {
    const code = error instanceof AppError ? error.code : "QUOTE_PDF_STORAGE_ERROR";
    console.error(JSON.stringify({ type: "quote_pdf_failed", versionId, code, causeCode: error?.code || error?.name }));
    try {
      await documents.failQuotePdf(versionId, token, code);
    } catch (recordError) {
      // La reserva durable conserva la clave: no borrar un objeto cuyo COMMIT podría haber ocurrido.
      console.error(JSON.stringify({ type: "quote_pdf_record_failed", versionId, code: recordError?.code || recordError?.name }));
    }
    return { status: "error", errorCode: code, fileName: `${quote.code}-v${quote.currentVersion}.pdf`, mimeType: "application/pdf", size: null, generatedAt: null, storedAt: null };
  }
}

/**
 * Recupera un documento por acción administrativa explícita sin crear una versión comercial.
 * También permite reservar versiones heredadas utilizando únicamente sus instantáneas guardadas.
 *
 * @param {{quoteId: number, versionNumber?: number}} options - Cotización y versión validadas.
 * @returns {Promise<object>} Estado de disponibilidad posterior al intento.
 */
export async function retryQuotePdf({ quoteId, versionNumber }) {
  return ensureQuotePdf(await requireQuoteVersion(quoteId, versionNumber));
}

/**
 * Sirve los bytes persistentes de una versión sin invocar nunca al generador del documento.
 * Verifica privacidad e integridad y revalida la existencia incluso antes de responder 304.
 *
 * @param {object} options - Datos validados de la petición autenticada.
 * @param {number} options.quoteId - Cotización.
 * @param {number} [options.versionNumber] - Versión explícita; por defecto la vigente.
 * @param {string} [options.ifNoneMatch] - ETag del cliente.
 * @param {AbortSignal} [options.signal] - Cancelación de la descarga HTTP.
 * @returns {Promise<object>} PDF verificado y metadatos HTTP.
 */
export async function getQuotePdf({ ifNoneMatch, quoteId, versionNumber, signal }) {
  const quote = await requireQuoteVersion(quoteId, versionNumber);
  const row = await documents.findQuotePdf(quote.version.id);
  if (row?.status !== "available") {
    throw new AppError({ code: row?.status === "error" ? "QUOTE_PDF_ERROR" : "QUOTE_PDF_PENDING", status: 409,
      message: row?.status === "error" ? "El PDF no está disponible. Reintenta su recuperación." : "El PDF está pendiente. Reintenta su recuperación en unos momentos." });
  }
  const bucket = await privateBucket(row);
  const etag = `"${row.content_hash}"`;
  try {
    if (ifNoneMatch?.split(",").map((value) => value.trim()).includes(etag)) {
      const stored = await objectStorage.head(row.object_key, { bucket, timeoutMs: PDF_STORAGE_REQUEST_MS });
      if (!stored) throw pdfError("QUOTE_PDF_MISSING", "El PDF no se encuentra almacenado. Reintenta su recuperación.");
      assertStoredIdentity(row, stored);
      return { etag, fileName: row.file_name, notModified: true, stream: null };
    }
    const bytes = await readStoredPdf(row, bucket, signal);
    return { etag, fileName: row.file_name, notModified: false, size: bytes.length, stream: Readable.from([bytes]) };
  } catch (error) {
    if (signal?.aborted) throw error;
    const missing = error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404;
    const code = missing ? "QUOTE_PDF_MISSING" : error instanceof AppError ? error.code : "QUOTE_PDF_STORAGE_ERROR";
    if (missing || code === "QUOTE_PDF_MISSING" || code === "QUOTE_PDF_INTEGRITY_ERROR") {
      await documents.failQuotePdf(quote.version.id, null, code);
    }
    throw pdfError(code, "No se pudo recuperar el PDF almacenado. Reintenta su recuperación.", error);
  }
}
