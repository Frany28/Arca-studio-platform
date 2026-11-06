import { AppError, ValidationError } from "../errors/appError.js";
import { getUploadStream } from "../utils/uploadStream.js";
import { Transform } from "node:stream";

const DOCUMENT_EXTENSIONS = new Set([
  "docx",
  "jpeg",
  "jpg",
  "mp4",
  "pdf",
  "png",
  "xlsx",
]);
const DOCUMENT_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "video/mp4",
]);
const DOCUMENT_TYPE_BY_EXTENSION = new Map([
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["mp4", "video/mp4"],
  ["pdf", "application/pdf"],
  ["png", "image/png"],
  ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
]);
const AVATAR_EXTENSIONS = new Set(["jpeg", "jpg", "png", "webp"]);
const AVATAR_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PROJECT_REQUEST_EXTENSIONS = new Set(["jpeg", "jpg", "mp4", "pdf", "png"]);
const PROJECT_REQUEST_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "video/mp4",
]);
const PROJECT_REQUEST_TYPE_BY_EXTENSION = new Map([
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["mp4", "video/mp4"],
  ["pdf", "application/pdf"],
  ["png", "image/png"],
]);

export const uploadPolicies = {
  document: {
    extensions: DOCUMENT_EXTENSIONS,
    maxBytes: Number(process.env.FILE_UPLOAD_MAX_BYTES || 50 * 1024 * 1024),
    maxNameLength: 150,
    typeByExtension: DOCUMENT_TYPE_BY_EXTENSION,
    types: DOCUMENT_TYPES,
  },
  avatar: { extensions: AVATAR_EXTENSIONS, types: AVATAR_TYPES, maxBytes: Number(process.env.PROFILE_PHOTO_MAX_BYTES || 50 * 1024 * 1024), maxNameLength: 150 },
  projectRequest: {
    extensions: PROJECT_REQUEST_EXTENSIONS,
    maxBytes: Number(process.env.FILE_UPLOAD_MAX_BYTES || 50 * 1024 * 1024),
    maxNameLength: 150,
    typeByExtension: PROJECT_REQUEST_TYPE_BY_EXTENSION,
    types: PROJECT_REQUEST_TYPES,
    validateSignature: true,
  },
};

/**
 * Procesa el valor de has expected signature para completar la responsabilidad asignada al módulo.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {unknown} buffer - Valor de `buffer` requerido por esta operación.
 * @param {string} contentType - Valor de `contentType` requerido por esta operación.
 * @returns {boolean} Resultado producido por la operación.
 */
