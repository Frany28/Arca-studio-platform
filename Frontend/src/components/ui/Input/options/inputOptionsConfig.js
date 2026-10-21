import clsx from "clsx";

// Patrón de listado unido a un selector del Input (prefijo telefónico y prefijo seleccionable):
// hasta tres filas de 35 px con dos gaps de 4 px visibles a la vez (113 px de área desplazable).
export const INPUT_OPTION_ROW_HEIGHT = 35;
export const INPUT_OPTION_GAP = 4;
export const INPUT_OPTIONS_VISIBLE_ROWS = 3;
// Padding vertical del panel (py-[8px]) que rodea el área desplazable.
export const INPUT_OPTIONS_PANEL_PADDING = 16;
// Borde del panel en su lado libre (el lado unido al campo no dibuja borde).
export const INPUT_OPTIONS_PANEL_BORDER = 1;

// Relación entre el segmento selector y su listado: el panel empieza 1 px a la izquierda del
// segmento (cubre su borde) y mide al menos el segmento + 1 px, como el selector telefónico
// (`absolute left-[-1px] top-full w-[calc(100%+1px)]` sobre su envoltorio).
export const INPUT_OPTIONS_ANCHOR_OFFSET = 1;

/**
 * Divisor de 1 px bajo el segmento selector mientras su listado está abierto: une visualmente
 * el segmento con el panel, que no dibuja borde en ese lado. El segmento debe ser `relative`.
 *
 * @param {boolean} open - Listado abierto.
 * @param {"bottom"|"top"} [placement="bottom"] - Lado del segmento al que se une el panel.
 * @returns {string|false} Clases del pseudoelemento divisor.
 */
export function getInputOptionsAnchorDividerClassName(open, placement = "bottom") {
  return open && clsx(
    "after:pointer-events-none after:absolute after:left-[-1px] after:right-0 after:h-px after:bg-[var(--color-neutral-200)]",
    placement === "top" ? "after:top-0" : "after:bottom-0",
  );
}

/**
 * Altura del área desplazable del listado: los resultados cortos conservan su altura natural y
 * los largos muestran tres filas; viewport y ScrollBar comparten exactamente esta medida.
 *
 * @param {number} optionCount - Opciones visibles (al menos se reserva una fila).
 * @returns {number} Altura en píxeles.
 */
export function getInputOptionsViewportHeight(optionCount) {
  const rows = Math.min(Math.max(optionCount, 1), INPUT_OPTIONS_VISIBLE_ROWS);
  return rows * INPUT_OPTION_ROW_HEIGHT + (rows - 1) * INPUT_OPTION_GAP;
}

/**
 * Clases de una fila del listado: 35 px, radio de 8 px, fondo `neutral-200` al estar
 * seleccionada o con hover y anillo `primary-10` para el foco de teclado. `highlighted` dibuja
 * ese mismo anillo cuando el foco real permanece en el disparador (aria-activedescendant).
 *
 * @param {Object} state - Estado de la fila.
 * @param {boolean} state.selected - Opción seleccionada.
 * @param {boolean} [state.disabled=false] - Selector bloqueado.
 * @param {boolean} [state.highlighted=false] - Opción activa por teclado sin foco real.
 * @param {string} state.columns - Plantilla de columnas propia del contenido de cada selector.
 * @returns {string} Clases de la fila.
 */
export function getInputOptionClassName({ selected, disabled = false, highlighted = false, columns }) {
  return clsx(
    "grid h-[35px] shrink-0 items-center gap-[2px] rounded-[8px] px-[8px] text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-10)]",
    columns,
    selected
      ? "bg-[var(--color-neutral-200)]"
      : !disabled && "hover:bg-[var(--color-neutral-200)]",
    highlighted && "ring-2 ring-[var(--color-primary-10)]",
    disabled ? "cursor-not-allowed" : "cursor-pointer",
  );
}
