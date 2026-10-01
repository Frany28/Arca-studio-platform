/* Define posiciones, valores por defecto y helpers del componente Tooltip. */
export const TOOLTIP_POSITIONS = [
  "Right",
  "Left",
  "Top center",
  "Top right",
  "Top left",
  "Bottom center",
  "Bottom right",
  "Bottom left",
];

export const TOOLTIP_DEFAULT_PROPS = {
  text: "This is a tooltip.",
  subtext:
    "Lorem ipsum dolor sit amet mauris incididunt praesent morbi arcu senectus nisl volutpat massa.",
  showSubtext: false,
  showTip: false,
  tipPosition: "Right",
  open: undefined,
  defaultOpen: false,
  portal: true,
  "aria-label": "Tooltip",
};

// Combina las propiedades base del tooltip con sobrescrituras específicas.
export function createTooltipProps(overrides = {}) {
  return {
    ...TOOLTIP_DEFAULT_PROPS,
    ...overrides,
  };
}

// Genera una entrada reutilizable para mostrar variantes del Tooltip.
export function createTooltipShowcaseItem(label, overrides = {}) {
  return {
    label,
    props: createTooltipProps(overrides),
  };
}
