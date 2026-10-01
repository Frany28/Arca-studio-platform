/* Contiene ejemplos de actividad, tamaños y estados del Toggle para documentación visual. */
import {
  createToggleProps,
  createToggleShowcaseItem,
} from "./toggleConfig.js";

export const toggleMainComponent = createToggleProps();

export const toggleActivityItems = [
  createToggleShowcaseItem("Active", {
    active: true,
  }),
  createToggleShowcaseItem("Inactive", {
    active: false,
  }),
];

export const toggleSizeItems = [
  createToggleShowcaseItem("S", {
    size: "S",
  }),
  createToggleShowcaseItem("M", {
    size: "M",
  }),
  createToggleShowcaseItem("L", {
    size: "L",
  }),
];

export const toggleStateItems = [
  createToggleShowcaseItem("Default", {
    state: "Default",
  }),
  createToggleShowcaseItem("Hover", {
    state: "Hover",
  }),
  createToggleShowcaseItem("Focused", {
    state: "Focused",
  }),
  createToggleShowcaseItem("Disabled", {
    state: "Disabled",
  }),
];

export const toggleReferenceRows = [
  [
    createToggleProps({
      size: "S",
      active: true,
      state: "Default",
    }),
    createToggleProps({
      size: "M",
      active: true,
      state: "Default",
    }),
    createToggleProps({
      size: "L",
      active: true,
      state: "Default",
    }),
  ],
  [
    createToggleProps({
      size: "S",
      active: false,
      state: "Default",
    }),
    createToggleProps({
      size: "M",
      active: false,
      state: "Default",
    }),
    createToggleProps({
      size: "L",
      active: false,
      state: "Default",
    }),
  ],
];
