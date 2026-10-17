import assert from "node:assert/strict";
import test from "node:test";

import {
  TOOLTIP_ARROW_EDGE_INSET_PX,
  TOOLTIP_VIEWPORT_MARGIN_PX,
  getAdaptiveTooltipPosition,
  getTooltipPlacement,
} from "../src/components/ui/Tooltip/tooltipPosition.js";

const VIEWPORT = { viewportHeight: 800, viewportWidth: 1200 };
const BUBBLE = { tooltipHeight: 36, tooltipWidth: 140 };

/**
 * Construye el rectángulo de un ancla a partir de su esquina y su tamaño.
 *
 * @param {number} left Borde izquierdo.
 * @param {number} top Borde superior.
 * @param {number} [width=44] Ancho.
 * @param {number} [height=44] Alto.
 * @returns {{ left: number, top: number, right: number, bottom: number }} Rectángulo del ancla.
 */
function anchorAt(left, top, width = 44, height = 44) {
  return { bottom: top + height, left, right: left + width, top };
}

/**
 * Calcula una colocación con el viewport y la burbuja de referencia.
 *
 * @param {object} anchorRect Rectángulo del ancla.
 * @param {string} preferredPosition Posición pedida.
 * @param {object} [overrides] Cambios sobre la geometría de referencia.
 * @returns {object} Colocación calculada.
 */
function place(anchorRect, preferredPosition, overrides = {}) {
  return getTooltipPlacement({ anchorRect, preferredPosition, ...VIEWPORT, ...BUBBLE, ...overrides });
}

/**
 * Devuelve la coordenada absoluta del centro de la flecha.
 *
 * @param {object} placement Colocación calculada.
 * @returns {number} Coordenada x (lados verticales) o y (laterales) de la flecha.
 */
function arrowPoint(placement) {
  return placement.side === "Top" || placement.side === "Bottom"
    ? placement.left + placement.arrowOffset
    : placement.top + placement.arrowOffset;
}

test("Top and bottom center keep the bubble centered on the anchor", () => {
  for (const position of ["Top center", "Bottom center"]) {
    const placement = place(anchorAt(500, 400), position);
    assert.equal(placement.position, position);
    assert.equal(placement.left + BUBBLE.tooltipWidth / 2, 522);
    assert.equal(arrowPoint(placement), 522);
  }
  assert.equal(place(anchorAt(500, 400), "Top center").top, 400 - 12 - BUBBLE.tooltipHeight);
  assert.equal(place(anchorAt(500, 400), "Bottom center").top, 444 + 12);
});

test("right alignments grow to the left and left alignments grow to the right", () => {
  for (const side of ["Top", "Bottom"]) {
    const right = place(anchorAt(500, 400), `${side} right`);
    assert.equal(right.left + BUBBLE.tooltipWidth, 544, `${side} right aligns the right edges`);
    assert.equal(arrowPoint(right), 522);

    const left = place(anchorAt(500, 400), `${side} left`);
    assert.equal(left.left, 500, `${side} left aligns the left edges`);
    assert.equal(arrowPoint(left), 522);
  }
});

test("narrow anchors keep the aligned arrow away from the bubble corner", () => {
  const right = place(anchorAt(600, 400, 4, 16), "Top right");
  assert.equal(arrowPoint(right), 602);
  assert.equal(right.arrowOffset, BUBBLE.tooltipWidth - TOOLTIP_ARROW_EDGE_INSET_PX);

  const left = place(anchorAt(600, 400, 4, 16), "Bottom left");
  assert.equal(arrowPoint(left), 602);
  assert.equal(left.arrowOffset, TOOLTIP_ARROW_EDGE_INSET_PX);
});

test("lateral positions center the bubble vertically on the anchor", () => {
  const right = place(anchorAt(500, 400), "Right");
  assert.deepEqual([right.position, right.left, arrowPoint(right)], ["Right", 556, 422]);

  const left = place(anchorAt(500, 400), "Left");
  assert.deepEqual([left.position, left.left + BUBBLE.tooltipWidth, arrowPoint(left)], ["Left", 488, 422]);
});

