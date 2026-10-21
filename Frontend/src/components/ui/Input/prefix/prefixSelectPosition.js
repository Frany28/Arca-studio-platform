import { INPUT_OPTIONS_PANEL_PADDING, getInputOptionsViewportHeight } from "../options/inputOptionsConfig.js";

const VIEWPORT_MARGIN = 8;

/**
 * Altura total del panel: el área de tres filas compartida con el selector telefónico más su
 * padding vertical; los catálogos cortos conservan su altura natural.
 *
 * @param {number} optionCount - Opciones disponibles.
 * @returns {number} Altura del panel en píxeles, padding incluido.
 */
export function getPrefixSelectPanelHeight(optionCount) {
  return getInputOptionsViewportHeight(optionCount) + INPUT_OPTIONS_PANEL_PADDING;
}

/**
 * Sitúa el listado unido al borde inferior del campo, con su mismo ancho y bordes laterales.
 * Si no cabe debajo (por ejemplo, un modal al pie de un viewport móvil), se abre hacia arriba
 * unido al borde superior. Las coordenadas son de viewport porque el panel usa `position: fixed`.
 *
 * @param {{top: number, bottom: number, left: number, width: number}} anchorRect - Rectángulo del campo.
 * @param {number} panelHeight - Altura del panel.
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
