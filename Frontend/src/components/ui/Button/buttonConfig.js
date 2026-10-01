export const BUTTON_SIZE_STYLES = {
  S: {
    default:
      "h-9 w-[115px] gap-[var(--spacing-spacing-gap-3,8px)] px-[var(--spacing-spacing-gap-3,8px)] py-[var(--spacing-spacing-gap-3,8px)]",
    defaultFitContent:
      "h-9 w-fit gap-[var(--spacing-spacing-gap-3,8px)] px-[var(--spacing-spacing-gap-3,8px)] py-[var(--spacing-spacing-gap-3,8px)] whitespace-nowrap",
    link: "h-9 w-[91px] gap-[4px] px-0 py-0",
    linkFitContent: "h-9 w-fit gap-[4px] px-0 py-0 whitespace-nowrap",
    iconOnly: "size-9 p-[var(--spacing-spacing-gap-3,8px)]",
    focusedWrapper: { width: "115px", height: "36px" },
    text: "text-heading-8",
  },
  M: {
    default: "h-11 w-[123px] gap-[8px] px-[12px] py-[12px]",
    defaultFitContent:
      "h-11 w-fit gap-[8px] px-[12px] py-[12px] whitespace-nowrap",
    link: "h-11 w-[91px] gap-[4px] px-0 py-0",
    linkFitContent: "h-11 w-fit gap-[4px] px-0 py-0 whitespace-nowrap",
    iconOnly: "size-11 p-[12px]",
    focusedWrapper: { width: "123px", height: "44px" },
    text: "text-heading-8",
  },
  L: {
    default: "h-[52px] w-[131px] gap-[8px] px-[16px] py-[16px]",
    defaultFitContent:
      "h-[52px] w-fit gap-[8px] px-[16px] py-[16px] whitespace-nowrap",
    link: "h-[52px] w-[91px] gap-[4px] px-0 py-0",
    linkFitContent: "h-[52px] w-fit gap-[4px] px-0 py-0 whitespace-nowrap",
    iconOnly: "size-[52px] p-[16px]",
    focusedWrapper: { width: "131px", height: "52px" },
    text: "text-heading-8",
  },
};

export const BUTTON_DEFAULT_PROPS = {
  // content conserva el DOM interior y la geometría de cards, marcadores y controles compuestos.
  // standard aplica las variantes visuales del botón de acción convencional.
  layout: "standard",
  theme: "Primary",
  size: "S",
  type: "Solid",
  state: "Default",
  showLeftIcon: true,
  showRightIcon: true,
  showText: true,
  children: "Button",
};

