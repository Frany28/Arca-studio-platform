import { useEffect, useRef } from "react";

import { useHorizontalScrollBar } from "../../../../../hooks/useHorizontalScrollBar.js";

/**
 * Sincroniza el scroll horizontal y el desplazamiento del footer tras ir a la página anterior.
 * La medición del viewport y el ScrollBar comparten useHorizontalScrollBar con las demás tablas
 * administrativas; su ref observa el nodo vigente aunque la tabla se sustituya por carga o error.
 * El consumidor marca la intención de anterior antes de cambiar la página; el RAF espera al
 * nuevo layout y se cancela al desmontar o cambiar las dependencias.
 * @param {Object} options Estado que determina el contenido de la tabla.
 * @param {number} options.visibleProjectCount Número de filas de la página actual.
 * @param {number} options.pageIndex Índice efectivo calculado por la paginación.
 * @returns {{tableViewportRef: Function, tableFooterRef: Object,
 * scrollToTableEndAfterPreviousRef: Object, tableScrollState: Object,
 * syncTableScrollState: Function, handleTableScrollPositionChange: Function}} Refs y controles de scroll.
 */
export function useAdminProjectsTableScroll({ visibleProjectCount, pageIndex }) {
  const tableFooterRef = useRef(null);
  const scrollToTableEndAfterPreviousRef = useRef(false);
  const { viewportRef, scrollState, syncScrollState, handlePositionChange } = useHorizontalScrollBar();

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

  return {
    tableViewportRef: viewportRef,
    tableFooterRef,
    scrollToTableEndAfterPreviousRef,
    tableScrollState: scrollState,
    syncTableScrollState: syncScrollState,
    handleTableScrollPositionChange: handlePositionChange,
  };
}
