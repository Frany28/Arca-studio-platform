export const DROPDOWN_MENU_TYPES = [
  "Text",
  "Icon",
  "Checkbox",
  "User profile",
  "Flag",
];

export const DROPDOWN_MENU_STATES = ["Default", "Hover", "Selected"];

export const DROPDOWN_MENU_DEFAULT_ITEMS = [
  { id: "item-1", label: "Label", type: "Checkbox", checked: "Yes" },
  { id: "item-2", label: "Label", type: "Checkbox", checked: "No" },
  { id: "item-3", label: "Label", type: "Checkbox", checked: "No" },
  { id: "item-4", label: "Label", type: "Checkbox", checked: "No" },
];

export const DROPDOWN_MENU_DEFAULT_PROPS = {
  type: "Text",
  label: "Label",
  supportingText: "",
  showDivider: true,
  showContainer: true,
  checked: "No",
  countryCode: "US",
  avatarSrc:
    "https://www.figma.com/api/mcp/asset/51a3a0d7-a97f-48eb-a263-877571497be3",
  state: undefined,
  open: undefined,
  defaultOpen: false,
  interactive: true,
  // Bloquea apertura y selección (p. ej. campos dependientes de otra respuesta del formulario).
  disabled: false,
  // Resume etiquetas largas dentro del espacio disponible sin invadir la flecha.
  truncateTriggerLabel: false,
  preserveMenuSpace: false,
  items: DROPDOWN_MENU_DEFAULT_ITEMS,
  hoveredItemId: undefined,
  selectedItemId: undefined,
  "aria-label": "Dropdown menu",
};

export function createDropdownMenuProps(overrides = {}) {
  return {
    ...DROPDOWN_MENU_DEFAULT_PROPS,
    ...overrides,
  };
}

export function createDropdownMenuShowcaseItem(label, overrides = {}) {
  return {
    label,
    props: createDropdownMenuProps(overrides),
  };
}
