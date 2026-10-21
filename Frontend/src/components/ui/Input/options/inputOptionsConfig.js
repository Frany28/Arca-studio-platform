import clsx from "clsx";

// Patrón de listado unido a un selector del Input (prefijo telefónico y prefijo seleccionable):
// hasta tres filas de 35 px con dos gaps de 4 px visibles a la vez (113 px de área desplazable).
export const INPUT_OPTION_ROW_HEIGHT = 35;
export const INPUT_OPTION_GAP = 4;
export const INPUT_OPTIONS_VISIBLE_ROWS = 3;
// Padding vertical del panel (py-[8px]) que rodea el área desplazable.
export const INPUT_OPTIONS_PANEL_PADDING = 16;

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
