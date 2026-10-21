import { createPortal } from "react-dom";
import clsx from "clsx";

import { ChevronDownIcon } from "../InputIcons.jsx";
import usePrefixSelect from "./usePrefixSelect.js";

/**
 * Selector de prefijo del Input (variante "Prefix select"): abreviatura visible con flecha a
 * la izquierda del campo, separada por un borde como el prefijo telefónico. El listado se monta
 * en portal unido al campo completo, para no quedar recortado por modales o tablas con overflow.
 *
 * @param {Object} props - Opciones, selección y presentación.
 * @param {string} props.inputId - Identificador del campo nativo, base de los ids del listado.
 * @param {Array<{id: string|number, label: string, description?: string}>} props.options - Opciones.
 * @param {string|number|null} props.value - Opción seleccionada.
 * @param {string} props.ariaLabel - Nombre accesible del selector.
 * @param {boolean} props.disabled - Bloquea el selector (también si el Input está deshabilitado).
 * @param {Object} props.sizing - Estilos de tamaño del Input.
 * @param {Object} props.stateStyles - Estilos del estado visual del Input.
 * @param {(option: Object) => void} [props.onChange] - Recibe la opción elegida.
 * @returns {import("react").ReactElement} Disparador y, abierto, el listado en portal.
 */
export default function InputPrefixSelect({ inputId, options, value, ariaLabel, disabled, sizing, stateStyles, onChange }) {
  const select = usePrefixSelect({ options, value, disabled, onChange });
  const { activeIndex, isOpen, listboxRef, position, selectedOption, triggerRef } = select;
  const listboxId = `${inputId}-prefix-options`;
  const optionId = (index) => `${inputId}-prefix-option-${index}`;
  const selectedLabel = selectedOption?.label ?? "";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={selectedOption ? `${ariaLabel}: ${selectedOption.description || selectedLabel}` : ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={isOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        disabled={disabled}
        className={clsx(
          "flex shrink-0 items-center gap-[4px] self-stretch rounded-l-[inherit] border-r border-[var(--color-neutral-200)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary-10)]",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
          sizing.prefixSelect,
        )}
        onClick={select.toggle}
        onKeyDown={select.handleKeyDown}
      >
        <span className={clsx("text-body-3 whitespace-nowrap", disabled ? stateStyles.prefix : "text-[var(--color-text-300)]")}>
          {selectedLabel}
        </span>
        <ChevronDownIcon className={clsx("size-5 transition-transform duration-150", isOpen && "rotate-180", stateStyles.trailingIcon)} />
      </button>

      {isOpen && typeof document !== "undefined"
        ? createPortal(
          <div
            ref={listboxRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            className={clsx(
              "fixed z-[var(--z-tooltip)] flex flex-col gap-[4px] overflow-y-auto overscroll-contain border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] px-[4px] py-[8px] shadow-[var(--shadow-e2)] [scrollbar-color:var(--color-neutral-400)_transparent] [scrollbar-width:thin]",
              position?.placement === "top" ? "rounded-t-[12px] border-b-0" : "rounded-b-[12px] border-t-0",
            )}
            // Oculto hasta medir el campo para no dibujarse un frame en el origen.
            style={position ? { left: position.left, top: position.top, width: position.width, maxHeight: select.panelHeight } : { visibility: "hidden" }}
          >
            {options.map((option, index) => {
              const isSelected = String(option.id) === String(value);
              return (
                <div
                  key={option.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={isSelected}
                  data-option-index={index}
                  className={clsx(
                    "grid h-[35px] shrink-0 cursor-pointer grid-cols-[56px_minmax(0,1fr)] items-center gap-[8px] rounded-[8px] px-[8px] transition-colors",
                    isSelected || index === activeIndex ? "bg-[var(--color-neutral-200)]" : "hover:bg-[var(--color-neutral-200)]",
                  )}
                  // Conserva el foco en el disparador para que el diálogo contenedor no lo pierda.
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => select.handleOptionHover(index)}
                  onClick={() => select.handleOptionSelect(index)}
                >
                  <span className="text-body-4 whitespace-nowrap text-[var(--color-text-300)]">{option.label}</span>
                  {option.description ? (
                    <span className="text-body-4 truncate text-[var(--color-text-200)]" title={option.description}>{option.description}</span>
                  ) : null}
                </div>
              );
            })}
          </div>,
          document.body,
        )
        : null}
    </>
  );
}
