import { createPortal } from "react-dom";

import InputOptionsPanel from "../../../../components/ui/Input/options/InputOptionsPanel.jsx";
import { INPUT_OPTIONS_ANCHOR_OFFSET, getInputOptionClassName } from "../../../../components/ui/Input/options/inputOptionsConfig.js";

/**
 * Listado del combobox «Unidad de medida»: las unidades se agrupan por su unidad base bajo un
 * encabezado discreto («Metro cuadrado (m²)») y cada fila muestra el símbolo de la base y su
 * categoría («m²  de construcción») con la carcasa, las filas y los estados compartidos por los
 * selectores del Input (35 px, tres filas visibles, scroll nativo sin barra). Se monta en portal
 * con `position: fixed` para no quedar recortado por el scroll del modal. Las filas no toman el
 * foco: el campo conserva el foco y señala la opción activa con `aria-activedescendant`. Los
 * encabezados no son opciones: solo nombran su grupo y no entran en la navegación.
 *
 * @param {Object} props - Grupos, estado y callbacks.
 * @param {string} props.id - Id del listbox (aria-controls del campo).
 * @param {(index: number) => string} props.optionId - Id de cada opción (aria-activedescendant).
 * @param {Array<{key: string, title: string, options: Array<{id: number, symbol: string, category: string,
 * baseName: string, label: string}>}>} props.groups - Grupos visibles (groupServiceUnitOptions); el
 * índice de cada opción es su posición en la lista plana de todos los grupos.
 * @param {number|null} props.selectedId - Denominación elegida en el borrador.
 * @param {number} props.activeIndex - Opción activa.
 * @param {number} props.highlightedIndex - Opción activa por teclado (anillo de foco) o -1.
 * @param {Object|null} props.position - Posición calculada por useServiceUnitCombobox.
 * @param {import("react").Ref} props.listboxRef - Ref del panel.
 * @param {(index: number) => void} props.onHover - Activa una opción con el puntero.
 * @param {(index: number) => void} props.onSelect - Elige una opción.
 * @returns {import("react").ReactPortal|null} Listbox en portal.
 */
function ServiceUnitOptionsList({ activeIndex, groups, highlightedIndex, id, listboxRef, onHover, onSelect, optionId, position, selectedId }) {
  if (typeof document === "undefined") return null;
  // Índice plano de la primera opción de cada grupo (sin reasignar variables durante el render).
  const groupStarts = groups.reduce((starts, group, groupIndex) => {
    starts.push(groupIndex ? starts[groupIndex - 1] + groups[groupIndex - 1].options.length : 0);
    return starts;
  }, []);
  const optionCount = groups.reduce((count, group) => count + group.options.length, 0);
  return createPortal(
    <InputOptionsPanel
      ref={listboxRef}
      id={id}
      ariaLabel="Unidades de medida registradas"
      // Los encabezados ocupan filas del área visible.
      optionCount={optionCount + groups.length}
      hideScrollbar
      disabled={false}
      placement={position?.placement}
      maxViewportHeight={position?.viewportMaxHeight}
      className="fixed z-[var(--z-tooltip)]"
      // Oculto hasta medir el campo; alineado con sus bordes laterales y con su mismo ancho (el
      // desfase de 1 px del layout compartido solo aplica a un segmento interior del campo).
      style={position
        ? {
          left: position.left + INPUT_OPTIONS_ANCHOR_OFFSET,
          top: position.top,
          width: position.minWidth - INPUT_OPTIONS_ANCHOR_OFFSET,
          maxWidth: position.maxWidth,
        }
        : { visibility: "hidden" }}
    >
      {groups.map((group, groupIndex) => {
        const headerId = `${id}-group-${group.key}`;
        return (
          <div key={group.key} role="group" aria-labelledby={headerId} className="flex flex-col gap-[4px]">
            <div
              id={headerId}
              data-option-group-header
              className="text-body-4 truncate px-[8px] pt-[4px] text-[var(--color-text-100)]"
              onMouseDown={(event) => event.preventDefault()}
            >
              {group.title}
            </div>
            {group.options.map((option, optionIndex) => {
              const index = groupStarts[groupIndex] + optionIndex;
              return (
                <div
                  key={option.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={option.id === selectedId}
                  // El nombre de la base distingue símbolos parecidos (m / m.l.) sin ocupar la fila.
                  aria-label={option.baseName ? `${option.label}, ${option.baseName}` : option.label}
                  data-option-index={index}
                  data-unit-base-only={option.baseOnly ? "true" : undefined}
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
              );
            })}
          </div>
        );
      })}
    </InputOptionsPanel>,
    document.body,
  );
}

export default ServiceUnitOptionsList;
