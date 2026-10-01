import PHONE_COUNTRY_OPTIONS from "./phoneCountryOptions.js";

export const INPUT_DEFAULT_PROPS = {
  // field incluye label, hint y variantes; control conserva una composición especializada.
  presentation: "field",
  label: "Label",
  hintText: "Texto de ayuda para los usuarios",
  placeholder: "Texto de prueba",
  size: "S",
  state: "Default",
  type: "Default input",
  showLabel: true,
  showHint: true,
  showLeftIcon: true,
  showRightIcon: true,
  showLabelInfo: true,
  required: true,
};

export const INPUT_SIZE_STYLES = {
  S: {
    field: "min-h-9 pl-[12px] pr-[8px] py-[8px]",
    shell: "min-h-9",
    phonePrefix: "min-h-9 px-[12px] py-[8px]",
    paymentBadge: "h-5 w-[28.75px] text-[10px]",
    tagSize: "S",
  },
  M: {
    field: "min-h-10 px-[12px] py-[8px]",
    shell: "min-h-10",
    phonePrefix: "min-h-10 px-[12px] py-[8px]",
    paymentBadge: "h-6 w-[34.5px] text-[10px]",
    tagSize: "S",
  },
  L: {
    field: "min-h-11 px-[12px] py-[12px]",
    shell: "min-h-11",
    phonePrefix: "min-h-11 px-[12px] py-[12px]",
    paymentBadge: "h-6 w-[34.5px] text-[10px]",
    tagSize: "S",
  },
};

export const INPUT_STATE_STYLES = {
  Default: {
    shell:
      "border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-none",
    contentBorder: "border border-transparent",
    labelState: "Default",
    inputText: "text-[var(--color-text-100)]",
    placeholder: "placeholder:text-[var(--color-text-100)]",
    leadingIcon: "text-[var(--color-neutral-400)]",
    trailingIcon: "text-[var(--color-neutral-400)]",
    prefix: "text-[var(--color-text-100)]",
    hintState: "Default",
  },
  Hover: {
    shell:
      "border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[0px_2px_4px_0px_rgba(27,28,29,0.04)]",
    contentBorder: "border border-transparent bg-[var(--color-neutral-100)]",
    labelState: "Hover",
    inputText: "text-[var(--color-text-200)]",
    placeholder: "placeholder:text-[var(--color-text-200)]",
    leadingIcon: "text-[var(--color-text-200)]",
    trailingIcon: "text-[var(--color-text-200)]",
    prefix: "text-[var(--color-text-200)]",
    hintState: "Default",
  },
  Focused: {
    shell:
      "border-2 border-[var(--color-primary-10)] bg-[var(--color-neutral-100)] shadow-[0px_2px_4px_0px_rgba(27,28,29,0.04)]",
    contentBorder:
      "border border-[var(--color-primary-300)] bg-[var(--color-neutral-100)]",
    labelState: "Focused",
    inputText: "text-[var(--color-text-200)]",
    placeholder: "placeholder:text-[var(--color-text-200)]",
    leadingIcon: "text-[var(--color-text-200)]",
    trailingIcon: "text-[var(--color-text-200)]",
    prefix: "text-[var(--color-text-200)]",
    hintState: "Default",
  },
  Filled: {
    shell:
      "border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-none",
    contentBorder: "border border-transparent",
    labelState: "Default",
    inputText: "text-[var(--color-text-300)]",
    placeholder: "placeholder:text-[var(--color-text-100)]",
    leadingIcon: "text-[var(--color-neutral-400)]",
    trailingIcon: "text-[var(--color-neutral-400)]",
    prefix: "text-[var(--color-text-200)]",
    hintState: "Default",
  },
  Disabled: {
    shell:
      "border border-[var(--color-neutral-300)] bg-[var(--color-neutral-200)] shadow-none",
    contentBorder: "border border-transparent",
    labelState: "Disabled",
    inputText: "text-[var(--color-neutral-400)]",
    placeholder: "placeholder:text-[var(--color-neutral-400)]",
    leadingIcon: "text-[var(--color-neutral-400)]",
    trailingIcon: "text-[var(--color-neutral-400)]",
    prefix: "text-[var(--color-neutral-400)]",
    hintState: "Disabled",
  },
  Error: {
    shell:
      "bg-[var(--color-neutral-100)] shadow-[0px_2px_4px_0px_rgba(27,28,29,0.04)]",
    contentBorder: "border border-[var(--color-danger-100)]",
    labelState: "Default",
    inputText: "text-[var(--color-text-200)]",
    placeholder: "placeholder:text-[var(--color-text-100)]",
    leadingIcon: "text-[var(--color-text-200)]",
    trailingIcon: "text-[var(--color-danger-100)]",
    prefix: "text-[var(--color-text-200)]",
    hintState: "Error",
  },
};

export const INPUT_INTERACTIVE_STYLES =
  "hover:border-[var(--color-neutral-200)] hover:shadow-[0px_2px_4px_0px_rgba(27,28,29,0.04)] focus-within:border-2 focus-within:border-[var(--color-primary-10)] focus-within:shadow-[0px_2px_4px_0px_rgba(27,28,29,0.04)]";

export const INPUT_TYPES = {
  "Default input": {
    inputType: "text",
    placeholder: "Texto de prueba",
  },
  "Phone number": {
    inputType: "tel",
    placeholder: "(444) 1234-5678",
  },
  "Search bar": {
    inputType: "search",
    placeholder: "Buscar...",
  },
  Password: {
    inputType: "password",
    placeholder: "••••••••",
  },
  Tags: {
    inputType: "text",
    placeholder: "Add tags...",
  },
};

export const INPUT_TAG_DEFAULT_ITEMS = [
  { id: "tag-1", label: "Label", avatarText: "A" },
  { id: "tag-2", label: "Label", avatarText: "B" },
  { id: "tag-3", label: "Label", avatarText: "C" },
];

export { PHONE_COUNTRY_OPTIONS };

export const PASSWORD_REQUIREMENT_RULES = [
  {
    id: "uppercase",
    label: "Al menos 1 mayúscula",
    test: (value) => /[A-Z]/.test(value),
  },
  {
    id: "number",
    label: "Al menos 1 número",
    test: (value) => /\d/.test(value),
  },
  {
    id: "special",
    label: "Al menos 1 carácter especial",
    test: (value) => /[^A-Za-z0-9]/.test(value),
  },
  {
    id: "length",
    label: "Al menos 8 caracteres",
    test: (value) => value.length >= 8,
  },
];

export function createInputProps(overrides = {}) {
  return {
    ...INPUT_DEFAULT_PROPS,
    ...overrides,
  };
}

export function createInputShowcaseItem(label, overrides = {}) {
  return {
    label,
    props: createInputProps(overrides),
  };
}
