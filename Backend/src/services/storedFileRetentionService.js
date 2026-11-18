import { evaluateStoredFileOperation } from "../domain/projectFileRetention.js";
import { ConflictError, NotFoundError } from "../errors/appError.js";
import {
  findProjectFileForRemoval,
  findProjectRequestFileForRemoval,
} from "../repositories/fileRepository.js";

// Conservación de archivos guardados (Fase 1.2, B1). Un archivo registrado en PostgreSQL —de un
// proyecto o adjunto persistido de una solicitud— no se elimina: ni su objeto del almacenamiento,
// ni sus versiones, ni se retira con status 'deleted' o deleted_at. Las rutas DELETE existentes se
// conservan con su autenticación, permisos y comprobaciones de acceso, y terminan siempre en 409.
// El archivado y sus efectos sobre las audiencias son una decisión pendiente, no parte de esta regla.

export const FILE_DELETION_NOT_ALLOWED = "FILE_DELETION_NOT_ALLOWED";
export const FILE_DELETION_NOT_ALLOWED_MESSAGE = "Los archivos guardados se conservan y no se pueden eliminar.";

/**
 * Crea el error público que rechaza retirar un archivo guardado.
 * Es un 409 porque la solicitud es válida pero contradice la regla de conservación del dominio
 * (`retire_file` está prohibido en `domain/projectFileRetention.js`).
 *
 * @returns {ConflictError} Error 409 FILE_DELETION_NOT_ALLOWED.
 * @throws {Error} Si la regla del dominio dejara de prohibir la retirada (incoherencia interna).
 */
export function createFileDeletionNotAllowedError() {
  if (evaluateStoredFileOperation({ operation: "retire_file" }).outcome !== "forbidden") {
    throw new Error("La regla de conservación del dominio no prohíbe retirar archivos guardados.");
  }
  return new ConflictError(FILE_DELETION_NOT_ALLOWED, FILE_DELETION_NOT_ALLOWED_MESSAGE);
}

/**
 * Rechaza retirar un archivo de proyecto conservando registro, versiones y objeto.
 * Antes aplica las mismas comprobaciones que tenía la eliminación: si el archivo no existe o el
 * usuario no podía retirarlo responde 404, y un proyecto de solo lectura sigue respondiendo 409.
 * Solo lee PostgreSQL; nunca escribe ni toca el almacenamiento.
 *
 * @param {object} options - Archivo, proyecto y usuario.
 * @param {number} options.fileId - Archivo que se intenta retirar.
 * @param {number} options.projectId - Proyecto al que pertenece.
 * @param {object} options.user - Usuario autenticado.
 * @returns {Promise<never>} Nunca se resuelve con éxito.
 * @throws {NotFoundError} 404 FILE_NOT_FOUND si el archivo no es alcanzable para el usuario.
 * @throws {ConflictError} 409 FILE_DELETION_NOT_ALLOWED en cualquier otro caso.
 */
export async function rejectProjectFileDeletion({ fileId, projectId, user }) {
  const target = await findProjectFileForRemoval({ fileId, projectId, user });
  if (!target) throw new NotFoundError("FILE_NOT_FOUND", "No se encontro el archivo en este proyecto.");
  throw createFileDeletionNotAllowedError();
}

/**
 * Rechaza retirar un adjunto persistido de una solicitud conservando registro, versiones y objeto.
 * Antes aplica las comprobaciones que tenía la eliminación (solicitud editable, propietario o
 * administrador): si no se cumplen responde 404 para no revelar adjuntos ajenos.
 * Solo lee PostgreSQL; nunca escribe ni toca el almacenamiento.
 *
 * @param {object} options - Adjunto, solicitud y usuario.
 * @param {number} options.fileId - Adjunto que se intenta retirar.
 * @param {number} options.projectRequestId - Solicitud a la que pertenece.
 * @param {object} options.user - Usuario autenticado.
 * @returns {Promise<never>} Nunca se resuelve con éxito.
 * @throws {NotFoundError} 404 FILE_NOT_FOUND si el adjunto no es alcanzable para el usuario.
 * @throws {ConflictError} 409 FILE_DELETION_NOT_ALLOWED en cualquier otro caso.
 */
export async function rejectProjectRequestFileDeletion({ fileId, projectRequestId, user }) {
  const target = await findProjectRequestFileForRemoval({ fileId, projectRequestId, user });
  if (!target) throw new NotFoundError("FILE_NOT_FOUND", "No se encontró el archivo en este borrador.");
  throw createFileDeletionNotAllowedError();
}
