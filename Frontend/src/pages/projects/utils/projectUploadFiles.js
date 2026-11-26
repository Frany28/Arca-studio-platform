export const PROJECT_UPLOAD_ACCEPT = ".jpeg,.jpg,.png,.pdf,.mp4";
const SUPPORTED_EXTENSIONS = new Set(PROJECT_UPLOAD_ACCEPT.slice(1).split(",."));
const SUPPORTED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "video/mp4"]);
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * Devuelve el motivo por el que un archivo no entra en la cola del proyecto. La lista incluye
 * los archivos de la misma selección y los que se han subido en la sesión actual.
 *
 * @param {File} file - Archivo elegido o soltado.
 * @param {Array<{file: File}>} existingFiles - Archivos ya registrados en el panel.
 * @returns {string} Motivo de rechazo o una cadena vacía.
 */
export function getProjectUploadFileError(file, existingFiles) {
  const name = file.name.trim().toLowerCase();
  if (!name || file.name.length > 150) return "El nombre del archivo debe tener entre 1 y 150 caracteres.";
  if (existingFiles.some((item) => item.file.name.trim().toLowerCase() === name)) return "Ese archivo ya está seleccionado.";
  const extension = name.slice(name.lastIndexOf(".") + 1);
  if (name.lastIndexOf(".") <= 0 || !SUPPORTED_EXTENSIONS.has(extension) || !SUPPORTED_TYPES.has(file.type)) {
    return "Solo se permiten archivos JPEG, PNG, PDF y MP4.";
  }
  if (!file.size) return "El archivo está vacío.";
  if (file.size > MAX_FILE_SIZE_BYTES) return "El archivo supera el tamaño permitido de 50 MB.";
  return "";
}

/**
 * Representa los bytes de una tarjeta con las unidades compactas del diseño de carga.
 *
 * @param {number} bytes - Bytes del archivo o transferidos.
 * @returns {string} Tamaño legible.
 */
export function formatProjectUploadSize(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)}MB`
    : `${Math.ceil(bytes / 1024)}KB`;
}
