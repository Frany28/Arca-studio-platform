/* Define estados visuales, valores por defecto y helpers del componente Accordion. */
export const ACCORDION_STATES = ["Default", "Hover", "Open"];

export const ACCORDION_DEFAULT_PROPS = {
  title: "Los títulos del acordeón van aquí",
  description:
    "La descripción del acordeón va aquí, se debe intentar mantenerla en menos de 2 líneas.",
  state: "Default",
  interactive: false,
  showRightIcon: true,
  defaultOpen: false,
};

export const ACCORDION_STATE_STYLES = {
  Default: {
    container:
      "border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)]",
    alignment: "items-center",
  },
  Hover: {
    container:
      "bg-[var(--color-primary-10)] dark:border dark:border-transparent dark:bg-[var(--color-primary-100)]",
    alignment: "items-center",
  },
  Open: {
    container:
      "border border-transparent bg-[var(--color-primary-10)] dark:bg-[var(--color-primary-100)]",
    alignment: "items-start",
  },
};

// Combina las propiedades base del acordeón con sobrescrituras específicas.
export function createAccordionProps(overrides = {}) {
  return {
    ...ACCORDION_DEFAULT_PROPS,
    ...overrides,
  };
}

// Genera una entrada reutilizable para mostrar variantes del acordeón.
export function createAccordionShowcaseItem(label, overrides = {}) {
  return {
    label,
    props: createAccordionProps(overrides),
  };
}
