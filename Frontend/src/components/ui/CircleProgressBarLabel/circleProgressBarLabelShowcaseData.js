/* Agrupa ejemplos de porcentajes y tamaños del progreso circular para documentación visual. */
import {
  createCircleProgressBarLabelProps,
  createCircleProgressBarLabelShowcaseItem,
} from "./circleProgressBarLabelConfig.js";

export const circleProgressBarLabelMainComponent =
  createCircleProgressBarLabelProps();

export const circleProgressBarLabelQuickToggleItems = [
  createCircleProgressBarLabelShowcaseItem("Base", {
    showText: false,
  }),
  createCircleProgressBarLabelShowcaseItem("Title"),
];

export const circleProgressBarLabelReferenceItems = [
  createCircleProgressBarLabelShowcaseItem("20% / S", {
    value: 20,
    size: "S",
  }),
  createCircleProgressBarLabelShowcaseItem("50% / S", {
    value: 50,
    size: "S",
  }),
  createCircleProgressBarLabelShowcaseItem("80% / S", {
    value: 80,
    size: "S",
  }),
  createCircleProgressBarLabelShowcaseItem("100% / S", {
    value: 100,
    size: "S",
  }),
  createCircleProgressBarLabelShowcaseItem("20% / M", {
    value: 20,
    size: "M",
  }),
  createCircleProgressBarLabelShowcaseItem("20% / L", {
    value: 20,
    size: "L",
  }),
];

export const circleProgressBarLabelExampleItem =
  createCircleProgressBarLabelProps();
