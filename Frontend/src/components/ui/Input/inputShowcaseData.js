/* Agrupa ejemplos de tamaños, estados y tipos del Input para documentación visual. */
import { createInputProps, createInputShowcaseItem } from "./inputConfig.js";

export const inputMainComponent = createInputProps({
  type: "Default input",
  size: "S",
  defaultValue: "Texto de prueba",
});

export const inputSizeItems = [
  createInputShowcaseItem("S", {
    size: "S",
    defaultValue: "Texto de prueba",
    showLabel: false,
    showHint: false,
    showLeftIcon: false,
    showRightIcon: false,
  }),
  createInputShowcaseItem("M", {
    size: "M",
    defaultValue: "Texto de prueba",
    showLabel: false,
    showHint: false,
    showLeftIcon: false,
    showRightIcon: false,
  }),
  createInputShowcaseItem("L", {
    size: "L",
    defaultValue: "Texto de prueba",
    showLabel: false,
    showHint: false,
    showLeftIcon: false,
    showRightIcon: false,
  }),
];

export const inputStateItems = [
  createInputShowcaseItem("Default", {
    state: "Default",
    defaultValue: "",
  }),
  createInputShowcaseItem("Hover", {
    state: "Hover",
    defaultValue: "Texto de prueba",
  }),
  createInputShowcaseItem("Focused", {
    state: "Focused",
    defaultValue: "Texto de prueba",
  }),
  createInputShowcaseItem("Filled", {
    state: "Filled",
    defaultValue: "Texto de prueba",
  }),
  createInputShowcaseItem("Disabled", {
    state: "Disabled",
    defaultValue: "Texto de prueba",
    disabled: true,
  }),
  createInputShowcaseItem("Error", {
    state: "Error",
    defaultValue: "Texto de prueba",
  }),
];

export const inputQuickToggleItems = [
  createInputShowcaseItem("Base", {
    size: "L",
    showLabel: false,
    showHint: false,
    showLeftIcon: false,
    showRightIcon: false,
    defaultValue: "Texto de prueba",
  }),
  createInputShowcaseItem("Label", {
    size: "L",
    showHint: false,
    showLeftIcon: false,
    showRightIcon: false,
    defaultValue: "Texto de prueba",
  }),
  createInputShowcaseItem("Hint text", {
    size: "L",
    showLabel: false,
    showLeftIcon: false,
    showRightIcon: false,
    defaultValue: "Texto de prueba",
  }),
  createInputShowcaseItem("Left icon", {
    size: "L",
    showLabel: false,
    showHint: false,
    showRightIcon: false,
    defaultValue: "Texto de prueba",
  }),
  createInputShowcaseItem("Right icon", {
    size: "L",
    showLabel: false,
    showHint: false,
    showLeftIcon: false,
    defaultValue: "Texto de prueba",
  }),
  createInputShowcaseItem("Password strength", {
    type: "Password",
    size: "L",
    showLeftIcon: false,
    showPasswordStrength: true,
    defaultValue: "",
    showHint: true,
    passwordHintTitle: "Debe contener al menos:",
  }),
];

export const inputTypeItems = [
  createInputShowcaseItem("Default input", {
    type: "Default input",
    size: "L",
    defaultValue: "Texto de prueba",
  }),
  createInputShowcaseItem("Search bar", {
    type: "Search bar",
    size: "L",
    showRightIcon: false,
  }),
  createInputShowcaseItem("Password", {
    type: "Password",
    size: "L",
    defaultValue: "Password1!",
  }),
  createInputShowcaseItem("Tags", {
    type: "Tags",
    size: "S",
    tags: [],
    tagOptions: [
      { id: "tag-user-1", label: "Label", avatarText: "A" },
      { id: "tag-user-2", label: "Label", avatarText: "B" },
      { id: "tag-user-3", label: "Label", avatarText: "C" },
    ],
  }),
  createInputShowcaseItem("Phone number", {
    type: "Phone number",
    size: "L",
    defaultValue: "(444) 1234-5678",
  }),
];

export const inputTypeStateItems = [
  createInputShowcaseItem("Default input / Error", {
    type: "Default input",
    size: "L",
    state: "Error",
    defaultValue: "Texto de prueba",
  }),
  createInputShowcaseItem("Default input / Disabled", {
    type: "Default input",
    size: "L",
    state: "Disabled",
    disabled: true,
    defaultValue: "Texto de prueba",
  }),
  createInputShowcaseItem("Search bar / Error", {
    type: "Search bar",
    size: "L",
    state: "Error",
    showRightIcon: false,
    defaultValue: "Buscar...",
  }),
  createInputShowcaseItem("Search bar / Disabled", {
    type: "Search bar",
    size: "L",
    state: "Disabled",
    disabled: true,
    showRightIcon: false,
    defaultValue: "Buscar...",
  }),
  createInputShowcaseItem("Password / Error", {
    type: "Password",
    size: "L",
    state: "Error",
    defaultValue: "Password1!",
  }),
  createInputShowcaseItem("Password / Disabled", {
    type: "Password",
    size: "L",
    state: "Disabled",
    disabled: true,
    defaultValue: "Password1!",
  }),
  createInputShowcaseItem("Phone number / Error", {
    type: "Phone number",
    size: "L",
    state: "Error",
    defaultValue: "(444) 1234-5678",
  }),
  createInputShowcaseItem("Phone number / Disabled", {
    type: "Phone number",
    size: "L",
    state: "Disabled",
    disabled: true,
    defaultValue: "(444) 1234-5678",
  }),
];
