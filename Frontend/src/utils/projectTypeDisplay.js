export const PROJECT_TYPE_LABELS = {
  commercial: "Comercial",
  corporate: "Corporativo",
  residential: "Residencial",
  stands_exhibitions: "Stands y exhibiciones",
  advertising_stand: "Stand publicitario",
};

/**
 * Traduce tipos conocidos y conserva el valor original cuando no está en el catálogo.
 * Usa el fallback solo si tampoco hay valor disponible.
 *
 * @param {string|null} value - Tipo del proyecto.
 * @param {string} [fallback="-"] - Etiqueta alternativa.
 * @returns {string} Etiqueta de tipo.
 */
export function getProjectTypeLabel(value, fallback = "-") {
  return PROJECT_TYPE_LABELS[value] || value || fallback;
}

/**
 * Construye la categoría visible con el prefijo Proyecto.
 * Si no hay etiqueta devuelve Tipo de proyecto no disponible.
 *
 * @param {string|null} value - Tipo del proyecto.
 * @returns {string} Categoría visible.
 */
export function getProjectTypeDisplay(value) {
  const label = getProjectTypeLabel(value, "");
  return label ? `Proyecto ${label}` : "Tipo de proyecto no disponible";
}

/**
 * Divide los elementos para el showcase sin mutar la colección original.
 * Una colección no array produce []; el tamaño se convierte a número y se limita
 * a un mínimo de uno, sin redondearlo a entero.
 *
 * @param {Array|null} items - Elementos de presentación.
 * @param {number|string} itemsPerPage - Tamaño solicitado de página.
 * @returns {Array} Arrays de elementos por página.
 */
export function buildShowcasePages(items, itemsPerPage) {
  const safeItems = Array.isArray(items) ? items : [];
  const safePageSize = Math.max(Number(itemsPerPage) || 1, 1);
  const pages = [];

  for (let index = 0; index < safeItems.length; index += safePageSize) {
    pages.push(safeItems.slice(index, index + safePageSize));
  }

  return pages;
}

/**
 * Elige distribución por cantidad y ancho del viewport.
 * Un único elemento usa single; el resto usa mobile bajo 768, tablet bajo 1024
 * y desktop desde 1024, con cantidades por página de dos, dos y tres.
 *
 * @param {number} viewportWidth - Ancho del viewport en píxeles.
 * @param {number} itemCount - Número de elementos.
 * @returns {Object} columns, itemsPerPage y mode.
 */
export function getShowcaseLayout(viewportWidth, itemCount) {
  if (itemCount === 1) {
    return { columns: 1, itemsPerPage: 1, mode: "single" };
  }

  if (viewportWidth < 768) {
    return { columns: 1, itemsPerPage: 2, mode: "mobile" };
  }

  if (viewportWidth < 1024) {
    return { columns: 2, itemsPerPage: 2, mode: "tablet" };
  }

  return { columns: 3, itemsPerPage: 3, mode: "desktop" };
}

/**
 * Define la altura de card según el modo del showcase.
 * Desktop usa 273; mobile alterna 465 y 273 por índice global; los demás usan 465.
 *
 * @param {string} mode - Modo de layout.
 * @param {number} globalIndex - Índice global del elemento, no el índice dentro de página.
 * @returns {number} Altura en píxeles.
 */
export function getShowcaseCardHeight(mode, globalIndex) {
  if (mode === "desktop") return 273;
  if (mode === "mobile") return globalIndex % 2 === 0 ? 465 : 273;
  return 465;
}
