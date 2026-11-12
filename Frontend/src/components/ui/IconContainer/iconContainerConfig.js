export const ICON_CONTAINER_DEFAULT_PROPS = {
  size: "S",
  type: "Outline",
};

export const ICON_CONTAINER_SIZE_STYLES = {
  S: {
    container: "size-8 p-[var(--spacing-gap-3)]",
    icon: 16,
  },
  M: {
    container: "size-10 p-[var(--spacing-gap-3)]",
    icon: 20,
  },
  L: {
    container: "size-12 p-[var(--spacing-gap-3)]",
    icon: 24,
  },
  XL: {
    container: "size-14 p-[var(--spacing-gap-3)]",
    icon: 28,
  },
};

export const ICON_CONTAINER_TYPE_STYLES = {
  Outline:
    "border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] text-[var(--color-text-100)] shadow-[var(--shadow-e1)]",
  Fill:
    "border border-transparent bg-[var(--color-primary-300)] text-[var(--color-neutral-100-uniform)] shadow-[var(--shadow-e1)]",
  Ghost: "border border-transparent bg-transparent text-[var(--color-text-100)] shadow-none",
  Success:
    "border border-transparent bg-[var(--color-success-10)] text-[var(--color-success-200)] shadow-[var(--shadow-e1)]",
  Accent:
    "border border-transparent bg-[var(--color-accent-10)] text-[var(--color-accent-300)] shadow-[var(--shadow-e1)]",
  Info:
    "border border-transparent bg-[var(--color-info-10)] text-[var(--color-info-100)] shadow-[var(--shadow-e1)]",
  Warning:
    "border border-transparent bg-[var(--color-warning-10)] text-[var(--color-warning-200)] shadow-[var(--shadow-e1)]",
  Danger:
    "border border-transparent bg-[var(--color-danger-10)] text-[var(--color-danger-100)] shadow-[var(--shadow-e1)]",
  Disabled:
    "border border-transparent bg-[var(--color-neutral-200)] text-[var(--color-neutral-400)] shadow-[var(--shadow-e1)]",
  // Variantes sólidas (fondo de color e icono blanco) de los modales de recomendación del
  // arquitecto (Figma 3727:618383, 3727:618488 y 3727:618593).
  SuccessSolid:
    "border border-transparent bg-[var(--color-success-200)] text-[var(--color-neutral-100-uniform)] shadow-[var(--shadow-e1)]",
  InfoSolid:
    "border border-transparent bg-[var(--color-info-100)] text-[var(--color-neutral-100-uniform)] shadow-[var(--shadow-e1)]",
  DangerSolid:
    "border border-transparent bg-[var(--color-danger-200)] text-[var(--color-neutral-100-uniform)] shadow-[var(--shadow-e1)]",
};

export function createIconContainerProps(overrides = {}) {
  return {
    ...ICON_CONTAINER_DEFAULT_PROPS,
    ...overrides,
  };
}

export function createIconContainerShowcaseItem(label, overrides = {}) {
  return {
    label,
    props: createIconContainerProps(overrides),
  };
}
