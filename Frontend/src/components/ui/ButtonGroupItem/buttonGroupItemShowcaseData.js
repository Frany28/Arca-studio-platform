/* Contiene ejemplos de estados, cantidades y variantes del grupo de botones. */
import {
  createButtonGroupItemProps,
  createButtonGroupProps,
} from "./buttonGroupItemConfig.js";

const buttonGroupBaseItems = [
  createButtonGroupItemProps({ label: "Text", showIcon: false }),
  createButtonGroupItemProps({ label: "Text", showIcon: false }),
  createButtonGroupItemProps({ label: "Text", showIcon: false }),
  createButtonGroupItemProps({ label: "Text", showIcon: false }),
];

export const buttonGroupItemMainComponent = createButtonGroupItemProps();

export const buttonGroupItemStateSection = {
  interactive: createButtonGroupItemProps(),
  disabled: createButtonGroupItemProps({ state: "Disabled" }),
};

export const buttonGroupItemQuickToggleItems = [
  {
    label: "Text",
    props: createButtonGroupItemProps({ showIcon: false }),
  },
  {
    label: "Icon",
    props: createButtonGroupItemProps({
      showText: false,
      "aria-label": "Button group item icon",
    }),
  },
];

export const buttonGroupMainComponent = createButtonGroupProps(buttonGroupBaseItems, {
  defaultSelectedIndex: 2,
});

export const buttonGroupCountItems = [
  {
    label: "2",
    props: createButtonGroupProps(buttonGroupBaseItems.slice(0, 2), {
      defaultSelectedIndex: 0,
    }),
  },
  {
    label: "3",
    props: createButtonGroupProps(buttonGroupBaseItems.slice(0, 3), {
      defaultSelectedIndex: 1,
    }),
  },
  {
    label: "4",
    props: createButtonGroupProps(buttonGroupBaseItems, {
      defaultSelectedIndex: 2,
    }),
  },
];
