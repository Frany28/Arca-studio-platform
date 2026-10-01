/* Define tamaños, estados permitidos, valores por defecto y helpers del Toggle. */
export const TOGGLE_SIZES = ["S", "M", "L"];
export const TOGGLE_STATES = ["Default", "Hover", "Focused", "Disabled"];

export const TOGGLE_DEFAULT_PROPS = {
  active: true,
  size: "M",
  state: undefined,
  interactive: false,
  disabled: false,
};

export const TOGGLE_SIZE_STYLES = {
  S: {
    wrapper: "h-5 w-9",
    thumb: "size-[16.364px]",
    padding: "1.636px",
    shadow: "0px 0px 4.091px 0px rgba(0, 0, 0, 0.05)",
  },
  M: {
    wrapper: "h-6 w-11",
    thumb: "size-5",
    padding: "2px",
    shadow: "var(--shadow-e1)",
  },
  L: {
    wrapper: "h-8 w-[54px]",
    thumb: "size-[24.545px]",
    padding: "2.455px",
    shadow: "0px 0px 6.136px 0px rgba(0, 0, 0, 0.05)",
  },
};

// Combina las propiedades base del toggle con sobrescrituras específicas.
export function createToggleProps(overrides = {}) {
  return {
    ...TOGGLE_DEFAULT_PROPS,
    ...overrides,
  };
}

// Genera una entrada reutilizable para mostrar variantes del toggle.
export function createToggleShowcaseItem(label, overrides = {}) {
  return {
    label,
    props: createToggleProps(overrides),
  };
}
