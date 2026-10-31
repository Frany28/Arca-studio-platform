import { AppError, NotFoundError } from "../errors/appError.js";
import {
  deleteProjectRequestFile,
  findExistingProjectRequestFile,
  findProjectRequestForFileUpload,
  getProjectRequestFileUsage,
  uploadProjectRequestFile,
} from "../repositories/fileRepository.js";

const MAX_FILES = 10;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

/**
 * Rechaza la carga si la solicitud ya alcanzó el número o el tamaño máximo de adjuntos.
 * Se aplica antes de la transferencia y otra vez dentro de la transacción de registro, con la
 * solicitud bloqueada, para que las cargas simultáneas no superen juntas los límites.
 *
 * @param {{ count: number, totalBytes: number }} usage - Uso actual de la solicitud.
 * @param {number} size - Tamaño del archivo que se va a registrar.
 * @returns {void}
 * @throws {AppError} PROJECT_REQUEST_FILE_LIMIT o PROJECT_REQUEST_TOTAL_SIZE_LIMIT.
 */
function assertUploadWithinLimits(usage, size) {
  if (usage.count >= MAX_FILES) {
    throw new AppError({
      code: "PROJECT_REQUEST_FILE_LIMIT",
      message: "La solicitud admite un máximo de 10 archivos.",
      status: 409,
    });
  }
  if (usage.totalBytes + size > MAX_TOTAL_BYTES) {
    throw new AppError({
      code: "PROJECT_REQUEST_TOTAL_SIZE_LIMIT",
      message: "Los archivos de la solicitud no pueden superar 200 MB en total.",
      status: 413,
    });
  }
}

/**
 * Carga el adjunto de la solicitud de proyecto coordinando la persistencia y el almacenamiento.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.projectRequestId - Valor de `options.projectRequestId` requerido por esta operación.
 * @param {unknown} options.upload - Valor de `options.upload` requerido por esta operación.
 * @param {unknown} options.user - Valor de `options.user` requerido por esta operación.
 * @returns {Promise<object>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function uploadProjectRequestAttachment({ projectRequestId, upload, user }) {
  const projectRequest = await findProjectRequestForFileUpload(projectRequestId, user);
  if (!projectRequest) {
    throw new NotFoundError(
      "PROJECT_REQUEST_NOT_FOUND",
      "No se encontró un borrador disponible para adjuntar archivos.",
    );
  }

  const existingFile = await findExistingProjectRequestFile({
    originalName: upload.originalName,
    projectRequestId,
    userId: user.id,
  });
  if (existingFile) {
    for await (const _chunk of upload.body) {
      // Drain and validate the retried stream before returning the existing file.
    }
    return {
      id: Number(existingFile.id),
      originalName: existingFile.title,
      reused: true,
    };
  }

  assertUploadWithinLimits(await getProjectRequestFileUsage(projectRequestId), upload.size);

  return uploadProjectRequestFile({
    ...upload,
    /**
     * Repite la comprobación de límites con el uso leído bajo el bloqueo de la solicitud.
     * Cubre las cargas simultáneas que pasaron juntas la comprobación previa.
     *
     * @param {{ count: number, totalBytes: number }} lockedUsage - Uso leído en la transacción.
     * @returns {void}
     */
    assertWithinLimits: (lockedUsage) => assertUploadWithinLimits(lockedUsage, upload.size),
    projectRequestId,
    user,
  });
}

/**
 * Elimina el adjunto de la solicitud de proyecto después de comprobar acceso y existencia.
 * Aplica las reglas de negocio y coordina las dependencias necesarias para la operación.
 *
 * @param {object} options - Opciones agrupadas necesarias para ejecutar la operación.
 * @param {string} options.fileId - Valor de `options.fileId` requerido por esta operación.
 * @param {string} options.projectRequestId - Valor de `options.projectRequestId` requerido por esta operación.
 * @param {unknown} options.user - Valor de `options.user` requerido por esta operación.
 * @returns {Promise<unknown>} Resultado producido por la operación.
 * @throws {Error} Cuando una validación o dependencia impide completar la operación.
 */
export async function deleteProjectRequestAttachment({ fileId, projectRequestId, user }) {
  const deleted = await deleteProjectRequestFile({ fileId, projectRequestId, user });
  if (!deleted) {
    throw new NotFoundError(
      "FILE_NOT_FOUND",
      "No se encontró el archivo en este borrador.",
    );
  }
  return deleted;
}
