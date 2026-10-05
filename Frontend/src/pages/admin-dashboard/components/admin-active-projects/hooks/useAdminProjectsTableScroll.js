import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Sincroniza el scroll horizontal y el desplazamiento del footer tras ir a la página anterior.
 * Conserva refs estables, tolerancia de medición y dependencias que representan los nodos
 * disponibles. El consumidor marca la intención de anterior antes de cambiar la página;
 * el RAF espera al nuevo layout y se cancela al desmontar o cambiar las dependencias.
 * @param {Object} options Estado que determina el montaje y contenido de la tabla.
 * @param {string} options.error Error de carga, que sustituye el nodo de tabla.
 * @param {boolean} options.loading Carga que sustituye el nodo de tabla.
 * @param {number} options.visibleProjectCount Número de filas de la página actual.
 * @param {number} options.pageIndex Índice efectivo calculado por la paginación.
 * @returns {{tableViewportRef: Object, tableFooterRef: Object,
 * scrollToTableEndAfterPreviousRef: Object, tableScrollState: Object,
 * syncTableScrollState: Function, handleTableScrollPositionChange: Function}} Refs y controles de scroll.
 */
export function useAdminProjectsTableScroll({ error, loading, visibleProjectCount, pageIndex }) {
  const tableViewportRef = useRef(null);
  const tableFooterRef = useRef(null);
  const scrollToTableEndAfterPreviousRef = useRef(false);
  const [tableScrollState, setTableScrollState] = useState({
    length: 1,
    position: 0,
    width: 0,
  });

  /**
   * Mide el nodo vigente y evita renders por diferencias inferiores a la tolerancia existente.
   * Un nodo ausente conserva la última medición hasta que vuelve a estar disponible.
   * @returns {void}
   */
  const syncTableScrollState = useCallback(() => {
    const viewport = tableViewportRef.current;

    if (!viewport) {
      return;
    }

    const maxScroll = Math.max(viewport.scrollWidth - viewport.clientWidth, 0);
    const nextState = {
      length: viewport.scrollWidth
        ? Math.min(viewport.clientWidth / viewport.scrollWidth, 1)
        : 1,
      position: maxScroll ? viewport.scrollLeft / maxScroll : 0,
      width: viewport.clientWidth,
    };

    setTableScrollState((current) =>
      Math.abs(current.length - nextState.length) < 0.001 &&
      Math.abs(current.position - nextState.position) < 0.001 &&
      current.width === nextState.width
        ? current
        : nextState,
    );
  }, []);

  // Reemplazar la tabla por loading/error requiere liberar y volver a observar el nodo.
  // El fallback usa el mismo callback estable para retirar exactamente su listener.
  useEffect(() => {
    const viewport = tableViewportRef.current;

    if (!viewport) {
      return undefined;
    }

    syncTableScrollState();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncTableScrollState);
      return () => window.removeEventListener("resize", syncTableScrollState);
    }

    const resizeObserver = new ResizeObserver(syncTableScrollState);
    resizeObserver.observe(viewport);

    return () => resizeObserver.disconnect();
  }, [error, loading, syncTableScrollState, visibleProjectCount]);

  // Consumir la intención una sola vez conserva el comportamiento de anterior, sin
  // desplazar el footer en siguiente ni en cambios de filtro. Cleanup cancela RAF antiguos.
  useEffect(() => {
    if (!scrollToTableEndAfterPreviousRef.current) {
      return undefined;
    }

    scrollToTableEndAfterPreviousRef.current = false;
    const animationFrame = window.requestAnimationFrame(() => {
      const prefersReducedMotion = window.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      tableFooterRef.current?.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "end",
      });
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [pageIndex, visibleProjectCount]);

  /**
   * Aplica la posición del control compartido al rango real del viewport y vuelve a medir.
   * @param {number} position Posición normalizada suministrada por ScrollBar.
   * @returns {void}
   */
  const handleTableScrollPositionChange = useCallback(
    (position) => {
      const viewport = tableViewportRef.current;

      if (!viewport) {
        return;
      }

      const maxScroll = Math.max(viewport.scrollWidth - viewport.clientWidth, 0);
      viewport.scrollLeft = maxScroll * position;
      syncTableScrollState();
    },
    [syncTableScrollState],
  );

  return {
    tableViewportRef, tableFooterRef, scrollToTableEndAfterPreviousRef,
    tableScrollState, syncTableScrollState, handleTableScrollPositionChange,
  };
}
