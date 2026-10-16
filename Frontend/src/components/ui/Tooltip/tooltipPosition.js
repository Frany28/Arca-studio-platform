/* Contiene cálculos geométricos puros para colocar tooltips y su flecha dentro del viewport. */

// Separación entre el ancla y el borde de la burbuja; la flecha ocupa parte de este espacio.
export const TOOLTIP_ANCHOR_GAP_PX = 12;

// Distancia mínima entre la burbuja y los bordes del área visible.
export const TOOLTIP_VIEWPORT_MARGIN_PX = 8;

// Distancia mínima del centro de la flecha a las esquinas de la burbuja: los 6 px que el diseño
// deja entre la flecha y el borde más la mitad de sus 20 px de ancho. Evita que la flecha
// invada el radio de la burbuja o quede fuera de ella cuando se desplaza.
export const TOOLTIP_ARROW_EDGE_INSET_PX = 16;

const POSITION_SIDE = {
  Right: "Right",
  Left: "Left",
  "Top center": "Top",
  "Top right": "Top",
  "Top left": "Top",
  "Bottom center": "Bottom",
  "Bottom right": "Bottom",
  "Bottom left": "Bottom",
};

const OPPOSITE_SIDE = {
  Top: "Bottom",
  Bottom: "Top",
  Left: "Right",
  Right: "Left",
};

/**
 * Obtiene el lado del ancla en el que se dibuja la burbuja para una posición del Tooltip.
 * Las posiciones superiores e inferiores comparten lado aunque cambie su alineación.
 *
 * @param {string} position Posición del Tooltip, por ejemplo "Top right".
 * @returns {"Top"|"Bottom"|"Left"|"Right"} Lado de la burbuja respecto al ancla.
 */
export function getTooltipSide(position) {
  return POSITION_SIDE[position] || "Top";
}

/**
 * Obtiene la alineación horizontal de una posición superior o inferior.
 * "right" alinea los bordes derechos y hace crecer la burbuja hacia la izquierda; "left", al revés.
 *
 * @param {string} position Posición del Tooltip.
 * @returns {"left"|"center"|"right"} Alineación de la burbuja.
 */
function getTooltipAlignment(position) {
  if (position.endsWith(" right")) return "right";
  if (position.endsWith(" left")) return "left";
  return "center";
}

/**
 * Conserva la alineación horizontal al cambiar el tooltip a otro lado.
 * Los lados laterales no tienen alineación, por lo que al volver a un lado vertical se centran.
 *
 * @param {string} side Lado de destino.
 * @param {string} preferredPosition Posición pedida por el consumidor.
 * @returns {string} Posición equivalente en el lado de destino.
 */
function getPositionForSide(side, preferredPosition) {
  if (side === "Left" || side === "Right") return side;

  return `${side} ${getTooltipAlignment(preferredPosition)}`;
}

/**
 * Busca la mejor posición disponible respetando primero la preferencia original.
 * Prueba el lado preferido, después el opuesto, luego el perpendicular con más espacio y,
 * si ninguno cabe, el lado con mayor proporción de espacio disponible.
 *
 * @param {object} geometry Geometría del ancla, la burbuja y el viewport.
 * @param {number} geometry.anchorBottom Borde inferior del ancla.
 * @param {number} geometry.anchorLeft Borde izquierdo del ancla.
 * @param {number} geometry.anchorRight Borde derecho del ancla.
 * @param {number} geometry.anchorTop Borde superior del ancla.
 * @param {number} [geometry.gap] Separación entre ancla y burbuja.
 * @param {number} [geometry.margin] Margen respecto al viewport.
 * @param {string} geometry.preferredPosition Posición pedida por el consumidor.
 * @param {number} geometry.tooltipHeight Alto real de la burbuja.
 * @param {number} geometry.tooltipWidth Ancho real de la burbuja.
 * @param {number} geometry.viewportHeight Alto del área visible.
 * @param {number} geometry.viewportWidth Ancho del área visible.
 * @returns {string} Posición final del Tooltip.
 */
export function getAdaptiveTooltipPosition({
  anchorBottom,
  anchorLeft,
  anchorRight,
  anchorTop,
  gap = TOOLTIP_ANCHOR_GAP_PX,
  margin = TOOLTIP_VIEWPORT_MARGIN_PX,
  preferredPosition,
  tooltipHeight,
  tooltipWidth,
  viewportHeight,
  viewportWidth,
}) {
  const preferredSide = getTooltipSide(preferredPosition);
  const available = {
    Top: anchorTop - gap - margin,
    Bottom: viewportHeight - anchorBottom - gap - margin,
    Left: anchorLeft - gap - margin,
    Right: viewportWidth - anchorRight - gap - margin,
  };
  const required = {
    Top: tooltipHeight,
    Bottom: tooltipHeight,
    Left: tooltipWidth,
    Right: tooltipWidth,
  };
  const fits = (side) => available[side] >= required[side];

  if (fits(preferredSide)) return preferredPosition;

  const oppositeSide = OPPOSITE_SIDE[preferredSide];
  if (fits(oppositeSide)) {
    return getPositionForSide(oppositeSide, preferredPosition);
  }

  const perpendicularSides = ["Top", "Bottom", "Right", "Left"].filter(
    (side) => side !== preferredSide && side !== oppositeSide,
  );
  const fittingPerpendicularSide = perpendicularSides
    .filter(fits)
    .sort((a, b) => available[b] - available[a])[0];

  if (fittingPerpendicularSide) {
    return getPositionForSide(fittingPerpendicularSide, preferredPosition);
  }

  const roomiestSide = [preferredSide, oppositeSide, ...perpendicularSides]
    .sort(
      (a, b) =>
        available[b] / Math.max(required[b], 1) -
        available[a] / Math.max(required[a], 1),
    )[0];

  return getPositionForSide(roomiestSide, preferredPosition);
}

