/* Define valores por defecto y helpers del componente ScrollBar. */
export const SCROLL_BAR_DEFAULT_PROPS = {
  length: 0.75,
  position: 0,
  height: 240,
  width: 240,
  orientation: "vertical",
  interactive: false,
  minThumbSize: 24,
  size: "default",
};

// Grosor del track (zona de arrastre), del thumb visible y del padding transversal por tamaño.
// "thin" dibuja un thumb de 4 px para listados compactos sin reducir la zona de arrastre: el
// track de 12 px no tiene padding transversal, así que todo su ancho recibe el puntero.
export const SCROLL_BAR_SIZES = {
  default: { track: 16, thumb: 8, crossPadding: 4 },
  thin: { track: 12, thumb: 4, crossPadding: 0 },
};

/**
 * Resuelve las medidas de un tamaño del ScrollBar; un valor desconocido usa el tamaño por defecto.
 *
 * @param {"default"|"thin"} [size="default"] - Tamaño solicitado.
 * @returns {{track: number, thumb: number, crossPadding: number}} Grosores en píxeles.
 */
export function getScrollBarSize(size = SCROLL_BAR_DEFAULT_PROPS.size) {
  return SCROLL_BAR_SIZES[size] ?? SCROLL_BAR_SIZES.default;
}

// Combina las propiedades base del scrollbar con sobrescrituras específicas.
export function createScrollBarProps(overrides = {}) {
  return {
    ...SCROLL_BAR_DEFAULT_PROPS,
    ...overrides,
  };
}

// Genera una entrada reutilizable para mostrar variantes del scrollbar.
export function createScrollBarShowcaseItem(label, overrides = {}) {
  return {
    label,
    props: createScrollBarProps(overrides),
  };
}
