/* Define tamaños, estados interactivos, valores por defecto y helpers del componente Tag. */
export const TAG_DEFAULT_PROPS = {
  label: "Label",
  size: "M",
  type: "Universal tag",
  avatar: true,
  checkbox: false,
  closeIcon: true,
  count: true,
  dotIndicator: false,
  flag: false,
  countValue: "5",
  countryCode: "IN",
  avatarText: "A",
  avatarSrc: "",
  avatarTheme: "Neutral",
  avatarContent: "Text",
};

export const TAG_SIZE_STYLES = {
  S: {
    container:
      "h-[22px] gap-[var(--spacing-gap-1)] px-[var(--spacing-gap-1)] py-[2px]",
    text: "text-body-4",
    countText: "text-body-5",
    icon: "size-3",
    indicator: "size-4",
    avatar: "size-4",
    checkbox: "size-4 rounded-[4px]",
  },
  M: {
    container:
      "h-[24px] gap-[var(--spacing-gap-1)] p-[var(--spacing-gap-1)]",
    text: "text-body-4",
    countText: "text-body-5",
    icon: "size-3",
    indicator: "size-4",
    avatar: "size-4",
    checkbox: "size-4 rounded-[4px]",
  },
  L: {
    container:
      "h-[29.333px] gap-[var(--spacing-gap-1)] p-[var(--spacing-gap-1)]",
    text: "text-body-3",
    countText: "text-body-5",
    icon: "size-[14px]",
    indicator: "size-4",
    avatar: "h-[21.333px] w-[21.333px]",
    checkbox: "size-5 rounded-[6px]",
  },
};

export const TAG_BASE_STYLES =
  "inline-flex min-w-0 max-w-full items-center rounded-[var(--radius-2)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] text-[var(--color-text-300)] tracking-[-0.5px]";

export const TAG_INTERACTIVE_STYLES = {
  default:
    "transition-[border-color,background-color,box-shadow] duration-150",
  interactive:
    "cursor-pointer hover:border-[var(--color-neutral-300)] hover:bg-[var(--color-neutral-200)] hover:shadow-[0px_2px_4px_0px_rgba(27,28,29,0.04)]",
  selected:
    "border-[var(--color-primary-300)] bg-[var(--color-neutral-200)] shadow-[0px_2px_4px_0px_rgba(27,28,29,0.04)]",
  disabled: "cursor-not-allowed opacity-60",
};

// Combina las propiedades base del tag con sobrescrituras específicas.
export function createTagProps(overrides = {}) {
  return {
    ...TAG_DEFAULT_PROPS,
    ...overrides,
  };
}

// Genera una entrada reutilizable para mostrar variantes del Tag.
export function createTagShowcaseItem(label, overrides = {}) {
  return {
    label,
    props: createTagProps(overrides),
  };
}
