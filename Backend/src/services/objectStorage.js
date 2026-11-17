import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { createSupabaseS3Client, getSupabaseS3Client, getSupabaseStorageConfig } from "../config/storage.js";
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
 * @param {AbortSignal} [signal] - Cancelación externa de una lectura.
 * @returns {Promise<object>} Respuesta del SDK.
 * @throws {AppError} STORAGE_TIMEOUT si se agota el plazo; en otro caso, el error original.
 */
async function sendWithDeadline(command, timeoutMs, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await getSupabaseS3Client().send(command, { abortSignal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw storageTimeoutError(error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

class S3ObjectStorage {
  /**
   * Crea un bucket durante una preparación de almacenamiento expresamente autorizada.
   * No cambia buckets existentes; el llamador debe comprobar su privacidad antes de guardar archivos.
   *
   * @param {string} bucket - Nombre del bucket exclusivo elegido por administración.
   * @returns {Promise<object>} Confirmación del proveedor S3 compatible.
   */
  createBucket(bucket) {
    return sendWithDeadline(new CreateBucketCommand({ Bucket: bucket }), STORAGE_TIMEOUTS.requestMs);
  }

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
   * @param {string} [options.range] - Rango opcional.
   * @param {string} [options.bucket] - Bucket explícito para documentos privados.
   * @param {number} [options.timeoutMs] - Plazo para documentos pequeños.
   * @param {AbortSignal} [options.signal] - Cancelación de la lectura.
   * @returns {unknown} Resultado producido por la operación.
   */
get(key, { bucket = this.config().bucket, range, timeoutMs = STORAGE_TIMEOUTS.requestMs, signal } = {}) {
    return sendWithDeadline(
      new GetObjectCommand({ Bucket: bucket, Key: key, Range: range || undefined }),
      timeoutMs,
      signal,
    );
  }

  /**
   * Consulta metadatos de un objeto privado sin transferir su contenido.
   * Solo una respuesta 404 significa ausencia; permisos y fallos transitorios se propagan.
   *
   * @param {string} key - Clave generada por el backend.
   * @param {{bucket: string, timeoutMs?: number}} options - Bucket y plazo para los metadatos.
   * @returns {Promise<object|null>} Metadatos o null si no existe.
   */
  async head(key, { bucket, timeoutMs = STORAGE_TIMEOUTS.requestMs }) {
    try {
      return await sendWithDeadline(new HeadObjectCommand({ Bucket: bucket, Key: key }), timeoutMs);
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey") return null;
      throw error;
    }
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
   * @param {string} [options.bucket] - Bucket explícito; los archivos generales mantienen el actual.
   * @param {string} [options.ifNoneMatch] - Precondición adicional, su soporte depende del proveedor.
   * @param {number} [options.timeoutMs] - Plazo acotado para documentos pequeños.
   * @returns {unknown} Resultado producido por la operación.
   */
put({ body, bucket = this.config().bucket, contentLength, contentType, ifNoneMatch, key, metadata, timeoutMs = STORAGE_TIMEOUTS.uploadMs }) {
    return sendWithDeadline(new PutObjectCommand({
      Body: body, Bucket: bucket, ContentLength: contentLength, ContentType: contentType, IfNoneMatch: ifNoneMatch, Key: key, Metadata: metadata,
    }), timeoutMs);
  }
}

export const objectStorage = new S3ObjectStorage();

// Únicos comandos que admite el inspector de inventario: listar y leer metadatos. Ninguno transfiere
// contenido ni modifica objetos, buckets o permisos.
const READ_ONLY_INSPECTION_COMMANDS = Object.freeze([ListObjectsV2Command, HeadObjectCommand]);

/**
 * Comprueba que un comando del SDK pertenezca a la lista blanca del inspector de inventario.
 * Se evalúa antes de contactar el proveedor: un comando de escritura o descarga nunca se envía.
 *
 * @param {object} command - Comando del SDK.
 * @returns {void}
 * @throws {Error} STORAGE_COMMAND_NOT_ALLOWED si no es ListObjectsV2 ni HeadObject.
 */
export function assertReadOnlyStorageCommand(command) {
  if (!READ_ONLY_INSPECTION_COMMANDS.some((allowed) => command instanceof allowed)) {
    const error = new Error("El inspector de almacenamiento solo admite listar y consultar metadatos.");
    error.code = "STORAGE_COMMAND_NOT_ALLOWED";
    throw error;
  }
}

/**
 * Crea un inspector de almacenamiento que solo puede listar objetos y consultar sus metadatos.
 * Usa una conexión explícita, independiente del cliente del backend, y rechaza cualquier otro comando
 * antes de enviarlo, por lo que no puede descargar, crear, copiar, modificar ni eliminar objetos.
 *
 * @param {{ accessKeyId: string, endpoint: string, region: string, secretAccessKey: string }} connection -
 *   Destino elegido explícitamente por quien ejecuta el inventario.
 * @param {object} [options] - Dependencias y plazos.
 * @param {{ send: Function, destroy?: Function }} [options.client] - Cliente S3 (simulado en pruebas).
 * @param {number} [options.timeoutMs] - Plazo de cada petición.
 * @returns {{ listPage: Function, headObject: Function, close: Function }} Inspector inmutable.
 */
export function createReadOnlyStorageInspector(connection, { client = null, timeoutMs = STORAGE_TIMEOUTS.requestMs } = {}) {
  const s3 = client || createSupabaseS3Client(connection);

  /**
   * Envía un comando de la lista blanca con plazo propio y rechaza cualquier otro.
   * La comprobación ocurre antes de contactar el proveedor, así que un uso indebido no produce efectos.
   *
   * @param {object} command - Comando del SDK.
   * @returns {Promise<object>} Respuesta del proveedor.
   * @throws {Error} STORAGE_COMMAND_NOT_ALLOWED si el comando no es de solo lectura.
   */
  async function sendReadOnly(command) {
    assertReadOnlyStorageCommand(command);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await s3.send(command, { abortSignal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) throw storageTimeoutError(error);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Lista una página de claves de un bucket con sus metadatos básicos (tamaño y fecha).
   * El llamador recorre las páginas con el token de continuación; no se lee ningún contenido.
   *
   * @param {{ bucket: string, continuationToken?: string|null, maxKeys?: number }} options - Bucket,
   *   token de la página anterior y tamaño de página.
   * @returns {Promise<{ objects: Array<{ key: string, size: number|null, lastModified: string|null }>,
   *   nextToken: string|null, isTruncated: boolean }>} Página del listado.
   */
  async function listPage({ bucket, continuationToken = null, maxKeys = 1000 }) {
    const response = await sendReadOnly(new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken || undefined,
      MaxKeys: maxKeys,
    }));
    return {
      isTruncated: response.IsTruncated === true,
      nextToken: response.NextContinuationToken || null,
      objects: (response.Contents || []).map(toListedObject),
    };
  }

  /**
   * Consulta los metadatos de una clave y clasifica la respuesta sin propagar detalles del proveedor.
   * Un 404 confirma la ausencia; permisos, plazos y otros fallos quedan como inaccesibles.
   *
   * @param {{ bucket: string, key: string }} options - Bucket y clave del objeto.
   * @returns {Promise<{ status: "present"|"missing"|"inaccessible", size?: number|null, code?: string,
   *   httpStatus?: number|null }>} Estado verificado del objeto.
   */
  async function headObject({ bucket, key }) {
    try {
      const response = await sendReadOnly(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { size: toSize(response.ContentLength), status: "present" };
    } catch (error) {
      const httpStatus = error?.$metadata?.httpStatusCode ?? error?.status ?? null;
      if (httpStatus === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey") return { status: "missing" };
      return { code: String(error?.code || error?.name || "UNKNOWN"), httpStatus, status: "inaccessible" };
    }
  }

  /**
   * Libera las conexiones del cliente propio del inspector al terminar el inventario.
   * Un cliente inyectado sin `destroy` se deja intacto.
   *
   * @returns {void}
   */
  function close() {
    s3.destroy?.();
  }

  return Object.freeze({ close, headObject, listPage });
}

/**
 * Reduce una entrada del listado a los metadatos que necesita el inventario.
 * Descarta propietario, clase de almacenamiento y ETag, que no aportan a la comparación.
 *
 * @param {{ Key?: string, Size?: number, LastModified?: Date|string }} entry - Entrada del SDK.
 * @returns {{ key: string, size: number|null, lastModified: string|null }} Objeto listado.
 */
function toListedObject(entry) {
  const lastModified = entry.LastModified ? new Date(entry.LastModified) : null;
  return {
    key: String(entry.Key || ""),
    lastModified: lastModified && !Number.isNaN(lastModified.getTime()) ? lastModified.toISOString() : null,
    size: toSize(entry.Size),
  };
}

/**
 * Convierte un tamaño informado por el proveedor en número o null si no es válido.
 * Evita propagar valores indefinidos o negativos a las comparaciones de tamaño.
 *
 * @param {unknown} value - Tamaño recibido.
 * @returns {number|null} Bytes o null.
 */
function toSize(value) {
  const size = Number(value);
  return Number.isFinite(size) && size >= 0 ? size : null;
}
