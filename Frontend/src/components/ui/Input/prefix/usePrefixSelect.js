import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  findPrefixOptionIndex,
  getPrefixSelectPanelHeight,
  getPrefixSelectPosition,
  getScrollTopToRevealOption,
} from "./prefixSelectPosition.js";

// Tiempo durante el que las letras escritas se acumulan en una misma búsqueda por teclado.
const TYPEAHEAD_RESET_MS = 600;

/**
 * Coordina el selector de prefijo del Input: apertura, opción activa, teclado de listbox
 * (flechas, Home/End, Enter/Espacio, Escape, Tab y búsqueda por letras), cierre por clic
 * exterior y posición del panel en portal. El foco permanece en el disparador mediante
 * `aria-activedescendant`, de modo que el ciclo de Tab de un diálogo contenedor no se rompe.
 *
 * @param {Object} params - Opciones y callbacks del selector.
 * @param {Array<{id: string|number, label: string, description?: string}>} params.options - Opciones.
 * @param {string|number|null} params.value - Identificador seleccionado.
 * @param {boolean} params.disabled - Bloquea apertura y selección.
 * @param {(option: Object) => void} [params.onChange] - Recibe la opción elegida.
 * @returns {Object} Estado, refs y manejadores del disparador y del listado.
 */
export default function usePrefixSelect({ options, value, disabled, onChange }) {
  const triggerRef = useRef(null);
  const listboxRef = useRef(null);
  const typeaheadRef = useRef({ query: "", timeoutId: 0 });
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // El anillo de foco solo acompaña a la navegación por teclado; con el puntero basta el hover,
  // igual que en el selector telefónico, cuyo foco real se mueve a la opción.
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [position, setPosition] = useState(null);
  const selectedIndex = options.findIndex((option) => String(option.id) === String(value));
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;
  const panelHeight = getPrefixSelectPanelHeight(options.length);

  // Mide el segmento selector (no el campo completo), como el envoltorio del prefijo telefónico,
  // antes del paint, y acompaña scroll y resize mientras está abierto.
  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    const updatePosition = () => {
      if (!triggerRef.current) return;
      setPosition(getPrefixSelectPosition(
        triggerRef.current.getBoundingClientRect(),
        panelHeight,
        { width: window.innerWidth, height: window.innerHeight },
      ));
    };
    // El scroll del propio listado (arrastre del ScrollBar, rueda, teclado) no mueve el segmento:
    // recalcular la posición en ese caso solo provocaba renders durante el desplazamiento.
    const updateOnAncestorScroll = (event) => {
      if (listboxRef.current?.contains(event.target)) return;
      updatePosition();
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updateOnAncestorScroll, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updateOnAncestorScroll, true);
    };
  }, [isOpen, panelHeight]);

  // Un clic fuera del disparador y del panel cierra sin seleccionar.
  useEffect(() => {
    if (!isOpen) return undefined;
    const closeOnOutsidePress = (event) => {
      if (triggerRef.current?.contains(event.target) || listboxRef.current?.contains(event.target)) return;
      setIsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress, true);
  }, [isOpen]);

  // Mantiene visible la opción activa al abrir y al navegar con teclado. Depende solo de la opción
  // activa: si dependiera de la posición, cada scroll del usuario (que la recalculaba) devolvía
  // el listado a esa opción y el ScrollBar y la rueda quedaban bloqueados. Ajusta únicamente el
  // área desplazable del listado; scrollIntoView también desplazaría el modal o la página.
  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    const viewport = listboxRef.current?.firstElementChild;
    const option = viewport?.querySelector(`[data-option-index="${activeIndex}"]`);
    if (!viewport || !option) return;
    viewport.scrollTo({
      top: getScrollTopToRevealOption(viewport.getBoundingClientRect(), viewport.scrollTop, option.getBoundingClientRect()),
    });
  }, [activeIndex, isOpen]);

  useEffect(() => () => window.clearTimeout(typeaheadRef.current.timeoutId), []);

  // Si el selector se bloquea con el panel abierto (por ejemplo, durante un guardado), se cierra.
  if (disabled && isOpen) setIsOpen(false);

  /**
   * Abre el panel situando la opción activa en la seleccionada o en la primera.
   *
   * @returns {void}
   */
  function open({ fromKeyboard = false } = {}) {
    if (disabled || options.length === 0) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setKeyboardActive(fromKeyboard);
    setIsOpen(true);
  }

  /**
   * Notifica la opción elegida y cierra el panel devolviendo el foco al disparador.
   *
   * @param {number} index - Índice de la opción.
   * @returns {void}
   */
  function select(index) {
    const option = options[index];
    setIsOpen(false);
    triggerRef.current?.focus();
    if (!option || disabled) return;
    if (String(option.id) !== String(value)) onChange?.(option);
  }

  /**
   * Acumula las letras escritas y activa la siguiente opción que empieza por ellas.
   *
   * @param {string} character - Carácter imprimible pulsado.
   * @returns {void}
   */
  function handleTypeahead(character) {
    const typeahead = typeaheadRef.current;
    window.clearTimeout(typeahead.timeoutId);
    typeahead.query += character;
    typeahead.timeoutId = window.setTimeout(() => { typeahead.query = ""; }, TYPEAHEAD_RESET_MS);
    // Con varias letras se busca desde la opción actual (incluida); con una, desde la siguiente.
    const fromIndex = typeahead.query.length > 1 ? activeIndex - 1 : activeIndex;
    const nextIndex = findPrefixOptionIndex(options, typeahead.query, fromIndex);
    if (nextIndex < 0) return;
    setActiveIndex(nextIndex);
    setKeyboardActive(true);
    if (!isOpen) setIsOpen(true);
  }

  /**
   * Teclado del combobox. Escape detiene la propagación para no cerrar el diálogo contenedor,
   * igual que ActionMenu; Tab cierra y deja continuar el foco.
   *
   * @param {import("react").KeyboardEvent} event - Tecla pulsada en el disparador.
   * @returns {void}
   */
  function handleKeyDown(event) {
    if (disabled) return;
    const { key } = event;

    if (!isOpen) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(key)) {
        event.preventDefault();
        open({ fromKeyboard: true });
      } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        handleTypeahead(key);
      }
      return;
    }

    if (key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
    } else if (key === "Tab") {
      setIsOpen(false);
    } else if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      const step = key === "ArrowDown" ? 1 : -1;
      setKeyboardActive(true);
      setActiveIndex((index) => (index + step + options.length) % options.length);
    } else if (key === "Home" || key === "End") {
      event.preventDefault();
      setKeyboardActive(true);
      setActiveIndex(key === "Home" ? 0 : options.length - 1);
    } else if (key === "Enter" || key === " ") {
      event.preventDefault();
      select(activeIndex);
    } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      handleTypeahead(key);
    }
  }

  return {
    activeIndex,
    isOpen,
    listboxRef,
    panelHeight,
    position,
    selectedOption,
    triggerRef,
    handleKeyDown,
    handleOptionHover: (index) => {
      setKeyboardActive(false);
      setActiveIndex(index);
    },
    highlightedIndex: keyboardActive ? activeIndex : -1,
    handleOptionSelect: select,
    toggle: () => (isOpen ? setIsOpen(false) : open()),
  };
}
