/* Agrupa ejemplos de contenido y posiciones del Tooltip para documentación visual. */
import {
  createTooltipProps,
  createTooltipShowcaseItem,
} from "./tooltipConfig.js";

export const tooltipMainComponent = createTooltipProps({
  showSubtext: true,
  showTip: true,
  tipPosition: "Bottom center",
});

export const tooltipQuickToggleItems = [
  createTooltipShowcaseItem("Base", {
    showSubtext: false,
    showTip: false,
    tipPosition: "Right",
  }),
  createTooltipShowcaseItem("Show tip", {
    showSubtext: false,
    showTip: true,
    tipPosition: "Bottom center",
  }),
  createTooltipShowcaseItem("Subtext", {
    showSubtext: true,
    showTip: false,
    tipPosition: "Right",
  }),
];

export const tooltipPositionItems = [
  createTooltipShowcaseItem("Right", {
    showSubtext: false,
    showTip: true,
    tipPosition: "Right",
  }),
  createTooltipShowcaseItem("Left", {
    showSubtext: false,
    showTip: true,
    tipPosition: "Left",
  }),
  createTooltipShowcaseItem("Top center", {
    showSubtext: false,
    showTip: true,
    tipPosition: "Top center",
  }),
  createTooltipShowcaseItem("Top right", {
    showSubtext: false,
    showTip: true,
    tipPosition: "Top right",
  }),
  createTooltipShowcaseItem("Top left", {
    showSubtext: false,
    showTip: true,
    tipPosition: "Top left",
  }),
  createTooltipShowcaseItem("Bottom center", {
    showSubtext: false,
    showTip: true,
    tipPosition: "Bottom center",
  }),
  createTooltipShowcaseItem("Bottomright", {
    showSubtext: false,
    showTip: true,
    tipPosition: "Bottom right",
  }),
  createTooltipShowcaseItem("Bottom left", {
    showSubtext: false,
    showTip: true,
    tipPosition: "Bottom left",
  }),
];
