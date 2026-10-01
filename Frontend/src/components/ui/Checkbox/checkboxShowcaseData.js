/* Contiene ejemplos de tamaños, estados y referencias visuales del Checkbox. */
import {
  createCheckboxProps,
  createCheckboxShowcaseItem,
} from "./checkboxConfig.js";

export const checkboxMainComponent = createCheckboxProps();

export const checkboxSizeItems = [
  createCheckboxShowcaseItem("S", {
    size: "S",
  }),
  createCheckboxShowcaseItem("M", {
    size: "M",
  }),
];

export const checkboxCheckedItems = [
  createCheckboxShowcaseItem("Yes", {
    checked: "Yes",
  }),
  createCheckboxShowcaseItem("Indeterminate", {
    checked: "Indeterminate",
  }),
  createCheckboxShowcaseItem("No", {
    checked: "No",
  }),
];

export const checkboxStateItems = [
  createCheckboxShowcaseItem("Default", {
    checked: "Yes",
    state: "Default",
  }),
  createCheckboxShowcaseItem("Hover", {
    checked: "Yes",
    state: "Hover",
  }),
  createCheckboxShowcaseItem("Focused", {
    checked: "Yes",
    state: "Focused",
  }),
  createCheckboxShowcaseItem("Disabled", {
    checked: "Yes",
    state: "Disabled",
  }),
];

export const checkboxReferenceRows = [
  [
    createCheckboxProps({
      size: "S",
      checked: "No",
      state: "Default",
    }),
    createCheckboxProps({
      size: "S",
      checked: "Yes",
      state: "Default",
    }),
  ],
  [
    createCheckboxProps({
      size: "S",
      checked: "Indeterminate",
      state: "Default",
    }),
    createCheckboxProps({
      size: "S",
      checked: "No",
      state: "Hover",
    }),
  ],
  [
    createCheckboxProps({
      size: "S",
      checked: "Yes",
      state: "Hover",
    }),
    createCheckboxProps({
      size: "S",
      checked: "Indeterminate",
      state: "Hover",
    }),
  ],
  [
    createCheckboxProps({
      size: "S",
      checked: "No",
      state: "Focused",
    }),
    createCheckboxProps({
      size: "S",
      checked: "Yes",
      state: "Focused",
    }),
  ],
  [
    createCheckboxProps({
      size: "S",
      checked: "Indeterminate",
      state: "Focused",
    }),
    createCheckboxProps({
      size: "S",
      checked: "No",
      state: "Disabled",
    }),
  ],
  [
    createCheckboxProps({
      size: "S",
      checked: "Yes",
      state: "Disabled",
    }),
    createCheckboxProps({
      size: "S",
      checked: "Indeterminate",
      state: "Disabled",
    }),
  ],
  [
    createCheckboxProps({
      size: "M",
      checked: "No",
      state: "Default",
    }),
    createCheckboxProps({
      size: "M",
      checked: "Yes",
      state: "Default",
    }),
  ],
  [
    createCheckboxProps({
      size: "M",
      checked: "Indeterminate",
      state: "Default",
    }),
    createCheckboxProps({
      size: "M",
      checked: "No",
      state: "Hover",
    }),
  ],
  [
    createCheckboxProps({
      size: "M",
      checked: "Yes",
      state: "Hover",
    }),
    createCheckboxProps({
      size: "M",
      checked: "Indeterminate",
      state: "Hover",
    }),
  ],
  [
    createCheckboxProps({
      size: "M",
      checked: "No",
      state: "Focused",
    }),
    createCheckboxProps({
      size: "M",
      checked: "Yes",
      state: "Focused",
    }),
  ],
  [
    createCheckboxProps({
      size: "M",
      checked: "Indeterminate",
      state: "Focused",
    }),
    createCheckboxProps({
      size: "M",
      checked: "No",
      state: "Disabled",
    }),
  ],
  [
    createCheckboxProps({
      size: "M",
      checked: "Yes",
      state: "Disabled",
    }),
    createCheckboxProps({
      size: "M",
      checked: "Indeterminate",
      state: "Disabled",
    }),
  ],
];
