import { useEffect, useState } from "react";

/**
 * Indica si el texto de un elemento está recortado (line-clamp o truncate) y, por tanto, necesita
 * una ayuda para consultarse completo. Se mide con ResizeObserver: su primera notificación llega
 * tras el layout y antes del pintado, y las siguientes acompañan cambios de ancho, de viewport o
 * de carga de fuentes. No actualiza estado de forma síncrona dentro del efecto.
 *
 * @param {import("react").RefObject<HTMLElement>} elementRef - Elemento con el texto limitado.
 * @param {unknown} text - Texto mostrado; un cambio vuelve a medir aunque no cambie el tamaño.
 * @returns {boolean} true si el contenido excede el área visible del elemento.
 */
export function useIsTextClamped(elementRef, text) {
  const [clamped, setClamped] = useState(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    // Un píxel de tolerancia evita falsos positivos por redondeo subpíxel del line-height.
    const observer = new ResizeObserver(() => {
      setClamped(element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [elementRef, text]);

  return clamped;
}
