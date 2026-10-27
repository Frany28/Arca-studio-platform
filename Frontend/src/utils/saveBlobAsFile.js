/**
 * Descarga en el navegador un contenido ya recibido de la API con el nombre indicado. Usa una URL
 * de objeto temporal y la revoca tras iniciar la descarga, para no retener el archivo en memoria.
 *
 * @param {Blob} blob - Contenido a guardar.
 * @param {string} fileName - Nombre sugerido del archivo (por ejemplo `COT-001.pdf`).
 * @returns {void}
 */
export function saveBlobAsFile(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // La descarga ya tomó la URL al hacer clic; revocarla en la siguiente tarea libera el Blob.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
