import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSupabaseS3Client, getSupabaseStorageConfig } from "../config/storage.js";
import { AppError } from "../errors/appError.js";

// Plazos explícitos del almacenamiento (P0-3). En lecturas y borrados el plazo cubre hasta recibir la
// respuesta: la transferencia del cuerpo de una descarga ya en curso no se corta, para no interrumpir
// vídeos largos ni descargas lentas. En las cargas cubre la operación completa, incluido el envío del
// cuerpo; su valor por defecto coincide con el `requestTimeout` de Node, que ya limita esa petición.

/**
 * Lee un entero positivo de configuración con un valor por defecto.
 * Los valores ausentes, no numéricos o no positivos usan el predeterminado para no desactivar el plazo.
 *
 * @param {string} name - Variable de entorno.
 * @param {number} fallback - Valor por defecto en milisegundos.
 * @returns {number} Plazo configurado.
 */
function positiveIntegerSetting(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export const STORAGE_TIMEOUTS = Object.freeze({
  requestMs: positiveIntegerSetting("STORAGE_REQUEST_TIMEOUT_MS", 15 * 1000),
  uploadMs: positiveIntegerSetting("STORAGE_UPLOAD_TIMEOUT_MS", 5 * 60 * 1000),
});

/**
 * Error público de un plazo agotado: no expone el proveedor ni la clave del objeto.
 * Conserva la causa original para los registros del servidor.
 *
 * @param {Error} cause - Error original del SDK, conservado para los registros.
 * @returns {AppError} Error 504 con un código estable.
 */
function storageTimeoutError(cause) {
  return new AppError({
    cause,
    code: "STORAGE_TIMEOUT",
    message: "El almacenamiento de archivos no respondió a tiempo. Intenta de nuevo.",
    status: 504,
  });
}

/**
 * Envía un comando al cliente S3 y lo cancela si no se resuelve dentro del plazo.
 * El temporizador se limpia al resolverse, de modo que nunca cancela un cuerpo que ya se está leyendo.
 *
 * @param {object} command - Comando del SDK.
 * @param {number} timeoutMs - Plazo en milisegundos.
 * @returns {Promise<object>} Respuesta del SDK.
 * @throws {AppError} STORAGE_TIMEOUT si se agota el plazo; en otro caso, el error original.
 */
async function sendWithDeadline(command, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await getSupabaseS3Client().send(command, { abortSignal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw storageTimeoutError(error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

class S3ObjectStorage {
    /**
   * Obtiene la configuración activa del adaptador de almacenamiento de objetos.
   * Mantiene los detalles del proveedor fuera de los servicios consumidores.
   *
   * @returns {unknown} Resultado producido por la operación.
   * @throws {Error} Cuando una validación o dependencia impide completar la operación.
   */
config() {
    const config = getSupabaseStorageConfig();
    if (!config.bucket) throw new Error("SUPABASE_STORAGE_BUCKET is required");
    return config;
  }

    /**
   * Elimina un objeto identificado por su clave del proveedor configurado.
   * Encapsula los comandos del SDK para evitar acoplar al resto del backend.
   *
   * @param {string} key - Valor de `key` requerido por esta operación.
   * @returns {unknown} Resultado producido por la operación.
   */
delete(key) {
    const { bucket } = this.config();
    return sendWithDeadline(new DeleteObjectCommand({ Bucket: bucket, Key: key }), STORAGE_TIMEOUTS.requestMs);
  }

    /**
   * Recupera un objeto, completo o por rango, desde el proveedor configurado.
   * Encapsula los comandos del SDK para evitar acoplar al resto del backend.
   *
   * @param {string} key - Valor de `key` requerido por esta operación.
   * @param {object} [options] - Opciones agrupadas necesarias para ejecutar la operación.
   * @param {string} options.range - Valor de `options.range` requerido por esta operación.
   * @returns {unknown} Resultado producido por la operación.
   */
get(key, { range } = {}) {
    const { bucket } = this.config();
    return sendWithDeadline(
      new GetObjectCommand({ Bucket: bucket, Key: key, Range: range || undefined }),
      STORAGE_TIMEOUTS.requestMs,
    );
  }

    /**
   * Almacena un flujo o contenido en el proveedor S3 compatible.
   * Encapsula los comandos del SDK para evitar acoplar al resto del backend.
   *
   * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
   * @param {unknown} options.body - Valor de `options.body` requerido por esta operación.
   * @param {number} options.contentLength - Valor de `options.contentLength` requerido por esta operación.
   * @param {string} options.contentType - Valor de `options.contentType` requerido por esta operación.
   * @param {string} options.key - Valor de `options.key` requerido por esta operación.
   * @param {unknown} options.metadata - Valor de `options.metadata` requerido por esta operación.
   * @returns {unknown} Resultado producido por la operación.
   */
put({ body, contentLength, contentType, key, metadata }) {
    const { bucket } = this.config();
    return sendWithDeadline(new PutObjectCommand({
      Body: body, Bucket: bucket, ContentLength: contentLength, ContentType: contentType, Key: key, Metadata: metadata,
    }), STORAGE_TIMEOUTS.uploadMs);
  }
}

export const objectStorage = new S3ObjectStorage();
