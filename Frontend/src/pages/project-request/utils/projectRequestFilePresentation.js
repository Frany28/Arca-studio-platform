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
 * @returns {Object} Item subido con `remoteId` y `persisted`.
 */
export function toPersistedProjectRequestFileItem(file) {
  return {
    error: "",
    file: { name: file.name, size: Number(file.size) || 0, type: file.fileType || "" },
    id: `project-request-persisted-${file.id}`,
    persisted: true,
    progress: 100,
    remoteId: file.id,
    status: "uploaded",
  };
}

/**
 * Indica si un adjunto puede quitarse de la selección. Solo se cancela lo que todavía no se
 * guardó: un pendiente o fallido existe únicamente en la selección local y quitar uno que está
 * subiendo cancela su transferencia. Un adjunto subido ya está guardado en la solicitud y se
 * conserva (Fase 1.2, B1): nunca ofrece quitarlo.
 *
 * @param {{status: string}} item - Adjunto del formulario.
 * @returns {boolean} true si el adjunto puede quitarse.
 */
export function isProjectRequestFileRemovable(item) {
  return item?.status === "pending" || item?.status === "error" || item?.status === "uploading";
}

/**
 * Adapta los adjuntos del formulario al contrato de tarjetas de `FileUploadSection`.
 * Calcula el tamaño cargado a partir del progreso y solo expone `onRemove` en los adjuntos
 * que se pueden quitar. Un adjunto subido muestra «Subido · Pendiente de enviar solicitud» (está
 * guardado, pero la solicitud no se ha enviado); uno con error de subida ofrece «Intenta de
 * nuevo» (`onRetry`) y, además, su papelera para quitarlo. Un adjunto guardado no ofrece quitarlo:
 * su tarjeta completada muestra «Añadir archivo», como cualquier tarjeta completada.
 *
 * @param {Array<{id: string, file: File, status: string, progress: number, error: string}>} files - Adjuntos.
 * @param {(id: string) => void} [onRemove] - Quita de la selección un adjunto aún no guardado.
 * @param {{completedLabel?: string, onRetry?: (id: string) => void}} [options] - `onRetry` vuelve a
 *   subir un adjunto fallido y `completedLabel` sustituye el texto de un adjunto subido (la edición
 *   de una solicitud enviada no está pendiente de envío).
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
      onRemove: onRemove && isProjectRequestFileRemovable(item) ? () => onRemove(item.id) : undefined,
      onRetryUpload: item.status === "error" && options.onRetry ? () => options.onRetry(item.id) : undefined,
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