/**
 * Limita un valor a un intervalo; si el intervalo es inválido porque el contenido no cabe,
 * prioriza el mínimo para que el inicio de la burbuja permanezca visible.
 *
 * @param {number} value Valor a limitar.
 * @param {number} min Límite inferior.
 * @param {number} max Límite superior.
 * @returns {number} Valor dentro del intervalo.
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

/**
 * Calcula la coordenada inicial de la burbuja sobre el eje en que se alinea con el ancla.
 * Las alineaciones laterales igualan el borde de la burbuja con el del ancla, pero nunca
 * dejan la flecha (que apunta al centro del ancla) más cerca del borde que el inset permitido.
 *
 * @param {object} options Geometría del eje.
 * @param {"left"|"center"|"right"} options.alignment Alineación pedida.
 * @param {number} options.anchorStart Borde inicial del ancla en el eje.
 * @param {number} options.anchorEnd Borde final del ancla en el eje.
 * @param {number} options.size Tamaño de la burbuja en el eje.
 * @param {number} options.arrowInset Distancia mínima de la flecha al borde.
 * @returns {number} Coordenada inicial de la burbuja.
 */
function getAlignedStart({ alignment, anchorEnd, anchorStart, arrowInset, size }) {
  const anchorCenter = (anchorStart + anchorEnd) / 2;

  if (alignment === "left") return Math.min(anchorStart, anchorCenter - arrowInset);
  if (alignment === "right") return Math.max(anchorEnd, anchorCenter + arrowInset) - size;
  return anchorCenter - size / 2;
}

/**
 * Calcula la colocación final de un tooltip a partir del ancla, el tamaño real de la burbuja
 * y el área visible. Elige el lado con espacio, aplica la alineación pedida, desplaza la burbuja
 * para mantenerla dentro de los márgenes y recoloca la flecha para que siga apuntando al
 * centro del ancla sin salir de la burbuja. Es una función pura: no lee ni escribe el DOM.
 *
 * @param {object} options Geometría de entrada.
 * @param {{ top: number, right: number, bottom: number, left: number }} options.anchorRect Rectángulo del ancla en el viewport.
 * @param {number} options.tooltipWidth Ancho real de la burbuja.
 * @param {number} options.tooltipHeight Alto real de la burbuja.
 * @param {string} options.preferredPosition Posición pedida por el consumidor.
 * @param {number} options.viewportWidth Ancho del área visible.
 * @param {number} options.viewportHeight Alto del área visible.
 * @param {number} [options.gap] Separación entre ancla y burbuja.
 * @param {number} [options.margin] Margen respecto al área visible.
 * @param {number} [options.arrowInset] Distancia mínima de la flecha a los bordes de la burbuja.
 * @returns {{ position: string, side: string, left: number, top: number, arrowOffset: number }}
 * Posición final, lado, esquina superior izquierda de la burbuja y centro de la flecha medido
 * desde el borde izquierdo (lados superior e inferior) o superior (lados laterales) de la burbuja.
 */
export function getTooltipPlacement({
  anchorRect,
  arrowInset = TOOLTIP_ARROW_EDGE_INSET_PX,
  gap = TOOLTIP_ANCHOR_GAP_PX,
  margin = TOOLTIP_VIEWPORT_MARGIN_PX,
  preferredPosition,
  tooltipHeight,
  tooltipWidth,
  viewportHeight,
  viewportWidth,
}) {
  const position = getAdaptiveTooltipPosition({
    anchorBottom: anchorRect.bottom,
    anchorLeft: anchorRect.left,
    anchorRight: anchorRect.right,
    anchorTop: anchorRect.top,
    gap,
    margin,
    preferredPosition,
    tooltipHeight,
    tooltipWidth,
    viewportHeight,
    viewportWidth,
  });
  const side = getTooltipSide(position);
  const isVerticalSide = side === "Top" || side === "Bottom";
  let left;
  let top;

  if (isVerticalSide) {
    left = getAlignedStart({
      alignment: getTooltipAlignment(position),
      anchorEnd: anchorRect.right,
      anchorStart: anchorRect.left,
      arrowInset,
      size: tooltipWidth,
    });
    top = side === "Top"
      ? anchorRect.top - gap - tooltipHeight
      : anchorRect.bottom + gap;
  } else {
    left = side === "Left"
      ? anchorRect.left - gap - tooltipWidth
      : anchorRect.right + gap;
    top = (anchorRect.top + anchorRect.bottom) / 2 - tooltipHeight / 2;
  }

  left = clamp(left, margin, viewportWidth - margin - tooltipWidth);
  top = clamp(top, margin, viewportHeight - margin - tooltipHeight);

  const anchorCenter = isVerticalSide
    ? (anchorRect.left + anchorRect.right) / 2 - left
    : (anchorRect.top + anchorRect.bottom) / 2 - top;
  const bubbleLength = isVerticalSide ? tooltipWidth : tooltipHeight;
  const arrowOffset = bubbleLength < arrowInset * 2
    ? bubbleLength / 2
    : clamp(anchorCenter, arrowInset, bubbleLength - arrowInset);

  return { arrowOffset, left, position, side, top };
}
