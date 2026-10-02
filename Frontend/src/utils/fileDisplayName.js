/**
 * Recorta el nombre y elimina únicamente su última extensión sin atravesar separadores.
 * Usa el fallback para entradas vacías; conserva el original si quitar la extensión lo vacía.
 *
 * @param {string|null} value - Nombre del archivo.
 * @param {string} [fallback="Archivo"] - Nombre para entradas vacías.
 * @returns {string} Nombre de presentación.
 */
export function getFileDisplayName(value, fallback = "Archivo") {
  const fileName = String(value || "").trim();

  if (!fileName) return fallback;

  return fileName.replace(/\.[^./\\]+$/, "") || fileName;
}
