import {
  INPUT_OPTIONS_ANCHOR_OFFSET,
  INPUT_OPTIONS_PANEL_PADDING,
  getInputOptionsViewportHeight,
} from "../options/inputOptionsConfig.js";

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
 * Sitúa el listado como extensión del segmento selector, con la misma relación que el selector
 * telefónico: unido a su borde inferior, 1 px a su izquierda y con al menos su ancho + 1 px. El
 * ancho final lo decide el contenido (abreviatura y nombre), limitado al viewport. Si no cabe
 * debajo, se une al borde superior del segmento. Coordenadas de viewport: el panel usa
 * `position: fixed` en un portal para no quedar recortado por modales con overflow.
 *
 * @param {{top: number, bottom: number, left: number, width: number}} anchorRect - Rectángulo del segmento selector.
 * @param {number} panelHeight - Altura del panel.
 * @param {{width: number, height: number}} viewport - Dimensiones visibles de la ventana.
 * @returns {{left: number, top: number, minWidth: number, maxWidth: number, placement: "bottom"|"top"}} Posición.
 */
export function getPrefixSelectPosition(anchorRect, panelHeight, viewport) {
  const fitsBelow = anchorRect.bottom + panelHeight <= viewport.height - VIEWPORT_MARGIN;
  const fitsAbove = anchorRect.top - panelHeight >= VIEWPORT_MARGIN;
  const placement = fitsBelow || !fitsAbove ? "bottom" : "top";
  const left = anchorRect.left - INPUT_OPTIONS_ANCHOR_OFFSET;
  return {
    left,
    top: placement === "bottom" ? anchorRect.bottom : anchorRect.top - panelHeight,
    minWidth: anchorRect.width + INPUT_OPTIONS_ANCHOR_OFFSET,
    maxWidth: Math.max(anchorRect.width + INPUT_OPTIONS_ANCHOR_OFFSET, viewport.width - left - VIEWPORT_MARGIN),
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
