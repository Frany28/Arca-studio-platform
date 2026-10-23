import { useCallback, useEffect, useRef, useState } from "react";

const INITIAL_SCROLL_STATE = Object.freeze({ length: 1, position: 0, width: 0 });
// Tolerancia de medición: diferencias menores no provocan renders durante el desplazamiento.
const MEASURE_TOLERANCE = 0.001;

/**
 * Sincroniza un contenedor con desplazamiento horizontal y el ScrollBar compartido, con el patrón
 * de la tabla de Proyectos: longitud del thumb (ancho visible / ancho total), posición normalizada
 * y ancho de la pista. La ref es un callback: al reemplazar la tabla por carga, vacío o error, el
 * nodo nuevo se observa y el anterior se libera sin listeners duplicados. ResizeObserver vigila el
 * contenedor (cambios de ventana o sidebar); las tablas tienen un ancho mínimo fijo, así que su
 * contenido no cambia el overflow sin cambiar el contenedor. Sin ResizeObserver se usa `resize`.
 *
 * @returns {{viewportRef: (node: HTMLElement|null) => void, scrollState: {length: number,
 * position: number, width: number}, hasOverflow: boolean, syncScrollState: () => void,
 * handlePositionChange: (position: number) => void}} Ref del contenedor, estado y controles.
 */
export function useHorizontalScrollBar() {
  const viewportNodeRef = useRef(null);
  const [viewport, setViewport] = useState(null);
  const [scrollState, setScrollState] = useState(INITIAL_SCROLL_STATE);

  /**
   * Registra el contenedor montado; null al desmontarlo.
   *
   * @param {HTMLElement|null} node - Contenedor con overflow horizontal.
   * @returns {void}
   */
  const viewportRef = useCallback((node) => {
    viewportNodeRef.current = node;
    setViewport(node);
  }, []);

  /**
   * Mide el contenedor vigente y conserva el estado si la diferencia es inferior a la tolerancia.
   *
   * @returns {void}
   */
  const syncScrollState = useCallback(() => {
    const node = viewportNodeRef.current;
    if (!node) return;
    const maxScroll = Math.max(node.scrollWidth - node.clientWidth, 0);
    const next = {
      length: node.scrollWidth ? Math.min(node.clientWidth / node.scrollWidth, 1) : 1,
      position: maxScroll ? node.scrollLeft / maxScroll : 0,
      width: node.clientWidth,
    };
    setScrollState((current) => (
      Math.abs(current.length - next.length) < MEASURE_TOLERANCE
      && Math.abs(current.position - next.position) < MEASURE_TOLERANCE
      && current.width === next.width
        ? current
        : next
    ));
  }, []);

  useEffect(() => {
    if (!viewport) return undefined;
    if (typeof ResizeObserver === "undefined") {
      syncScrollState();
      window.addEventListener("resize", syncScrollState);
      return () => window.removeEventListener("resize", syncScrollState);
    }
    // La primera notificación llega tras el layout: mide sin actualizar estado dentro del efecto.
    const observer = new ResizeObserver(syncScrollState);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [syncScrollState, viewport]);

  /**
   * Aplica la posición elegida en el ScrollBar al rango real del contenedor y vuelve a medir.
   *
   * @param {number} position - Posición normalizada (0–1) suministrada por ScrollBar.
   * @returns {void}
   */
  const handlePositionChange = useCallback((position) => {
    const node = viewportNodeRef.current;
    if (!node) return;
    node.scrollLeft = Math.max(node.scrollWidth - node.clientWidth, 0) * position;
    syncScrollState();
  }, [syncScrollState]);

  return {
    viewportRef,
    scrollState,
    hasOverflow: scrollState.length < 0.999 && scrollState.width > 0,
    syncScrollState,
    handlePositionChange,
  };
}
