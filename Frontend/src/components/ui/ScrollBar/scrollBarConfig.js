/* Define valores por defecto y helpers del componente ScrollBar. */
export const SCROLL_BAR_DEFAULT_PROPS = {
  length: 0.75,
  position: 0,
  height: 240,
  width: 240,
  orientation: "vertical",
  interactive: false,
  minThumbSize: 24,
};

// Combina las propiedades base del scrollbar con sobrescrituras específicas.
export function createScrollBarProps(overrides = {}) {
  return {
    ...SCROLL_BAR_DEFAULT_PROPS,
    ...overrides,
  };
}

// Genera una entrada reutilizable para mostrar variantes del scrollbar.
export function createScrollBarShowcaseItem(label, overrides = {}) {
  return {
    label,
    props: createScrollBarProps(overrides),
  };
}
