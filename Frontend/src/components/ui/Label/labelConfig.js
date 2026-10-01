/* Define estados visuales, valores por defecto y helpers del componente Label. */
export const LABEL_DEFAULT_PROPS = {
  label: "Label",
  state: "Default",
  required: true,
  information: true,
};

export const LABEL_STATE_STYLES = {
  Default: {
    label: "text-[var(--color-text-300)]",
    meta: "text-[var(--color-text-300)]",
    info: "text-[var(--color-neutral-400)]",
  },
  Hover: {
    label: "text-[var(--color-text-200)]",
    meta: "text-[var(--color-text-200)]",
    info: "text-[var(--color-neutral-400)]",
  },
  Focused: {
    label: "text-[var(--color-text-200)]",
    meta: "text-[var(--color-text-200)]",
    info: "text-[var(--color-neutral-400)]",
  },
  Disabled: {
    label: "text-[var(--color-neutral-400)]",
    meta: "text-[var(--color-neutral-400)]",
    info: "text-[var(--color-neutral-400)]",
  },
};

// Combina las propiedades base de la etiqueta con sobrescrituras específicas.
export function createLabelProps(overrides = {}) {
  return {
    ...LABEL_DEFAULT_PROPS,
    ...overrides,
  };
}

// Genera una entrada reutilizable para mostrar variantes de Label.
export function createLabelShowcaseItem(label, overrides = {}) {
  return {
    label,
    props: createLabelProps(overrides),
  };
}
