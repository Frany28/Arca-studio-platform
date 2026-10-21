import { forwardRef } from "react";
import clsx from "clsx";

import ScrollBar from "../../ScrollBar/ScrollBar.jsx";
import { getInputOptionsViewportHeight } from "./inputOptionsConfig.js";

/**
 * Carcasa compartida de los listados unidos a un selector del Input (prefijo telefónico y
 * prefijo seleccionable): borde `neutral-200` sin borde en el lado unido al campo, radio de
 * 12 px en el lado libre, fondo `neutral-100`, padding de 4/8 px y área de tres filas con el
 * scroll nativo oculto y el ScrollBar del sistema. La posición la decide cada selector.
 *
 * @param {Object} props - Contenido, scroll y presentación.
 * @param {string} props.id - Identificador del listbox.
 * @param {string} props.ariaLabel - Nombre accesible del listbox.
 * @param {number} props.optionCount - Opciones visibles, para la altura del viewport.
 * @param {import("react").Ref} props.viewportRef - Ref del área desplazable (useInputOptionsScroll).
 * @param {{length: number, position: number}} props.metrics - Métricas del ScrollBar.
 * @param {Function} props.onViewportScroll - Actualiza las métricas tras el scroll nativo.
 * @param {Function} props.onScrollPositionChange - Desplaza el área desde el ScrollBar.
 * @param {string} props.scrollbarLabel - Nombre accesible del ScrollBar.
 * @param {boolean} props.disabled - Bloquea el ScrollBar.
 * @param {"bottom"|"top"} [props.placement="bottom"] - Lado del campo al que se une el panel.
 * @param {number} [props.maxViewportHeight] - Límite del área de opciones cuando el espacio
 * disponible es menor que sus tres filas (pantallas bajas); por defecto, la altura natural.
 * @param {string} [props.className] - Posicionamiento propio del selector.
 * @param {Object} [props.style] - Posición calculada (por ejemplo, en portal).
 * @param {import("react").ReactNode} props.children - Opciones.
 * @param {import("react").Ref} ref - Nodo del panel.
 * @returns {import("react").ReactElement} Listbox con su ScrollBar.
 */
const InputOptionsPanel = forwardRef(function InputOptionsPanel({
  ariaLabel, children, className, disabled, id, metrics, onScrollPositionChange, onViewportScroll, optionCount,
  maxViewportHeight, placement = "bottom", scrollbarLabel, style, viewportRef,
}, ref) {
  const naturalHeight = getInputOptionsViewportHeight(optionCount);
  const viewportHeight = maxViewportHeight ? Math.min(naturalHeight, maxViewportHeight) : naturalHeight;
  return (
    <div
      ref={ref}
      id={id}
      role="listbox"
      aria-label={ariaLabel}
      className={clsx(
        "min-w-0 border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] px-[4px] py-[8px]",
        placement === "top" ? "rounded-t-[12px] border-b-0" : "rounded-b-[12px] border-t-0",
        className,
      )}
      style={style}
    >
      <div
        ref={viewportRef}
        className="flex flex-col gap-[4px] overflow-x-hidden overflow-y-auto overscroll-contain pr-[12px] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        style={{ maxHeight: viewportHeight }}
        onScroll={onViewportScroll}
      >
        {children}
      </div>
      {metrics.length < 1 ? (
        <ScrollBar
          height={viewportHeight}
          length={metrics.length}
          position={metrics.position}
          interactive={!disabled}
          onPositionChange={onScrollPositionChange}
          aria-label={scrollbarLabel}
          className="absolute right-0 top-[8px]"
          trackContainerClassName="bg-transparent"
        />
      ) : null}
    </div>
  );
});

export default InputOptionsPanel;
