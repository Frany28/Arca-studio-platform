const DESKTOP_PRESENTATION = Object.freeze({
  iconButtonSize: "S",
  textButtonSize: "S",
  textButtonClassName: undefined,
  tagSize: "S",
  tagClassName: undefined,
});

/**
 * Escala MOBILE del dashboard administrativo (Figma 3727:678728), compartida por
 * operaciones, resumen y proyectos activos para no repetir condiciones por sección.
 * - Botones de icono con padding de 12 px: 44 px (Button M).
 * - Botones de texto con padding de 12 px sin icono: 41 px (Button M con altura automática).
 * - Tags con texto Body/b3 de 14 px: 25 px. Figma dibuja el trazo por dentro del padding de
 *   4 px; el Tag suma su borde, por eso se compensa con 3 px verticales.
 */
const MOBILE_PRESENTATION = Object.freeze({
  iconButtonSize: "M",
  textButtonSize: "M",
  textButtonClassName: "!h-auto",
  tagSize: "L",
  tagClassName: "!h-auto !py-[3px]",
});

/**
 * Devuelve los tamaños de Button y Tag que corresponden al layout actual del dashboard.
 * Tablet y escritorio conservan exactamente los tamaños existentes.
 *
 * @param {boolean} isMobileLayout Resultado de useMobileLayout.
 * @returns {{iconButtonSize: string, textButtonSize: string, textButtonClassName: string|undefined, tagSize: string, tagClassName: string|undefined}}
 *   Props de presentación inmutables.
 */
export function getAdminDashboardPresentation(isMobileLayout) {
  return isMobileLayout ? MOBILE_PRESENTATION : DESKTOP_PRESENTATION;
}
