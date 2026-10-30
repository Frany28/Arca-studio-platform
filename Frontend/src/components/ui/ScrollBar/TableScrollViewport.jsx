/* Viewport de tabla con altura máxima y los ScrollBar vertical y horizontal del sistema. */
import { useCallback, useEffect } from "react";

import { useHorizontalScrollBar } from "../../../hooks/useHorizontalScrollBar.js";
import { useVerticalScrollBar } from "../../../hooks/useVerticalScrollBar.js";
import ScrollBar from "./ScrollBar.jsx";

/**
 * Envuelve una tabla que muestra un número fijo de filas: el viewport limita la altura y desplaza
 * en ambos ejes (rueda, touchpad, gestos o los ScrollBar). El ScrollBar vertical va sobre las
 * filas, bajo la cabecera fija y en el margen derecho; el horizontal, bajo el viewport, como en
 * `HorizontalScrollViewport`. Las barras nativas se ocultan porque los ScrollBar las sustituyen;
 * sin overflow no se muestra ninguna. La tabla debe fijar su cabecera (`thead` sticky) y aislar
 * el apilamiento de su cuerpo (`tbody` isolate) para que nada de las filas tape la cabecera.
 *
 * @param {Object} props - Contenido, alturas y nombres accesibles.
 * @param {import("react").ReactNode} props.children - Tabla.
 * @param {number} props.headerHeight - Alto de la cabecera fija, en px.
 * @param {number} props.maxHeight - Alto máximo del viewport (cabecera más filas visibles), en px.
 * @param {string} props.verticalLabel - Nombre accesible del ScrollBar vertical.
 * @param {string} props.horizontalLabel - Nombre accesible del ScrollBar horizontal.
 * @param {boolean} [props.disabled=false] - Bloquea el arrastre del ScrollBar vertical.
 * @param {unknown} [props.resetKey] - Al cambiar, vuelve al inicio de la lista (p. ej. una búsqueda).
 * @returns {import("react").ReactElement} Viewport con sus ScrollBar.
 */
function TableScrollViewport({ children, disabled = false, headerHeight, horizontalLabel, maxHeight, resetKey, verticalLabel, ...props }) {
  const horizontal = useHorizontalScrollBar();
  const vertical = useVerticalScrollBar();
  const { viewportRef: horizontalRef, syncScrollState: syncHorizontal } = horizontal;
  const { handlePositionChange: scrollVertically, viewportRef: verticalRef, syncScrollState: syncVertical } = vertical;

  /**
   * Registra el viewport en los dos ScrollBar.
   *
   * @param {HTMLElement|null} node - Viewport con desplazamiento en ambos ejes.
   * @returns {void}
   */
  const viewportRef = useCallback((node) => {
    horizontalRef(node);
    verticalRef(node);
  }, [horizontalRef, verticalRef]);

  useEffect(() => {
    scrollVertically(0);
  }, [resetKey, scrollVertically]);

  return (
    <>
      <div className="relative">
        <div
          ref={viewportRef}
          className="w-full overflow-auto overscroll-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          style={{ maxHeight }}
          onScroll={() => {
            syncHorizontal();
            syncVertical();
          }}
          {...props}
        >
          {children}
        </div>
        {vertical.hasOverflow ? (
          <ScrollBar
            height={Math.max(vertical.scrollState.height - headerHeight, 0)}
            length={vertical.scrollState.length}
            position={vertical.scrollState.position}
            interactive={!disabled}
            onPositionChange={vertical.handlePositionChange}
            aria-label={verticalLabel}
            className="absolute right-0 z-[2]"
            style={{ top: headerHeight }}
            trackContainerClassName="bg-transparent"
          />
        ) : null}
      </div>
      {horizontal.hasOverflow ? (
        <ScrollBar
          orientation="horizontal"
          width={horizontal.scrollState.width}
          length={horizontal.scrollState.length}
          position={horizontal.scrollState.position}
          interactive
          onPositionChange={horizontal.handlePositionChange}
          aria-label={horizontalLabel}
          className="block max-w-full"
        />
      ) : null}
    </>
  );
}

export default TableScrollViewport;
