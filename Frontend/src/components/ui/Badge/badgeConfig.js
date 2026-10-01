/* Define temas, tamaños, variantes y helpers reutilizables del componente Badge. */
export const BADGE_DEFAULT_PROPS = {
  label: "Label",
  theme: "Brand 1",
  type: "Fill",
  variation: "Simple",
  size: "S",
  iconLeft: false,
  iconRight: false,
  element: null,
  countryCode: "IN",
};

export const BADGE_THEME_STYLES = {
  "Brand 1": {
    container:
      "border-[var(--color-primary-300)] bg-[var(--color-primary-300)] text-[var(--color-neutral-100-uniform)]",
    content: "text-[var(--color-neutral-100-uniform)]",
    dot: "bg-[var(--color-neutral-100-uniform)]",
  },
  "Brand 2": {
    container:
      "border-[var(--color-primary-10)] bg-[var(--color-primary-10)] text-[var(--color-text-300)]",
    content: "text-[var(--color-text-300)]",
    dot: "bg-[var(--color-text-300)]",
  },
  Neutral: {
    container:
      "border-[var(--color-primary-100)] bg-[var(--color-neutral-100)] text-[var(--color-text-300)]",
    content: "text-[var(--color-text-300)]",
    dot: "bg-[var(--color-text-300)]",
  },
  Danger: {
    container:
      "border-[var(--color-danger-10)] bg-[var(--color-danger-10)] text-[var(--color-danger-100)]",
    content: "text-[var(--color-danger-100)]",
    dot: "bg-[var(--color-danger-100)]",
  },
  Success: {
    container:
      "border-[var(--color-success-10)] bg-[var(--color-success-10)] text-[var(--color-success-200)]",
    content: "text-[var(--color-success-200)]",
    dot: "bg-[var(--color-success-200)]",
  },
  Info: {
    container:
      "border-[var(--color-info-10)] bg-[var(--color-info-10)] text-[var(--color-info-100)]",
    content: "text-[var(--color-info-100)]",
    dot: "bg-[var(--color-info-100)]",
  },
  Archived: {
    container:
      "border-[var(--color-warning-10)] bg-[var(--color-warning-10)] text-[var(--color-warning-200)]",
    content: "text-[var(--color-warning-200)]",
    dot: "bg-[var(--color-warning-200)]",
  },
  Disabled: {
    container:
      "border-[var(--color-neutral-200)] bg-[var(--color-neutral-200)] text-[var(--color-neutral-400)]",
    content: "text-[var(--color-neutral-400)]",
    dot: "bg-[var(--color-neutral-400)]",
  },
};

export const BADGE_SIZE_STYLES = {
  S: {
    text: "text-body-4",
    simple:
      "h-[20px] gap-[var(--spacing-gap-1)] px-[var(--spacing-gap-2)] py-[2px]",
    dot: "h-[20px] gap-[var(--spacing-gap-1)] px-[var(--spacing-gap-2)] py-[2px]",
    flagAvatar:
      "h-[20px] gap-[var(--spacing-gap-1)] pl-[var(--spacing-gap-1)] pr-[var(--spacing-gap-2)] py-[2px]",
    element: "size-4",
    icon: "size-4",
    dotSize: "size-2",
  },
  M: {
    text: "text-body-3",
    simple:
      "gap-[var(--spacing-gap-1)] px-[var(--spacing-gap-2)] py-[2px]",
    dot: "gap-[var(--spacing-gap-1)] px-[var(--spacing-gap-2)] py-[2px]",
    flagAvatar:
      "gap-[var(--spacing-gap-1)] pl-[var(--spacing-gap-1)] pr-[var(--spacing-gap-2)] py-[2px]",
    element: "size-4",
    icon: "size-4",
    dotSize: "size-2",
  },
  L: {
    text: "text-body-3",
    simple:
      "gap-[var(--spacing-gap-1)] px-[var(--spacing-gap-2)] py-[var(--spacing-gap-1)]",
    dot: "gap-[var(--spacing-gap-1)] px-[var(--spacing-gap-3)] py-[var(--spacing-gap-1)]",
    flagAvatar:
      "gap-[var(--spacing-gap-1)] pl-[var(--spacing-gap-1)] pr-[var(--spacing-gap-3)] py-[var(--spacing-gap-1)]",
    element: "size-4",
    icon: "size-4",
    dotSize: "size-2",
  },
};

export const BADGE_VARIATION_CLASSNAMES = {
  Simple: "justify-center",
  Dot: "justify-center",
  "Flag / Avatar": "justify-center",
};

// Combina las propiedades base del badge con sobrescrituras específicas.
export function createBadgeProps(overrides = {}) {
  return {
    ...BADGE_DEFAULT_PROPS,
    ...overrides,
  };
}

// Genera una entrada reutilizable para mostrar variantes del badge.
export function createBadgeShowcaseItem(label, overrides = {}) {
  return {
    label,
    props: createBadgeProps(overrides),
  };
}
