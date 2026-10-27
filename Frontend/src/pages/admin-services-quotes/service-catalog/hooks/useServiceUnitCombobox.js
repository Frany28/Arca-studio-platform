import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  getPrefixSelectPanelHeight,
  getScrollTopToRevealOption,
  resolvePrefixSelectLayout,
} from "../../../../components/ui/Input/prefix/prefixSelectPosition.js";
import { observeAnchorLayout } from "../../../../components/ui/Input/options/observeAnchorLayout.js";

/**
 * Estado y teclado del combobox «Unidad de medida»: el campo nativo del Input conserva el foco
 * (patrón `aria-activedescendant`), de modo que se escribe y se navega en el mismo control y el
 * ciclo de Tab del diálogo no se altera. El listado flota en un portal unido al campo completo,
 * con la misma posición, altura y desplazamiento que el selector de prefijo del Input.
 *
 * Abre solo por una acción del usuario (clic, escritura o flechas), nunca por un foco
 * programático, para que volver al campo tras crear o elegir una unidad no despliegue opciones.
 *
 * @param {Object} params - Opciones visibles y callbacks.
 * @param {Array<{id: number}>} params.options - Opciones ya filtradas por lo escrito.
 * @param {boolean} params.disabled - Bloquea apertura y selección.
 * @param {(option: Object) => void} params.onSelect - Recibe la opción elegida.
 * @returns {Object} Estado, refs y manejadores del campo y del listado.
 */
export function useServiceUnitCombobox({ disabled, onSelect, options }) {
  const anchorRef = useRef(null);
  const listboxRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  // El anillo de foco acompaña solo a la navegación por teclado; con el puntero basta el hover.
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [position, setPosition] = useState(null);
  const visible = isOpen && !disabled && options.length > 0;
  // Filtrar puede dejar el índice fuera de rango: se deriva uno válido sin otro estado.
  const resolvedActiveIndex = activeIndex < options.length ? activeIndex : 0;
  const panelHeight = getPrefixSelectPanelHeight(options.length);

  // Mide el campo completo antes del paint y lo vuelve a medir ante cualquier cambio de su
  // geometría mientras está abierto (observeAnchorLayout, compartido con el selector de prefijo).
  useLayoutEffect(() => {
    if (!visible) return undefined;
    const shell = anchorRef.current?.querySelector("[data-input-shell]");
    if (!shell) return undefined;
    const updatePosition = () => {
      setPosition(resolvePrefixSelectLayout({
        segment: shell.getBoundingClientRect(),
        panelHeight,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      }));
    };
    updatePosition();
    return observeAnchorLayout({ anchor: shell, getPanel: () => listboxRef.current, onChange: updatePosition });
  }, [panelHeight, visible]);

  // Mantiene visible la opción activa moviendo solo el área del listado (scrollIntoView
  // desplazaría también el modal).
  useEffect(() => {
    if (!visible) return;
    const viewport = listboxRef.current?.firstElementChild;
    const option = viewport?.querySelector(`[data-option-index="${resolvedActiveIndex}"]`);
    if (!viewport || !option) return;
    viewport.scrollTo({
      top: getScrollTopToRevealOption(viewport.getBoundingClientRect(), viewport.scrollTop, option.getBoundingClientRect()),
    });
  }, [resolvedActiveIndex, visible]);

  /**
   * Abre el listado con la primera opción activa.
   *
   * @param {{fromKeyboard?: boolean}} [options] - Origen de la apertura (anillo de foco).
   * @returns {void}
   */
  function open({ fromKeyboard = false } = {}) {
    if (disabled) return;
    setActiveIndex(0);
    setKeyboardActive(fromKeyboard);
    setIsOpen(true);
  }

  /**
   * Elige una opción y cierra el listado.
   *
   * @param {number} index - Índice en las opciones visibles.
   * @returns {void}
   */
  function select(index) {
    const option = options[index];
    setIsOpen(false);
    if (option && !disabled) onSelect(option);
  }

  /**
   * Teclado del combobox, en fase de captura para adelantarse al teclado de Tags del Input (que
   * con texto convertiría Enter en una etiqueta libre). Solo consume las teclas que maneja:
   * flechas, Home/End, Enter (con el listado abierto, sin enviar el formulario) y Escape (cierra
   * sin cerrar el diálogo). Tab cierra y deja seguir el foco.
   *
   * @param {import("react").KeyboardEvent} event - Tecla pulsada en el campo.
   * @returns {void}
   */
  function handleKeyDownCapture(event) {
    if (disabled) return;
    const { key } = event;
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      if (!visible) {
        open({ fromKeyboard: true });
        return;
      }
      const step = key === "ArrowDown" ? 1 : -1;
      setKeyboardActive(true);
      setActiveIndex((resolvedActiveIndex + step + options.length) % options.length);
    } else if (!visible) {
      return;
    } else if (key === "Home" || key === "End") {
      event.preventDefault();
      event.stopPropagation();
      setKeyboardActive(true);
      setActiveIndex(key === "Home" ? 0 : options.length - 1);
    } else if (key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      select(resolvedActiveIndex);
    } else if (key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
    } else if (key === "Tab") {
      setIsOpen(false);
    }
  }

  return {
    activeIndex: resolvedActiveIndex,
    anchorRef,
    highlightedIndex: keyboardActive ? resolvedActiveIndex : -1,
    isOpen: visible,
    listboxRef,
    position,
    close: () => setIsOpen(false),
    handleKeyDownCapture,
    open,
    /**
     * Activa una opción con el puntero; solo un movimiento real la cambia (no el scroll).
     *
     * @param {number} index - Opción bajo el puntero.
     * @returns {void}
     */
    hoverOption: (index) => {
      setKeyboardActive(false);
      setActiveIndex(index);
    },
    select,
  };
}
