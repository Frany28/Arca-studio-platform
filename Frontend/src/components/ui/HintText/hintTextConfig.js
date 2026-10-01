/* Define estados, estilos y requisitos por defecto del componente HintText. */
export const HINT_TEXT_DEFAULT_PROPS = {
  type: "Hint",
  state: "Default",
  hintText: "Texto de ayuda para los usuarios",
  hintIcon: true,
};

export const HINT_TEXT_STATE_STYLES = {
  Default: {
    text: "text-[var(--color-text-100)]",
    icon: "text-[var(--color-neutral-400)]",
  },
  Error: {
    text: "text-[var(--color-danger-100)]",
    icon: "text-[var(--color-danger-100)]",
  },
  Success: {
    text: "text-[var(--color-success-200)]",
    icon: "text-[var(--color-success-200)]",
  },
  Warning: {
    text: "text-[var(--color-text-100)]",
    icon: "text-[var(--color-neutral-400)]",
  },
  Disabled: {
    text: "text-[var(--color-neutral-300)]",
    icon: "text-[var(--color-neutral-300)]",
  },
};

export const PASSWORD_SEGMENT_STYLES = {
  idle: "bg-[var(--color-neutral-200)]",
  error: "bg-[var(--color-danger-100)]",
  warning: "bg-[var(--color-warning-100)]",
  success: "bg-[var(--color-success-200)]",
};

export const PASSWORD_DEFAULT_REQUIREMENTS = [
  { label: "Al menos 1 mayúscula", met: false },
  { label: "Al menos 1 número", met: false },
  { label: "Al menos 1 carácter especial", met: false },
  { label: "Al menos 8 caracteres", met: false },
];

// Combina las propiedades base del mensaje con sobrescrituras específicas.
export function createHintTextProps(overrides = {}) {
  return {
    ...HINT_TEXT_DEFAULT_PROPS,
    ...overrides,
  };
}

// Genera una entrada reutilizable para mostrar variantes de HintText.
export function createHintTextShowcaseItem(label, overrides = {}) {
  return {
    label,
    props: createHintTextProps(overrides),
  };
}
