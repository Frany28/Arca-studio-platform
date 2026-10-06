/* Define tamaños, valores por defecto y helpers de CircleProgressBarLabel. */
export const CIRCLE_PROGRESS_BAR_LABEL_SIZES = ["S", "M", "L"];

/**
 * Colores semánticos del arco de progreso. `Accent` conserva la identidad de marca
 * existente; los demás comunican una valoración (p. ej. compatibilidad de solicitudes).
 */
export const CIRCLE_PROGRESS_BAR_LABEL_THEME_COLORS = {
  Accent: "var(--color-accent-300)",
  Success: "var(--color-success-200)",
  Warning: "var(--color-warning-200)",
  Danger: "var(--color-danger-100)",
};

export const CIRCLE_PROGRESS_BAR_LABEL_DEFAULT_PROPS = {
  title: "Título",
  description: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  value: 20,
  max: 100,
  size: "S",
  theme: "Accent",
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
