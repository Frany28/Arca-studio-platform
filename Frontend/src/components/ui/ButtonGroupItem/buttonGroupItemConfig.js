/* Define estados visuales, estilos compartidos y helpers de ButtonGroupItem y ButtonGroup. */
export const BUTTON_GROUP_ITEM_DEFAULT_PROPS = {
  label: "Text",
  state: "Default",
  showIcon: true,
  showText: true,
  disabled: false,
};

export const BUTTON_GROUP_ITEM_VISUALS = {
  Default: {
    container:
      "border border-[var(--color-primary-100)] bg-[var(--color-primary-300)] text-[var(--color-neutral-100-uniform)]",
    icon: "text-current",
    label: "text-current",
  },
  Hover: {
    container:
      "border border-[var(--color-primary-100)] bg-[var(--color-primary-10)] text-[var(--color-text-200)]",
    icon: "text-current",
    label: "text-current",
  },
  Selected: {
    container:
      "border border-[var(--color-primary-100)] bg-[var(--color-primary-200)] text-[var(--color-neutral-100-uniform)]",
    icon: "text-current",
    label: "text-current",
  },
  Disabled: {
    container:
      "border border-[var(--color-primary-100)] bg-[var(--color-neutral-200)] text-[var(--color-neutral-400)]",
    icon: "text-current",
    label: "text-current",
  },
};

export const BUTTON_GROUP_ITEM_INTERACTIVE_STYLES =
  "hover:border-[var(--color-primary-100)] hover:bg-[var(--color-primary-10)] hover:text-[var(--color-text-200)]";

export const BUTTON_GROUP_INTERACTIVE_STYLES =
  "hover:border-[var(--color-primary-100)] hover:bg-[var(--color-primary-10)] hover:text-[var(--color-text-200)]";

export const BUTTON_GROUP_WRAPPER_STYLES =
  "overflow-hidden rounded-[var(--radius-2)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[0px_2px_4px_0px_rgba(27,28,29,0.04)]";

// Combina las props base de un item con sobrescrituras específicas.
export function createButtonGroupItemProps(overrides = {}) {
  return {
    ...BUTTON_GROUP_ITEM_DEFAULT_PROPS,
    ...overrides,
  };
}

// Genera una entrada reutilizable para mostrar variantes de ButtonGroupItem.
export function createButtonGroupItemShowcaseItem(label, overrides = {}) {
  return {
    label,
    props: createButtonGroupItemProps(overrides),
  };
}

// Construye la configuración base de un grupo de botones.
export function createButtonGroupProps(items, overrides = {}) {
  return {
    items,
    selectedIndex: null,
    ...overrides,
  };
}