export const BUTTON_VISUALS = {
  Primary: {
    Solid: {
      Default:
        "border border-transparent bg-[var(--color-primary-300)] text-[var(--color-neutral-100-uniform)]",
      Hover:
        "border border-transparent bg-[var(--color-primary-500)] text-[var(--color-neutral-100-uniform)]",
      FocusedInner:
        "border border-[#4e4e4e] bg-[var(--color-primary-300)] text-[var(--color-neutral-100-uniform)]",
      FocusedOuter: "rgba(42, 41, 41, 0.10)",
      Disabled:
        "border border-transparent bg-[var(--color-neutral-200)] text-[var(--color-neutral-400)]",
    },
    Outline: {
      Default:
        "border border-[var(--color-neutral-300)] bg-transparent text-[var(--color-text-200)]",
      Hover:
        "border border-[var(--color-neutral-600)] bg-transparent text-[var(--color-text-200)]",
      FocusedInner:
        "border border-[var(--color-neutral-600)] bg-transparent text-[var(--color-text-200)]",
      FocusedOuter: "var(--color-primary-10)",
      Disabled:
        "border border-[var(--color-neutral-300)] bg-transparent text-[var(--color-neutral-500)]",
    },
    Ghost: {
      Default:
        "border border-transparent bg-transparent text-[var(--color-text-200)]",
      Hover:
        "border border-transparent bg-[var(--color-primary-10)] text-[var(--color-text-200)]",
      FocusedInner:
        "border border-[var(--color-neutral-300)] bg-transparent text-[var(--color-text-200)]",
      FocusedOuter: "var(--color-primary-10)",
      Disabled:
        "border border-transparent bg-transparent text-[var(--color-neutral-500)]",
    },
    Link: {
      Default:
        "border border-transparent bg-transparent text-[var(--color-text-300)] underline decoration-current underline-offset-2",
      Hover:
        "border border-transparent bg-transparent text-[var(--color-text-50)] underline decoration-current underline-offset-2",
      FocusedInner:
        "border border-transparent bg-transparent text-[var(--color-text-300)] underline decoration-current underline-offset-2",
      FocusedOuter: "transparent",
      Disabled:
        "border border-transparent bg-transparent text-[var(--color-neutral-500)] underline decoration-current underline-offset-2",
    },
  },
  Danger: {
    Solid: {
      Default:
        "border border-[var(--color-danger-100)] bg-[var(--color-danger-100)] text-[var(--color-neutral-100-uniform)]",
      Hover:
        "border border-[var(--color-danger-200)] bg-[var(--color-danger-200)] text-[var(--color-neutral-100-uniform)]",
      FocusedInner:
        "border border-[var(--color-danger-200)] bg-[var(--color-danger-100)] text-[var(--color-neutral-100-uniform)]",
      FocusedOuter: "var(--color-danger-10)",
      Disabled:
        "border border-transparent bg-[var(--color-neutral-200)] text-[var(--color-neutral-400)]",
    },
    Outline: {
      Default:
        "border border-[var(--color-danger-100)] bg-[var(--color-neutral-100)] text-[var(--color-danger-100)]",
      Hover:
        "border border-[var(--color-danger-200)] bg-[var(--color-neutral-100)] text-[var(--color-danger-200)]",
      FocusedInner:
        "border border-[var(--color-danger-100)] bg-[var(--color-neutral-100)] text-[var(--color-danger-100)]",
      FocusedOuter: "var(--color-danger-10)",
      Disabled:
        "border border-[var(--color-neutral-300)] bg-[var(--color-neutral-100)] text-[var(--color-neutral-500)]",
    },
  },
  Info: {
    Solid: {
      Default:
        "border border-[var(--color-info-100)] bg-[var(--color-info-100)] text-[var(--color-neutral-100-uniform)]",
      Hover:
        "border border-[var(--color-info-200)] bg-[var(--color-info-200)] text-[var(--color-neutral-100-uniform)]",
      FocusedInner:
        "border border-[var(--color-info-200)] bg-[var(--color-info-100)] text-[var(--color-neutral-100-uniform)]",
      FocusedOuter: "var(--color-info-10)",
      Disabled:
        "border border-transparent bg-[var(--color-neutral-200)] text-[var(--color-neutral-400)]",
    },
    Outline: {
      Default:
        "border border-[var(--color-info-100)] bg-[var(--color-neutral-100)] text-[var(--color-info-100)]",
      Hover:
        "border border-[var(--color-info-200)] bg-[var(--color-neutral-100)] text-[var(--color-info-100)]",
      FocusedInner:
        "border border-[var(--color-info-200)] bg-[var(--color-neutral-100)] text-[var(--color-info-100)]",
      FocusedOuter: "var(--color-info-10)",
      Disabled:
        "border border-[var(--color-neutral-300)] bg-[var(--color-neutral-100)] text-[var(--color-neutral-500)]",
    },
  },
};

