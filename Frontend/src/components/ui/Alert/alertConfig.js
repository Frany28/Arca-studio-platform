/* Define temas, layouts, valores por defecto y helpers del componente Alert. */
export const ALERT_THEMES = [
  "Brand",
  "Warning",
  "Danger",
  "Success",
  "Info",
];

export const ALERT_LAYOUTS = ["Box", "Full width"];

export const ALERT_DEFAULT_PROPS = {
  title: "Título de la alerta",
  description:
    "Lorem ipsum dolor sit amet porta enim integer faucibus tincidunt.",
  theme: "Brand",
  layout: "Box",
  showIcon: true,
  showText: true,
  showActions: true,
  showCloseButton: true,
  visible: undefined,
  defaultVisible: true,
  secondaryActionLabel: "Descartar",
  primaryActionLabel: "Realizar cambios",
  "aria-label": "Alert",
};

// Combina las propiedades base de la alerta con sobrescrituras específicas.
export function createAlertProps(overrides = {}) {
  return {
    ...ALERT_DEFAULT_PROPS,
    ...overrides,
  };
}

// Genera una entrada reutilizable para mostrar variantes de Alert.
export function createAlertShowcaseItem(label, overrides = {}) {
  return {
    label,
    props: createAlertProps(overrides),
  };
}
