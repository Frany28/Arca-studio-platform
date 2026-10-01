/* Agrupa ejemplos de tamaños, estados y estilos del TabItem para el sistema de diseño. */
import {
  createTabItemProps,
  createTabItemShowcaseItem,
} from "./tabItemConfig.js";

export const tabItemMainComponent = createTabItemProps({
  selected: true,
});

export const tabItemSizeItems = [
  createTabItemShowcaseItem("S", {
    size: "S",
    selected: true,
  }),
  createTabItemShowcaseItem("M", {
    size: "M",
    selected: true,
  }),
];

export const tabItemStateItems = [
  createTabItemShowcaseItem("Default", {
    size: "S",
    state: "Default",
  }),
  createTabItemShowcaseItem("Hover", {
    size: "S",
    state: "Hover",
  }),
  createTabItemShowcaseItem("Selected", {
    size: "S",
    state: "Selected",
  }),
];

export const tabItemExampleItem = createTabItemProps({
  interactive: true,
});

export const tabItemUnderlineMainComponent = createTabItemProps({
  style: "Underline",
  selected: true,
});

export const tabItemUnderlineSizeItems = [
  createTabItemShowcaseItem("S", {
    style: "Underline",
    size: "S",
    selected: true,
  }),
  createTabItemShowcaseItem("M", {
    style: "Underline",
    size: "M",
    selected: true,
  }),
];

export const tabItemUnderlineStateItems = [
  createTabItemShowcaseItem("Default", {
    style: "Underline",
    size: "S",
    state: "Default",
  }),
  createTabItemShowcaseItem("Hover", {
    style: "Underline",
    size: "S",
    state: "Hover",
  }),
  createTabItemShowcaseItem("Selected", {
    style: "Underline",
    size: "S",
    state: "Selected",
  }),
];

export const tabItemUnderlineExampleItem = createTabItemProps({
  style: "Underline",
  interactive: true,
});

export const tabItemDividerMainComponent = createTabItemProps({
  style: "Divider",
  selected: true,
});

export const tabItemDividerSizeItems = [
  createTabItemShowcaseItem("S", {
    style: "Divider",
    size: "S",
    selected: true,
  }),
  createTabItemShowcaseItem("M", {
    style: "Divider",
    size: "M",
    selected: true,
  }),
];

export const tabItemDividerStateItems = [
  createTabItemShowcaseItem("Default", {
    style: "Divider",
    size: "S",
    state: "Default",
  }),
  createTabItemShowcaseItem("Hover", {
    style: "Divider",
    size: "S",
    state: "Hover",
  }),
  createTabItemShowcaseItem("Selected", {
    style: "Divider",
    size: "S",
    state: "Selected",
  }),
];

export const tabItemDividerExampleItem = createTabItemProps({
  style: "Divider",
  interactive: true,
});