function hasExpectedSignature(buffer, contentType) {
  if (contentType === "image/jpeg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (contentType === "image/png") {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  }
  if (contentType === "application/pdf") {
    return buffer.subarray(0, 1024).includes(Buffer.from("%PDF-"));
  }
  if (contentType === "video/mp4") {
    return buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp";
  }
  return false;
}

/**
 * Procesa el valor de signature error para completar la responsabilidad asignada al módulo.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @returns {unknown} Resultado producido por la operación.
 */
function signatureError() {
  return new AppError({
    code: "INVALID_FILE_SIGNATURE",
    message: "El contenido del archivo no coincide con su formato.",
    status: 415,
  });
}

/**
 * Encadena al cuerpo un validador de la firma real del archivo (sus primeros bytes) y devuelve el
 * flujo validado con una promesa `ready` que se resuelve al confirmarla. Conserva sus errores en
 * `errored` con un oyente propio para que nunca terminen como excepción no capturada.
 *
 * @param {import("node:stream").Readable} body - Cuerpo de la petición.
 * @param {string} contentType - MIME declarado, que determina la firma esperada.
 * @returns {{ body: import("node:stream").Transform, ready: Promise<void> }} Flujo validado y
 *   confirmación de la firma; `ready` rechaza con INVALID_FILE_SIGNATURE (415) o con el error del
 *   origen si falla antes de validarse, y está marcada como atendida si nadie la espera.
 */
function validateFileSignature(body, contentType) {
  // El contenido fluye al validador en cuanto llega, antes de que el servicio termine sus consultas
  // a PostgreSQL y de que el almacenamiento lo lea; y el SDK de S3 lo transfiere con `pipe`, que no
  // escucha errores. Un error emitido sin oyentes terminaría el proceso: por eso el servicio espera
  // `ready` antes de transferir y responde 415 sin enviar al almacenamiento un flujo ya fallido.
  const inspectionBytes = 1024;
  let buffered = [];
  let bufferedLength = 0;
  let validated = false;
  let confirmSignature;
  let rejectSignature;
  const ready = new Promise((resolve, reject) => {
    confirmSignature = resolve;
    rejectSignature = reject;
  });
  // Una ruta que responde sin esperar `ready` (404, límites, reutilización) no debe dejar un
  // rechazo sin atender.
  ready.catch(() => {});
  const validator = new Transform({
        /**
     * Inspecciona los primeros bytes del flujo antes de permitir que continúe la carga.
     * Valida la firma real del archivo y entrega cada fragmento sin acumularlo completo.
     *
     * @param {unknown} chunk - Valor de `chunk` requerido por esta operación.
     * @param {unknown} _encoding - Valor de `_encoding` requerido por esta operación.
     * @param {Function} callback - Función que recibe el resultado de la operación asíncrona.
     * @returns {void} Finalización de la operación.
     */
transform(chunk, _encoding, callback) {
      if (validated) {
        callback(null, chunk);
        return;
      }
      buffered.push(chunk);
      bufferedLength += chunk.length;
      if (bufferedLength < inspectionBytes) {
        callback();
        return;
      }
      const combined = Buffer.concat(buffered, bufferedLength);
      if (!hasExpectedSignature(combined, contentType)) {
        callback(signatureError());
        return;
      }
      validated = true;
      buffered = [];
      confirmSignature();
      callback(null, combined);
    },
        /**
     * Completa la inspección de firma cuando el flujo termina con pocos bytes.
     * Libera el contenido retenido o informa el error de validación al pipeline.
     *
     * @param {Function} callback - Función que recibe el resultado de la operación asíncrona.
     * @returns {void} Finalización de la operación.
     */
flush(callback) {
      if (validated) {
        callback();
        return;
      }
      const combined = Buffer.concat(buffered, bufferedLength);
      if (!hasExpectedSignature(combined, contentType)) {
        callback(signatureError());
        return;
      }
      validated = true;
      confirmSignature();
      this.push(combined);
      callback();
    },
  });
  // El error queda en `validator.errored` para quien lea el flujo después; sin este oyente, un
  // error sin consumidor (o durante el `pipe` del SDK) terminaría el proceso.
  validator.on("error", (error) => {
    if (!validated) rejectSignature(error);
  });
  body.on("error", (error) => validator.destroy(error));
  body.pipe(validator);
  return { body: validator, ready };
}

/**
 * Obtiene el valor de nombre desde los encabezados o valores alternativos disponibles.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {unknown} fallback - Valor de `fallback` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
function originalName(req, fallback) {
  const raw = req.headers["x-file-name"] || req.headers["x-original-file-name"] || fallback;
  try { return decodeURIComponent(String(raw)); } catch { return String(raw); }
}

/**
 * Procesa el valor de extension para completar la responsabilidad asignada al módulo.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {string} name - Valor de `name` requerido por esta operación.
 * @returns {unknown} Resultado producido por la operación.
 */
function extension(name) {
  const index = name.lastIndexOf(".");
  return index > 0 && index < name.length - 1 ? name.slice(index + 1).toLowerCase() : "";
}

/**
 * Prepara el valor de carga validando metadatos antes de iniciar la transferencia.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @param {unknown} policy - Valor de `policy` requerido por esta operación.
 * @param {object} [options] - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} [options.fallbackName] - Valor de `options.fallbackName` requerido por esta operación.
 * @returns {{ body: import("node:stream").Readable, contentType: string, originalName: string, size: number, ready: Promise<void> }}
 *   Carga preparada. `ready` confirma la firma del contenido cuando la política la valida (el
 *   consumidor debe esperarla antes de transferir); en otro caso ya está resuelta.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export function prepareUpload(req, policy, { fallbackName = "archivo" } = {}) {
  const name = originalName(req, fallbackName).trim();
  const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  const fileExtension = extension(name);
  if (!name || name.length > policy.maxNameLength) throw new ValidationError("El nombre del archivo no es válido.", { fileName: `Máximo ${policy.maxNameLength} caracteres.` });
  if (
    !policy.extensions.has(fileExtension) ||
    !policy.types.has(contentType) ||
    (policy.typeByExtension &&
      policy.typeByExtension.get(fileExtension) !== contentType)
  ) {
    throw new AppError({ code: "UNSUPPORTED_FILE_TYPE", message: "El tipo de archivo no está permitido.", status: 415 });
  }
  const { body, size } = getUploadStream(req, policy.maxBytes);
  const validated = policy.validateSignature
    ? validateFileSignature(body, contentType)
    : { body, ready: Promise.resolve() };
  return {
    body: validated.body,
    contentType,
    originalName: name,
    ready: validated.ready,
    size,
  };
}

/**
 * Prepara el valor de proyecto carga validando metadatos antes de iniciar la transferencia.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @returns {unknown} Resultado producido por la operación.
 */
export function prepareProjectUpload(req) {
  return prepareUpload(req, uploadPolicies.document);
}

/**
 * Prepara el valor de proyecto solicitud carga validando metadatos antes de iniciar la transferencia.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {import("express").Request} req - Solicitud HTTP con los datos previamente validados.
 * @returns {unknown} Resultado producido por la operación.
 */
export function prepareProjectRequestUpload(req) {
  return prepareUpload(req, uploadPolicies.projectRequest);
}

/**
 * Ejecuta el valor de proyecto carga coordinando la operación y la limpieza ante fallos.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {unknown} options.operation - Valor de `options.operation` requerido por esta operación.
 * @param {unknown} options.req - Valor de `options.req` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function runProjectUpload({ operation, req }) {
  if (req.destroyed) {
    throw new AppError({
      code: "UPLOAD_ABORTED",
      message: "La carga fue cancelada.",
      status: 499,
    });
  }

  return operation(prepareProjectUpload(req));
}

/**
 * Ejecuta el valor de carga coordinando la operación y la limpieza ante fallos.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {unknown} options.operation - Valor de `options.operation` requerido por esta operación.
 * @param {unknown} options.req - Valor de `options.req` requerido por esta operación.
 * @param {unknown} options.policy - Valor de `options.policy` requerido por esta operación.
 * @param {string} options.fallbackName - Valor de `options.fallbackName` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function runUpload({ operation, req, policy, fallbackName }) {
  if (req.destroyed) throw new AppError({ code: "UPLOAD_ABORTED", message: "La carga fue cancelada.", status: 499 });
  const upload = prepareUpload(req, policy, { fallbackName });
  return operation(upload);
}
