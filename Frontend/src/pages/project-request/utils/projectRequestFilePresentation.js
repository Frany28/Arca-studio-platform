import { formatFileSize } from "../../../utils/fileSize.js";
import { getProjectRequestFileIssues } from "../../../utils/projectRequestValidation.js";

// Estados internos del flujo de envío → estados visuales de FileUploadSection.
const FILE_CARD_STATUS = {
  error: "failed",
  pending: "pending",
  uploaded: "completed",
  uploading: "uploading",
};

// Un adjunto subido está guardado en el borrador, pero la solicitud aún no se ha enviado.
export const UPLOADED_PENDING_SUBMIT_LABEL = "Subido · Pendiente de enviar solicitud";

/**
 * Convierte un adjunto guardado en el backend al item del formulario. El descriptor `file`
 * no es un `File`: solo aporta nombre, tamaño y tipo para validar y presentar la tarjeta.
 *
 * @param {{id: number, name: string, size: number, fileType: string|null}} file - Adjunto de la API.
 * @param {boolean} [removing=false] - Si su eliminación está en curso.
 * @returns {Object} Item subido con `remoteId` y `persisted`.
 */
export function toPersistedProjectRequestFileItem(file, removing = false) {
  return {
    error: "",
    file: { name: file.name, size: Number(file.size) || 0, type: file.fileType || "" },
    id: `project-request-persisted-${file.id}`,
    persisted: true,
    progress: 100,
    remoteId: file.id,
    removing,
    status: "uploaded",
  };
}

/**
 * Indica si un adjunto puede quitarse. Los pendientes y fallidos solo existen en la selección
 * local; quitar uno que está subiendo cancela su transferencia. Un adjunto subido (`remoteId`)
 * pertenece a la solicitud y solo se quita cuando el flujo autoriza eliminar en el servidor
 * (existe el borrador), y nunca mientras se está eliminando.
 *
 * @param {{status: string, remoteId?: number, removing?: boolean}} item - Adjunto del formulario.
 * @param {{allowRemoteRemoval?: boolean}} [options] - Si la solicitud admite eliminar adjuntos guardados.
 * @returns {boolean} true si el adjunto puede quitarse.
 */
export function isProjectRequestFileRemovable(item, { allowRemoteRemoval = false } = {}) {
  if (item?.status === "pending" || item?.status === "error" || item?.status === "uploading") return true;
  return allowRemoteRemoval && item?.status === "uploaded" && Boolean(item.remoteId) && !item.removing;
}

/**
 * Adapta los adjuntos del formulario al contrato de tarjetas de `FileUploadSection`.
 * Calcula el tamaño cargado a partir del progreso y solo expone `onRemove` en los adjuntos
 * que se pueden quitar. Un adjunto subido muestra «Subido · Pendiente de enviar solicitud» (está
 * guardado, pero la solicitud no se ha enviado); uno con error de subida ofrece «Intenta de
 * nuevo» (`onRetry`) y, además, su papelera para quitarlo.
 *
 * @param {Array<{id: string, file: File, status: string, progress: number, error: string}>} files - Adjuntos.
 * Los adjuntos guardados que se pueden eliminar muestran «Eliminar archivo» en su tarjeta completada.
 * @param {(id: string) => void} [onRemove] - Quita un adjunto por id.
 * @param {{allowRemoteRemoval?: boolean, completedLabel?: string, onRetry?: (id: string) => void}} [options] - Ver
 *   isProjectRequestFileRemovable; `onRetry` vuelve a subir un adjunto fallido y `completedLabel`
 *   sustituye el texto de un adjunto subido (la edición de una solicitud enviada no está pendiente de envío).
 * @returns {Array<Object>} Tarjetas con nombre, tipo, estado, progreso, tamaños y acciones.
 */
export function toProjectRequestFileCards(files, onRemove, options = {}) {
  return (files || []).map((item) => {
    const totalBytes = Number(item.file?.size) || 0;
    const progress = item.status === "uploaded" ? 100 : Number(item.progress) || 0;

    return {
      currentSizeLabel: formatFileSize((totalBytes * progress) / 100),
      errorMessage: item.error || "No se pudo subir el archivo.",
      id: item.id,
      name: item.file?.name || "Archivo",
      completedLabel: options.completedLabel || UPLOADED_PENDING_SUBMIT_LABEL,
      onRemove: onRemove && isProjectRequestFileRemovable(item, options) ? () => onRemove(item.id) : undefined,
      onRetryUpload: item.status === "error" && options.onRetry ? () => options.onRetry(item.id) : undefined,
      removeWhenCompleted: item.status === "uploaded",
      removeWhenFailed: item.status === "error",
      progress,
      status: FILE_CARD_STATUS[item.status] || "pending",
      totalSizeLabel: formatFileSize(totalBytes),
      type: item.file?.type || "",
    };
  });
}

/**
 * Reparte los errores visibles entre los adjuntos que los causan y la sección. Los textos y las
 * reglas son los del validador (getProjectRequestFileIssues); solo se muestran los mensajes que el
 * formulario tiene activos (`fileErrors`). Un mensaje que no procede de ningún adjunto (límite de
 * cantidad o de tamaño total, o una selección rechazada que no llegó a la lista) es de la sección.
 *
 * @param {Array<{id: string}>} files - Adjuntos de `useProjectRequestFiles`.
 * @param {Array<string>} fileErrors - Mensajes activos del formulario.
 * @returns {{byFileId: Map<string, string>, general: Array<string>}} Motivo por adjunto y errores generales.
 */
export function splitProjectRequestFileErrors(files, fileErrors) {
  const active = new Set(fileErrors);
  const byFileId = new Map();
  const attributed = new Set();
  for (const issue of getProjectRequestFileIssues(files)) {
    if (issue.index === null || !active.has(issue.message)) continue;
    const id = files[issue.index].id;
    attributed.add(issue.message);
    byFileId.set(id, byFileId.has(id) ? `${byFileId.get(id)} ${issue.message}` : issue.message);
  }
  return { byFileId, general: fileErrors.filter((message) => !attributed.has(message)) };
}
