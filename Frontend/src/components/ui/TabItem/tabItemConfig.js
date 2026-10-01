/* Define tamaños, estados, valores por defecto y helpers del componente TabItem. */
export const TAB_ITEM_SIZES = ["S", "M"];
export const TAB_ITEM_STATES = ["Default", "Hover", "Selected"];

export const TAB_ITEM_DEFAULT_PROPS = {
  label: "item 1",
  size: "S",
  style: "Brand",
  state: undefined,
  selected: undefined,
  defaultSelected: false,
  persistSelection: true,
  interactive: false,
  iconLeft: true,
  iconRight: false,
  "aria-label": "Tab item",
};

export const TAB_ITEM_SIZE_STYLES = {
  S: {
    Brand: "h-[36px]",
    Underline: "h-[32px]",
    icon: "size-5",
  },
  M: {
    Brand: "h-[44px]",
    Underline: "h-[36px]",
    Divider: "h-[44px]",
    icon: "size-5",
  },
};

// Combina las propiedades base del tab con sobrescrituras específicas.
export function createTabItemProps(overrides = {}) {
  return {
    ...TAB_ITEM_DEFAULT_PROPS,
    ...overrides,
  };
}

// Genera una entrada reutilizable para mostrar variantes de TabItem.
export function createTabItemShowcaseItem(label, overrides = {}) {
  return {
    label,
    props: createTabItemProps(overrides),
  };
}
