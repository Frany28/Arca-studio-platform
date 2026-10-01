/* Agrupa ejemplos de estructura, estados y feedback del TextArea para el sistema de diseño. */
import {
  createTextAreaProps,
  createTextAreaShowcaseItem,
} from "./textAreaConfig.js";

export const textAreaMainComponent = createTextAreaProps({
  showLabel: true,
  showHint: true,
  showLabelInfo: true,
  placeholder: "Texto de prueba",
});

export const textAreaQuickToggleItems = [
  createTextAreaShowcaseItem("Default", {
    showLabel: false,
    showHint: false,
  }),
  createTextAreaShowcaseItem("Label", {
    showLabel: true,
    showHint: false,
  }),
  createTextAreaShowcaseItem("Hint text", {
    showLabel: false,
    showHint: true,
  }),
];

export const textAreaStateItems = [
  createTextAreaShowcaseItem("Default", {
    state: "Default",
    defaultValue: "",
  }),
  createTextAreaShowcaseItem("Hover", {
    state: "Hover",
    defaultValue: "Texto de prueba",
  }),
  createTextAreaShowcaseItem("Focused", {
    state: "Focused",
    defaultValue: "Texto de prueba",
  }),
  createTextAreaShowcaseItem("Filled", {
    state: "Filled",
    defaultValue: "Texto de prueba",
  }),
];

export const textAreaFeedbackItems = [
  createTextAreaShowcaseItem("Disabled", {
    state: "Disabled",
    disabled: true,
    defaultValue: "Texto de prueba",
  }),
  createTextAreaShowcaseItem("Error", {
    state: "Error",
    defaultValue: "Texto de prueba",
    required: true,
  }),
];
