/* Agrupa ejemplos de tamaños, iconos y estilos del Button para el sistema de diseño. */
import {
  createButtonProps,
  createButtonShowcaseItem,
  createButtonStyleSection,
} from "./buttonConfig.js";

const SHOWCASE_LABEL = "Aceptar";

export const buttonSizeItems = ["S", "M", "L"].map((size) =>
  createButtonShowcaseItem(size, {
    size,
    showLeftIcon: false,
    showRightIcon: false,
    children: SHOWCASE_LABEL,
  }),
);

export const buttonQuickToggleItems = [
  createButtonShowcaseItem("Left", {
    showRightIcon: false,
  }),
  createButtonShowcaseItem("Label", {
    showLeftIcon: false,
    showRightIcon: false,
  }),
  createButtonShowcaseItem("Right", {
    showLeftIcon: false,
  }),
  {
    label: "Icon",
    props: createButtonProps({
      showText: false,
      showRightIcon: false,
      "aria-label": "Quick toggle icon",
    }),
  },
];

export const buttonStyleSections = [
  createButtonStyleSection("styles / Primary / solid"),
  createButtonStyleSection("styles / Primary / outline", { type: "Outline" }),
  createButtonStyleSection("styles / Primary / Ghost", { type: "Ghost" }),
  createButtonStyleSection("styles / Primary / Link", { type: "Link" }),
  createButtonStyleSection("styles / Danger / solid", { theme: "Danger" }),
  createButtonStyleSection("styles / Danger / outline", {
    theme: "Danger",
    type: "Outline",
  }),
  createButtonStyleSection("styles / info / solid", { theme: "Info" }),
  createButtonStyleSection("styles / info / outline", {
    theme: "Info",
    type: "Outline",
  }),
];
