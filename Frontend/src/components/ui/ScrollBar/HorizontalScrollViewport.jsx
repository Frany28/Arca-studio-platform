/* Contenedor con desplazamiento horizontal y el ScrollBar compartido, como la tabla de Proyectos. */
import { useHorizontalScrollBar } from "../../../hooks/useHorizontalScrollBar.js";
import ScrollBar from "./ScrollBar.jsx";

/**
 * Envuelve una tabla ancha con el patrón de la tabla de Proyectos: el viewport desplaza en
 * horizontal (rueda, touchpad y gestos táctiles) y bajo él, en el flujo y dentro del contenedor
 * de la tabla, el ScrollBar interactivo indica y controla la posición. La barra nativa se oculta
 * solo porque ScrollBar la sustituye (evita dos barras); sin overflow no se muestra ninguna. El
 * footer, la selección y la paginación quedan fuera de este componente.
 *
 * @param {Object} props - Contenido y nombre accesible del control.
 * @param {import("react").ReactNode} props.children - Tabla con su ancho mínimo.
 * @param {string} props.scrollBarLabel - Nombre accesible del ScrollBar.
 * @returns {import("react").ReactElement} Viewport y ScrollBar.
 */
function HorizontalScrollViewport({ children, scrollBarLabel }) {
  const { viewportRef, scrollState, hasOverflow, syncScrollState, handlePositionChange } = useHorizontalScrollBar();

  return (
    <>
      <div
        ref={viewportRef}
        className="w-full overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        data-horizontal-scroll-viewport
        onScroll={syncScrollState}
      >
        {children}
      </div>
      {hasOverflow ? (
        <ScrollBar
          orientation="horizontal"
          width={scrollState.width}
          length={scrollState.length}
          position={scrollState.position}
          interactive
          onPositionChange={handlePositionChange}
          aria-label={scrollBarLabel}
          className="block max-w-full"
        />
      ) : null}
    </>
  );
}

export default HorizontalScrollViewport;