export const BUTTON_INTERACTIVE_STYLES = {
  Primary: {
    Solid:
      "hover:border-[var(--color-primary-500)] hover:bg-[var(--color-primary-500)] active:border-[var(--color-primary-500)] active:bg-[var(--color-primary-500)] focus:outline-none focus-visible:border-[#4e4e4e] focus-visible:bg-[var(--color-primary-300)] focus-visible:text-[var(--color-neutral-100-uniform)] focus-visible:shadow-[0_0_0_var(--stroke-2)_var(--color-primary-10)]",
    Outline:
      "hover:border-[var(--color-neutral-600)] hover:bg-transparent hover:text-[var(--color-text-200)] active:border-[var(--color-neutral-600)] active:bg-[var(--color-primary-10)] focus:outline-none focus-visible:border-[var(--color-neutral-600)] focus-visible:bg-transparent focus-visible:text-[var(--color-text-200)] focus-visible:shadow-[0_0_0_var(--stroke-2)_var(--color-primary-10)]",
    Ghost:
      "hover:bg-[var(--color-primary-10)] hover:text-[var(--color-text-200)] active:bg-[var(--color-primary-10)] focus:outline-none focus-visible:border-[var(--color-neutral-300)] focus-visible:bg-transparent focus-visible:text-[var(--color-text-200)] focus-visible:shadow-[0_0_0_var(--stroke-2)_var(--color-primary-10)]",
    Link:
      "hover:text-[var(--color-text-50)] active:text-[var(--color-text-50)] focus:outline-none focus-visible:text-[var(--color-text-300)] focus-visible:shadow-[0_0_0_var(--stroke-2)_var(--color-primary-10)]",
  },
  Danger: {
    Solid:
      "hover:border-[var(--color-danger-200)] hover:bg-[var(--color-danger-200)] active:border-[var(--color-danger-200)] active:bg-[var(--color-danger-200)] focus:outline-none focus-visible:border-[var(--color-danger-100)] focus-visible:bg-[var(--color-danger-100)] focus-visible:text-[var(--color-neutral-100-uniform)] focus-visible:shadow-[0_0_0_var(--stroke-2)_var(--color-danger-10)]",
    Outline:
      "hover:border-[var(--color-danger-200)] hover:bg-[var(--color-neutral-100)] hover:text-[var(--color-danger-200)] active:border-[var(--color-danger-200)] active:text-[var(--color-danger-200)] focus:outline-none focus-visible:border-[var(--color-danger-100)] focus-visible:bg-[var(--color-neutral-100)] focus-visible:text-[var(--color-danger-100)] focus-visible:shadow-[0_0_0_var(--stroke-2)_var(--color-danger-10)]",
  },
  Info: {
    Solid:
      "hover:border-[var(--color-info-200)] hover:bg-[var(--color-info-200)] active:border-[var(--color-info-200)] active:bg-[var(--color-info-200)] focus:outline-none focus-visible:border-[var(--color-info-200)] focus-visible:bg-[var(--color-info-100)] focus-visible:text-[var(--color-neutral-100-uniform)] focus-visible:shadow-[0_0_0_var(--stroke-2)_var(--color-info-10)]",
    Outline:
      "hover:border-[var(--color-info-200)] hover:bg-[var(--color-neutral-100)] hover:text-[var(--color-info-100)] active:border-[var(--color-info-200)] active:text-[var(--color-info-200)] focus:outline-none focus-visible:border-[var(--color-info-200)] focus-visible:bg-[var(--color-neutral-100)] focus-visible:text-[var(--color-info-100)] focus-visible:shadow-[0_0_0_var(--stroke-2)_var(--color-info-10)]",
  },
};

export function createButtonProps(overrides = {}) {
  return {
    ...BUTTON_DEFAULT_PROPS,
    ...overrides,
  };
}

export function createButtonShowcaseItem(label, overrides = {}) {
  return {
    label,
    props: createButtonProps(overrides),
  };
}

export function createButtonStyleSection(title, overrides = {}) {
  return {
    title,
    active: createButtonProps(overrides),
    disabled: createButtonProps({
      ...overrides,
      state: "Disabled",
    }),
  };
}
