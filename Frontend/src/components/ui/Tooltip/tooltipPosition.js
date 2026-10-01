/* Contiene cálculos puros para mantener tooltips visibles dentro del viewport. */
// Calcula el desplazamiento necesario para evitar que el tooltip salga del viewport.
export function getTooltipViewportOffset({
  bottom,
  left,
  margin = 8,
  right,
  top,
  viewportHeight,
  viewportWidth,
}) {
  let offsetX = 0;
  let offsetY = 0;

  if (left < margin) {
    offsetX = margin - left;
  } else if (right > viewportWidth - margin) {
    offsetX = viewportWidth - margin - right;
  }

  if (top < margin) {
    offsetY = margin - top;
  } else if (bottom > viewportHeight - margin) {
    offsetY = viewportHeight - margin - bottom;
  }

  return { offsetX, offsetY };
}

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

// Conserva la alineación horizontal al cambiar el tooltip a otro lado.
function getPositionForSide(side, preferredPosition) {
  if (side === "Left" || side === "Right") return side;

  const alignment = preferredPosition.endsWith(" right")
    ? "right"
    : preferredPosition.endsWith(" left")
      ? "left"
      : "center";

  return `${side} ${alignment}`;
}

// Busca la mejor posición disponible respetando primero la preferencia original.
export function getAdaptiveTooltipPosition({
  anchorBottom,
  anchorLeft,
  anchorRight,
  anchorTop,
  gap = 12,
  margin = 8,
  preferredPosition,
  tooltipHeight,
  tooltipWidth,
  viewportHeight,
  viewportWidth,
}) {
  const preferredSide = POSITION_SIDE[preferredPosition] || "Top";
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
