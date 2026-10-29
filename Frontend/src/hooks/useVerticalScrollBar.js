import { useCallback, useEffect, useRef, useState } from "react";

const INITIAL_SCROLL_STATE = Object.freeze({ height: 0, length: 1, position: 0 });
// Tolerancia de medición: diferencias menores no provocan renders durante el desplazamiento.
const MEASURE_TOLERANCE = 0.001;

/**
 * Sincroniza un contenedor con desplazamiento vertical y el ScrollBar compartido, como
 * useHorizontalScrollBar en horizontal: longitud del thumb (alto visible / alto total), posición
 * normalizada y alto del contenedor. La ref es un callback, de modo que el nodo nuevo se observa al
 * reemplazar el contenido. ResizeObserver vigila el contenedor y su contenido (filtrar filas cambia
 * el alto total sin cambiar el contenedor). Sin ResizeObserver se usa `resize`.
 *
 * @returns {{viewportRef: (node: HTMLElement|null) => void, scrollState: {height: number,
 * length: number, position: number}, hasOverflow: boolean, syncScrollState: () => void,
 * handlePositionChange: (position: number) => void}} Ref del contenedor, estado y controles.
 */
export function useVerticalScrollBar() {
  const viewportNodeRef = useRef(null);
  const [viewport, setViewport] = useState(null);
  const [scrollState, setScrollState] = useState(INITIAL_SCROLL_STATE);

  /**
   * Registra el contenedor montado; null al desmontarlo.
   *
   * @param {HTMLElement|null} node - Contenedor con overflow vertical.
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
    const maxScroll = Math.max(node.scrollHeight - node.clientHeight, 0);
    const next = {
      height: node.clientHeight,
      length: node.scrollHeight ? Math.min(node.clientHeight / node.scrollHeight, 1) : 1,
      position: maxScroll ? node.scrollTop / maxScroll : 0,
    };
    setScrollState((current) => (
      Math.abs(current.length - next.length) < MEASURE_TOLERANCE
      && Math.abs(current.position - next.position) < MEASURE_TOLERANCE
      && current.height === next.height
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
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
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
    node.scrollTop = Math.max(node.scrollHeight - node.clientHeight, 0) * position;
    syncScrollState();
  }, [syncScrollState]);

  return {
    viewportRef,
    scrollState,
    hasOverflow: scrollState.length < 0.999 && scrollState.height > 0,
    syncScrollState,
    handlePositionChange,
  };
}
