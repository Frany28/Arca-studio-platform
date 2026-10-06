const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;

/**
 * Formatea bytes con la convención compacta de `FileUploadSection` ("200KB", "1.5MB").
 * Por debajo de 1 MB redondea hacia arriba a KB para que un archivo no vacío nunca
 * se muestre como 0KB; valores no numéricos o negativos se tratan como 0.
 *
 * @param {number|string|null|undefined} size - Tamaño en bytes.
 * @returns {string} Etiqueta visible del tamaño.
 */
export function formatFileSize(size) {
  const bytes = Math.max(Number(size) || 0, 0);

  return bytes >= BYTES_PER_MB
    ? `${(bytes / BYTES_PER_MB).toFixed(1)}MB`
    : `${Math.ceil(bytes / BYTES_PER_KB)}KB`;
}
