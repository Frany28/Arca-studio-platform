import { AppError } from "../errors/appError.js";
import { getSupportRequestFileUsage, uploadSupportRequestFile } from "../repositories/supportRepository.js";

// Cuota por solicitud de soporte, alineada con los adjuntos de solicitudes de proyecto. Junto con el
// límite de creación de solicitudes y el de cargas por usuario acota el almacenamiento que una cuenta
// puede ocupar con adjuntos de soporte.
const MAX_SUPPORT_FILES = 10;
const MAX_SUPPORT_TOTAL_BYTES = 200 * 1024 * 1024;

/**
 * Rechaza una carga que superaría la cuota de la solicitud de soporte.
 *
 * @param {{ count: number, totalBytes: number }} usage - Uso actual de la solicitud.
 * @param {number} size - Tamaño declarado del archivo nuevo.
 * @returns {void}
 * @throws {AppError} `SUPPORT_REQUEST_FILE_LIMIT` (409) o `SUPPORT_REQUEST_TOTAL_SIZE_LIMIT` (413).
 */
export function assertSupportUploadWithinLimits(usage, size) {
  if (usage.count >= MAX_SUPPORT_FILES) {
    throw new AppError({
      code: "SUPPORT_REQUEST_FILE_LIMIT",
      message: `La solicitud de soporte admite un máximo de ${MAX_SUPPORT_FILES} archivos.`,
      status: 409,
    });
  }
  if (usage.totalBytes + size > MAX_SUPPORT_TOTAL_BYTES) {
    throw new AppError({
      code: "SUPPORT_REQUEST_TOTAL_SIZE_LIMIT",
      message: "Los archivos de la solicitud de soporte no pueden superar 200 MB en total.",
      status: 413,
    });
  }
}

/**
 * Sube un adjunto a una solicitud de soporte ya autorizada. Comprueba la cuota antes de transferir
 * (para no subir bytes que se rechazarían) y la repite bajo el bloqueo de la solicitud al registrar,
 * para cubrir cargas simultáneas.
 *
 * @param {object} options - Datos de la carga.
 * @param {object} options.upload - Carga preparada por fileUploadService (body, size, contentType, originalName).
 * @param {number} options.supportRequestId - Solicitud de soporte destino.
 * @param {object} options.user - Usuario autenticado que sube el archivo.
 * @returns {Promise<object>} Adjunto registrado.
 * @throws {AppError} Cuando se supera la cuota o falla la persistencia.
 */
export async function uploadSupportAttachment({ supportRequestId, upload, user }) {
  assertSupportUploadWithinLimits(await getSupportRequestFileUsage(supportRequestId), upload.size);
  return uploadSupportRequestFile({
    ...upload,
    /**
     * Repite la comprobación de cuota con el uso leído bajo el bloqueo de la solicitud de soporte.
     * Cubre las cargas simultáneas que pasaron juntas la comprobación previa.
     *
     * @param {{ count: number, totalBytes: number }} lockedUsage - Uso leído en la transacción.
     * @returns {void}
     */
    assertWithinLimits: (lockedUsage) => assertSupportUploadWithinLimits(lockedUsage, upload.size),
    supportRequestId,
    user,
  });
}
