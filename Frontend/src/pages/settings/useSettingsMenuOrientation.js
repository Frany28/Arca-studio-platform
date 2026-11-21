import { useLayoutEffect, useState } from "react";

import { MOBILE_LAYOUT_MEDIA_QUERY } from "../../utils/layoutBreakpoints.js";

/**
 * Ancho mínimo del contenido de `.settings-layout` para el menú lateral: 160 px de menú, 48 px de
 * separación y 388 px de panel (tablet de 768 px con el riel contraído). Debe coincidir con la
 * container query `settings-layout` de SettingsPage.css.
 */
export const SETTINGS_SIDE_MENU_MIN_WIDTH = 596;

/**
 * Orientación inicial antes de medir: horizontal en el rango móvil, vertical en el resto.
 *
 * @returns {"horizontal"|"vertical"} Orientación estimada por el viewport.
 */
function getInitialOrientation() {
  if (typeof window === "undefined" || !window.matchMedia) return "vertical";
  return window.matchMedia(MOBILE_LAYOUT_MEDIA_QUERY).matches ? "horizontal" : "vertical";
}

/**
 * Elige la orientación del menú de Configuración según el espacio real del contenedor, que depende
 * del viewport y del riel lateral (expandido o contraído): vertical junto al panel cuando caben
 * menú y panel (Figma tablet y escritorio), horizontal encima en caso contrario (Figma móvil).
 * Mide en `useLayoutEffect` y con ResizeObserver para cambiar antes del pintado y seguir los
 * cambios del riel; el CSS aplica el mismo umbral con una container query.
 *
 * @param {import("react").RefObject<HTMLElement>} containerRef - `.settings-layout`.
 * @returns {"horizontal"|"vertical"} Orientación del menú.
 */
export default function useSettingsMenuOrientation(containerRef) {
  const [orientation, setOrientation] = useState(getInitialOrientation);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;

    const update = () => {
      const style = window.getComputedStyle(element);
      const contentWidth = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      setOrientation(contentWidth >= SETTINGS_SIDE_MENU_MIN_WIDTH ? "vertical" : "horizontal");
    };

    update();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef]);

  return orientation;
}
