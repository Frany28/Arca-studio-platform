import { createPortal } from "react-dom";
import clsx from "clsx";

import { ChevronDownIcon } from "../InputIcons.jsx";
import InputOptionsPanel from "../options/InputOptionsPanel.jsx";
import { getInputOptionClassName, getInputOptionsAnchorDividerClassName } from "../options/inputOptionsConfig.js";
import useInputOptionsScroll from "../options/useInputOptionsScroll.js";
import usePrefixSelect from "./usePrefixSelect.js";

/**
 * Selector de prefijo del Input (variante "Prefix select"): abreviatura visible con flecha a
 * la izquierda del campo, separada por un borde como el prefijo telefónico. Su listado comparte
 * con el selector telefónico la carcasa, las filas, el ScrollBar y los estados; se monta en
 * portal unido al campo completo (ancho suficiente para la descripción) para no quedar recortado
 * por modales o tablas con overflow.
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
  const { activeIndex, highlightedIndex, isOpen, listboxRef, position, selectedOption, triggerRef } = select;
  const optionsScroll = useInputOptionsScroll({ open: isOpen, optionCount: options.length, disabled });
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
          "relative flex shrink-0 items-center gap-[4px] self-stretch rounded-l-[inherit] border-r border-[var(--color-neutral-200)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary-10)]",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
          getInputOptionsAnchorDividerClassName(isOpen, position?.placement),
          sizing.prefixSelect,
        )}
        onClick={select.toggle}
        onKeyDown={select.handleKeyDown}
      >
        <span className={clsx("text-body-3 whitespace-nowrap", disabled ? stateStyles.prefix : "text-[var(--color-text-300)]")}>
          {selectedLabel}
        </span>
        <ChevronDownIcon className={clsx("size-5", stateStyles.trailingIcon)} />
      </button>

      {isOpen && typeof document !== "undefined"
        ? createPortal(
          <InputOptionsPanel
            ref={listboxRef}
            id={listboxId}
            ariaLabel={ariaLabel}
            optionCount={options.length}
            viewportRef={optionsScroll.scrollRef}
            metrics={optionsScroll.metrics}
            onViewportScroll={optionsScroll.handleScroll}
            onScrollPositionChange={optionsScroll.handlePositionChange}
            scrollbarLabel={`Desplazar ${ariaLabel.toLocaleLowerCase("es")}`}
            disabled={disabled}
            placement={position?.placement}
            className="fixed z-[var(--z-tooltip)]"
            // Oculto hasta medir el campo para no dibujarse un frame en el origen.
            // Ancho según el contenido (abreviatura + nombre), nunca menor que el segmento.
            style={position
              ? { left: position.left, top: position.top, minWidth: position.minWidth, maxWidth: position.maxWidth, width: "max-content" }
              : { visibility: "hidden" }}
          >
            {options.map((option, index) => (
              <div
                key={option.id}
                id={optionId(index)}
                role="option"
                aria-selected={String(option.id) === String(value)}
                data-option-index={index}
                className={getInputOptionClassName({
                  selected: String(option.id) === String(value),
                  disabled,
                  highlighted: index === highlightedIndex,
                  columns: "grid-cols-[48px_minmax(0,1fr)]",
                })}
                // Conserva el foco en el disparador para que el diálogo contenedor no lo pierda.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => select.handleOptionHover(index)}
                onClick={() => select.handleOptionSelect(index)}
              >
                <span className="text-body-4 whitespace-nowrap text-[var(--color-text-300)]">{option.label}</span>
                {option.description ? (
                  <span className="text-body-4 min-w-0 truncate text-[var(--color-text-200)]" title={option.description}>{option.description}</span>
                ) : null}
              </div>
            ))}
          </InputOptionsPanel>,
          document.body,
        )
        : null}
    </>
  );
}
