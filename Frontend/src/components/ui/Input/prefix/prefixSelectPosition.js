// Cuatro filas visibles de 35 px con tres gaps de 4 px y 8 px de padding vertical por lado,
// el mismo máximo de filas que el patrón de DropdownMenu del sistema.
export const PREFIX_SELECT_ROW_HEIGHT = 35;
export const PREFIX_SELECT_VISIBLE_ROWS = 4;
const ROW_GAP = 4;
const VERTICAL_PADDING = 16;
const VIEWPORT_MARGIN = 8;

/**
 * Calcula la altura máxima del listado según cuántas opciones existen, para que los catálogos
 * cortos conserven su altura natural y los largos desplacen dentro del panel.
 *
 * @param {number} optionCount - Opciones disponibles.
 * @returns {number} Altura máxima del panel en píxeles, padding incluido.
 */
export function getPrefixSelectPanelHeight(optionCount) {
  const rows = Math.min(Math.max(optionCount, 1), PREFIX_SELECT_VISIBLE_ROWS);
  return rows * PREFIX_SELECT_ROW_HEIGHT + (rows - 1) * ROW_GAP + VERTICAL_PADDING;
}

/**
 * Sitúa el listado unido al borde inferior del campo, con su mismo ancho y bordes laterales.
 * Si no cabe debajo (por ejemplo, un modal al pie de un viewport móvil), se abre hacia arriba
 * unido al borde superior. Las coordenadas son de viewport porque el panel usa `position: fixed`.
 *
 * @param {{top: number, bottom: number, left: number, width: number}} anchorRect - Rectángulo del campo.
 * @param {number} panelHeight - Altura máxima del panel.
 * @param {number} viewportHeight - Alto visible de la ventana.
 * @returns {{left: number, width: number, top: number, placement: "bottom"|"top"}} Posición del panel.
 */
export function getPrefixSelectPosition(anchorRect, panelHeight, viewportHeight) {
  const fitsBelow = anchorRect.bottom + panelHeight <= viewportHeight - VIEWPORT_MARGIN;
  const fitsAbove = anchorRect.top - panelHeight >= VIEWPORT_MARGIN;
  const placement = fitsBelow || !fitsAbove ? "bottom" : "top";
  return {
    left: anchorRect.left,
    width: anchorRect.width,
    top: placement === "bottom" ? anchorRect.bottom : anchorRect.top - panelHeight,
    placement,
  };
}

/**
 * Busca la siguiente opción cuyo texto visible o descripción empieza por lo escrito, empezando
 * después de la opción activa para que repetir una letra recorra las coincidencias.
 *
 * @param {Array<{label: string, description?: string}>} options - Opciones del selector.
 * @param {string} query - Texto acumulado de la búsqueda por teclado.
 * @param {number} fromIndex - Índice activo actual.
 * @returns {number} Índice encontrado o -1.
 */
export function findPrefixOptionIndex(options, query, fromIndex) {
  const normalizedQuery = query.toLocaleLowerCase("es");
  if (!normalizedQuery) return -1;
  for (let offset = 1; offset <= options.length; offset += 1) {
    const index = (fromIndex + offset + options.length) % options.length;
    const option = options[index];
    const candidates = [option.label, option.description].filter(Boolean);
    if (candidates.some((text) => text.toLocaleLowerCase("es").startsWith(normalizedQuery))) return index;
  }
  return -1;
}
