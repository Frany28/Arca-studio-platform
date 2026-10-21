import {
  INPUT_OPTIONS_ANCHOR_OFFSET,
  INPUT_OPTIONS_PANEL_BORDER,
  INPUT_OPTIONS_PANEL_PADDING,
  getInputOptionsViewportHeight,
} from "../options/inputOptionsConfig.js";

const VIEWPORT_MARGIN = 8;
// Altura del panel que no pertenece al área de opciones: padding vertical y borde libre.
const PANEL_CHROME = INPUT_OPTIONS_PANEL_PADDING + INPUT_OPTIONS_PANEL_BORDER;

/**
 * Altura total del panel: el área de tres filas compartida con el selector telefónico más su
 * padding vertical y su borde libre; los catálogos cortos conservan su altura natural.
 *
 * @param {number} optionCount - Opciones disponibles.
 * @returns {number} Altura del panel en píxeles, padding y borde incluidos.
 */
export function getPrefixSelectPanelHeight(optionCount) {
  return getInputOptionsViewportHeight(optionCount) + PANEL_CHROME;
}

/**
 * Sitúa el listado como extensión del segmento selector, con la misma relación que el selector
 * telefónico: unido a su borde inferior, 1 px a su izquierda y con al menos su ancho + 1 px. El
 * ancho final lo decide el contenido (la abreviatura más larga), limitado al viewport. Si no cabe
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
 * Resuelve dónde y con qué altura abrir el listado flotante. El panel vive en un portal con
 * `position: fixed` por encima del modal, así que solo lo acota el viewport: puede cubrir
 * temporalmente el contenido del formulario (incluidas sus acciones) sin desplazarlo ni hacer
 * crecer el modal. Se abre debajo del segmento si cabe y, si no, encima (como el selector
 * telefónico); el área de opciones se limita al espacio visible de ese lado (pantallas muy
 * bajas), con al menos una fila, para que todas las opciones sigan alcanzables con su scroll.
 *
 * @param {Object} params - Medidas en coordenadas de viewport.
 * @param {{top: number, bottom: number, left: number, width: number}} params.segment - Segmento selector.
 * @param {number} params.panelHeight - Altura natural del panel (padding incluido).
 * @param {{width: number, height: number}} params.viewport - Ventana visible.
 * @returns {{left: number, top: number, minWidth: number, maxWidth: number, placement: "bottom"|"top",
 * viewportMaxHeight: number}} Posición y altura del área de opciones.
 */
export function resolvePrefixSelectLayout({ segment, panelHeight, viewport }) {
  const { placement } = getPrefixSelectPosition(segment, panelHeight, viewport);
  const naturalViewportHeight = panelHeight - PANEL_CHROME;
  const viewportSpace = placement === "bottom"
    ? viewport.height - VIEWPORT_MARGIN - segment.bottom
    : segment.top - VIEWPORT_MARGIN;
  const viewportMaxHeight = Math.max(
    Math.min(naturalViewportHeight, viewportSpace - PANEL_CHROME),
    getInputOptionsViewportHeight(1),
  );
  const left = segment.left - INPUT_OPTIONS_ANCHOR_OFFSET;

  return {
    left,
    top: placement === "bottom" ? segment.bottom : segment.top - (viewportMaxHeight + PANEL_CHROME),
    minWidth: segment.width + INPUT_OPTIONS_ANCHOR_OFFSET,
    maxWidth: Math.max(segment.width + INPUT_OPTIONS_ANCHOR_OFFSET, viewport.width - left - VIEWPORT_MARGIN),
    placement,
    viewportMaxHeight,
  };
}

/**
 * Calcula el `scrollTop` mínimo del área desplazable para que una opción quede completamente
 * visible («nearest»): no se mueve si ya lo está, sube si queda por encima y baja si queda por
 * debajo. Solo afecta al listado, a diferencia de `scrollIntoView`, que desplaza también los
 * contenedores ancestros (modal o página).
 *
 * @param {{top: number, bottom: number}} viewportRect - Rectángulo visible del área desplazable.
 * @param {number} scrollTop - Desplazamiento actual del área.
 * @param {{top: number, bottom: number}} optionRect - Rectángulo de la opción.
 * @returns {number} Nuevo `scrollTop`.
 */
export function getScrollTopToRevealOption(viewportRect, scrollTop, optionRect) {
  if (optionRect.top < viewportRect.top) return scrollTop - (viewportRect.top - optionRect.top);
  if (optionRect.bottom > viewportRect.bottom) return scrollTop + (optionRect.bottom - viewportRect.bottom);
  return scrollTop;
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
