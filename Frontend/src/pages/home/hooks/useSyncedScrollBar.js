import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Sincroniza una barra personalizada con las m?tricas del contenedor referenciado.
 * Recalcula con ResizeObserver, resize y cambios de contenido; libera los recursos
 * al limpiar el efecto. La acci?n setPosition tambi?n desplaza el contenedor.
 *
 * @param {*} contentKey - Valor cuya variaci?n vuelve a medir el contenido.
 * @returns {{containerRef: Object, length: number, onScroll: Function, position: number, setPosition: Function}} Referencia, proporciones y acciones de sincronizaci?n/desplazamiento.
 */
export default function useSyncedScrollBar(contentKey) {
  const containerRef = useRef(null);
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState(1);

  const syncMetrics = useCallback(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const maxScroll = Math.max(
      container.scrollHeight - container.clientHeight,
      0,
    );
    setLength(
      Math.min(
        container.clientHeight / Math.max(container.scrollHeight, 1),
        1,
      ),
    );
    setPosition(maxScroll > 0 ? container.scrollTop / maxScroll : 0);
  }, []);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(syncMetrics);
    const resizeObserver = new ResizeObserver(syncMetrics);
    resizeObserver.observe(container);
    window.addEventListener("resize", syncMetrics);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncMetrics);
    };
  }, [contentKey, syncMetrics]);

  const changePosition = useCallback((nextPosition) => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const maxScroll = Math.max(
      container.scrollHeight - container.clientHeight,
      0,
    );
    container.scrollTo({ top: maxScroll * nextPosition, behavior: "auto" });
    setPosition(nextPosition);
  }, []);

  return {
    containerRef,
    length,
    onScroll: syncMetrics,
    position,
    setPosition: changePosition,
  };
}
