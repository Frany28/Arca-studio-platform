/* Define tamaños, valores por defecto y helpers de CircleProgressBarLabel. */
export const CIRCLE_PROGRESS_BAR_LABEL_SIZES = ["S", "M", "L"];

export const CIRCLE_PROGRESS_BAR_LABEL_DEFAULT_PROPS = {
  title: "Título",
  description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  value: 20,
  max: 100,
  size: "S",
  showText: true,
  "aria-label": "Circle progress bar label",
};

// Combina las propiedades base del progreso con sobrescrituras específicas.
export function createCircleProgressBarLabelProps(overrides = {}) {
  return {
    ...CIRCLE_PROGRESS_BAR_LABEL_DEFAULT_PROPS,
    ...overrides,
  };
}

// Genera una entrada reutilizable para mostrar variantes del progreso circular.
export function createCircleProgressBarLabelShowcaseItem(
  label,
  overrides = {},
) {
  return {
    label,
    props: createCircleProgressBarLabelProps(overrides),
  };
}
