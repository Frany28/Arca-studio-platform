import { createPortal } from "react-dom";

import InputOptionsPanel from "../../../../components/ui/Input/options/InputOptionsPanel.jsx";
import { getInputOptionClassName } from "../../../../components/ui/Input/options/inputOptionsConfig.js";

/**
 * Listado del combobox «Unidad de medida»: cada fila muestra el símbolo de la base y su categoría
 * («m²  de construcción») con la carcasa, las filas y los estados compartidos por los selectores
 * del Input (35 px, tres filas visibles, scroll nativo sin barra). Se monta en portal con
 * `position: fixed` para no quedar recortado por el scroll del modal. Las filas no toman el foco:
 * el campo conserva el foco y señala la opción activa con `aria-activedescendant`.
 *
 * @param {Object} props - Opciones, estado y callbacks.
 * @param {string} props.id - Id del listbox (aria-controls del campo).
 * @param {(index: number) => string} props.optionId - Id de cada opción (aria-activedescendant).
 * @param {Array<{id: number, symbol: string, category: string, baseName: string, label: string}>} props.options - Opciones visibles.
 * @param {number|null} props.selectedId - Denominación elegida en el borrador.
 * @param {number} props.activeIndex - Opción activa.
 * @param {number} props.highlightedIndex - Opción activa por teclado (anillo de foco) o -1.
 * @param {Object|null} props.position - Posición calculada por useServiceUnitCombobox.
 * @param {import("react").Ref} props.listboxRef - Ref del panel.
 * @param {(index: number) => void} props.onHover - Activa una opción con el puntero.
 * @param {(index: number) => void} props.onSelect - Elige una opción.
 * @returns {import("react").ReactPortal|null} Listbox en portal.
 */
function ServiceUnitOptionsList({ activeIndex, highlightedIndex, id, listboxRef, onHover, onSelect, optionId, options, position, selectedId }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <InputOptionsPanel
      ref={listboxRef}
      id={id}
      ariaLabel="Unidades de medida registradas"
      optionCount={options.length}
      hideScrollbar
      disabled={false}
      placement={position?.placement}
      maxViewportHeight={position?.viewportMaxHeight}
      className="fixed z-[var(--z-tooltip)]"
      // Oculto hasta medir el campo; ocupa el ancho del campo completo.
      style={position
        ? { left: position.left, top: position.top, width: position.minWidth, maxWidth: position.maxWidth }
        : { visibility: "hidden" }}
    >
      {options.map((option, index) => (
        <div
          key={option.id}
          id={optionId(index)}
          role="option"
          aria-selected={option.id === selectedId}
          // El nombre de la base distingue símbolos parecidos (m / m.l.) sin ocupar la fila.
          aria-label={option.baseName ? `${option.label}, ${option.baseName}` : option.label}
          data-option-index={index}
          className={getInputOptionClassName({
            selected: option.id === selectedId,
            highlighted: index === highlightedIndex,
            columns: "grid-cols-[auto_minmax(0,1fr)] gap-x-[8px]",
          })}
          // Conserva el foco en el campo: el diálogo no lo pierde y la búsqueda sigue activa.
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={(event) => {
            if ((event.movementX || event.movementY) && index !== activeIndex) onHover(index);
          }}
          onClick={() => onSelect(index)}
        >
          <span className="text-body-4 whitespace-nowrap text-[var(--color-text-300)]">{option.symbol}</span>
          <span className="text-body-4 truncate text-[var(--color-text-200)]">{option.category}</span>
        </div>
      ))}
    </InputOptionsPanel>,
    document.body,
  );
}

export default ServiceUnitOptionsList;
