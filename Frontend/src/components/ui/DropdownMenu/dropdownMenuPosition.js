// Margen respecto a los bordes de la ventana para el menú en portal.
const PORTAL_VIEWPORT_MARGIN = 8;

/**
 * Posición del menú en portal, en coordenadas de viewport (`position: fixed`): unido al borde
 * inferior del disparador y con su mismo ancho; si no cabe debajo y sí encima, se une al borde
 * superior, como el selector de prefijo del Input. Un menú fijo no amplía la página, así que sin
 * esta regla una fila cercana al borde inferior lo dejaría fuera de la ventana.
 *
 * @param {DOMRect} rect - Rectángulo del contenedor del disparador.
 * @param {number} menuHeight - Altura del menú ya renderizado (0 si aún no se midió).
 * @param {number} viewportHeight - Alto visible de la ventana.
 * @returns {{left: number, top: number, width: number, placement: "bottom"|"top"}} Posición del menú.
 */
export function getPortalMenuPosition(rect, menuHeight, viewportHeight) {
  const fitsBelow = rect.bottom + menuHeight <= viewportHeight - PORTAL_VIEWPORT_MARGIN;
  const fitsAbove = rect.top - menuHeight >= PORTAL_VIEWPORT_MARGIN;
  const placement = fitsBelow || !fitsAbove ? "bottom" : "top";
  return { left: rect.left, top: placement === "bottom" ? rect.bottom : rect.top - menuHeight, width: rect.width, placement };
}
