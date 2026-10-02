/**
 * Normaliza la búsqueda y comparación de etiquetas eliminando acentos y espacios exteriores.
 * Mantiene la conversión a minúsculas en español utilizada para búsqueda y deduplicación.
 *
 * @param {*} value Etiqueta o búsqueda recibida.
 * @returns {string} Texto comparable.
 */
export function normalizeTagSearchText(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}


/**
 * Crea un tag desde texto libre con identidad y opciones visuales predeterminadas.
 * Conserva el índice en el identificador y devuelve null cuando el texto no contiene una etiqueta.
 *
 * @param {*} value Texto escrito por el usuario.
 * @param {number} [fallbackIndex=0] Índice usado para la identidad y el avatar alternativo.
 * @returns {Object|null} Tag nuevo o ausencia de etiqueta.
 */
export function createTagFromText(value, fallbackIndex = 0) {
  const label = String(value ?? "").trim();

  if (!label) {
    return null;
  }

  return {
    id: `tag-custom-${label.toLowerCase().replace(/\s+/g, "-")}-${fallbackIndex}`,
    label,
    avatar: true,
    closeIcon: true,
    avatarText: label.charAt(0).toUpperCase() || String(fallbackIndex + 1),
  };
}


/**
 * Añade identidad y opciones de avatar/cierre antes de presentar un tag.
 * Conserva la prioridad del spread original, incluyendo propiedades explícitas con valor undefined.
 *
 * @param {Object} tag Tag proporcionado por el consumidor.
 * @param {string} fallbackId Identificador alternativo.
 * @returns {Object} Tag con los defaults y las sobrescrituras originales.
 */
export function normalizeTagItem(tag, fallbackId) {
  return {
    id: tag.id ?? fallbackId,
    avatar: true,
    closeIcon: true,
    ...tag,
  };
}