test("a bubble shifted inside the viewport compensates its arrow", () => {
  const nearLeft = place(anchorAt(38, 400, 4, 16), "Top center");
  assert.equal(nearLeft.left, TOOLTIP_VIEWPORT_MARGIN_PX);
  assert.equal(arrowPoint(nearLeft), 40);

  const nearRight = place(anchorAt(1150, 400, 4, 16), "Top center");
  assert.equal(nearRight.left + BUBBLE.tooltipWidth, 1200 - TOOLTIP_VIEWPORT_MARGIN_PX);
  assert.equal(arrowPoint(nearRight), 1152);

  const wrongDirection = place(anchorAt(1130, 400), "Top left");
  assert.equal(wrongDirection.left + BUBBLE.tooltipWidth, 1192);
  assert.equal(arrowPoint(wrongDirection), 1152);

  const nearBottom = place(anchorAt(10, 768, 44, 16), "Right");
  assert.equal(nearBottom.top + BUBBLE.tooltipHeight, 792);
  assert.equal(arrowPoint(nearBottom), 776);
});

test("the arrow never leaves the bubble when the anchor touches the edge", () => {
  const placement = place(anchorAt(0, 400, 4, 16), "Top center");
  assert.equal(placement.left, TOOLTIP_VIEWPORT_MARGIN_PX);
  assert.equal(placement.arrowOffset, TOOLTIP_ARROW_EDGE_INSET_PX);

  const tiny = place(anchorAt(0, 400, 4, 16), "Top center", { tooltipWidth: 20 });
  assert.equal(tiny.arrowOffset, 10);
});

test("the bubble flips side, keeps its alignment and points back at the anchor", () => {
  const flipped = place(anchorAt(1100, 10), "Top right");
  assert.equal(flipped.position, "Bottom right");
  assert.equal(flipped.top, 54 + 12);
  assert.equal(arrowPoint(flipped), 1122);

  const lateral = place(anchorAt(4, 400), "Left");
  assert.equal(lateral.position, "Right");
  assert.equal(lateral.left, 60);
});

test("long text that cannot fit keeps the start of the bubble inside the margin", () => {
  const placement = place(anchorAt(100, 400), "Top center", { tooltipWidth: 1300 });
  assert.equal(placement.left, TOOLTIP_VIEWPORT_MARGIN_PX);
});

test("progress bar markers keep the arrow on their exact position", () => {
  const trackLeft = 40;
  const trackWidth = 300;
  for (const percent of [0, 5, 50, 95, 100]) {
    const center = trackLeft + (trackWidth * percent) / 100;
    const placement = place(anchorAt(center - 2, 600, 4, 16), "Top center", { tooltipWidth: 190, viewportWidth: 380 });
    assert.equal(placement.side, "Top");
    assert.ok(placement.left >= TOOLTIP_VIEWPORT_MARGIN_PX && placement.left + 190 <= 372, `${percent} % stays visible`);
    assert.equal(arrowPoint(placement), center, `${percent} % keeps the arrow on the marker`);
  }
});

test("tooltip flips below the button when there is not enough room above", () => {
  assert.equal(
    getAdaptiveTooltipPosition({
      anchorBottom: 48,
      anchorLeft: 20,
      anchorRight: 52,
      anchorTop: 16,
      preferredPosition: "Top center",
      tooltipHeight: 40,
      tooltipWidth: 120,
      viewportHeight: 800,
      viewportWidth: 1200,
    }),
    "Bottom center",
  );
});

test("tooltip keeps its preferred side when it has enough separation", () => {
  assert.equal(
    getAdaptiveTooltipPosition({
      anchorBottom: 432,
      anchorLeft: 584,
      anchorRight: 616,
      anchorTop: 400,
      preferredPosition: "Top right",
      tooltipHeight: 40,
      tooltipWidth: 120,
      viewportHeight: 800,
      viewportWidth: 1200,
    }),
    "Top right",
  );
});

test("tooltip uses a lateral side when neither vertical side has room", () => {
  assert.equal(
    getAdaptiveTooltipPosition({
      anchorBottom: 55,
      anchorLeft: 100,
      anchorRight: 132,
      anchorTop: 25,
      preferredPosition: "Top center",
      tooltipHeight: 100,
      tooltipWidth: 80,
      viewportHeight: 80,
      viewportWidth: 500,
    }),
    "Right",
  );
});
