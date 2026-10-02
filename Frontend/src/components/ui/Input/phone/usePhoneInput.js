import { useEffect, useRef, useState } from "react";
import { formatPhoneNumber, getPhoneDigits, normalizeDialCode } from "./phoneUtils.js";

/**
 * Lee tamaño y desplazamiento reales del listado para su scrollbar personalizado.
 * @param {HTMLElement|null} element Contenedor desplazable, si está montado.
 * @returns {{length: number, position: number}} Proporciones visibles y recorridas.
 */
function getVerticalScrollMetrics(element) {
  if (!element) return { length: 1, position: 0 };
  const maxScroll = Math.max(element.scrollHeight - element.clientHeight, 0);
  return {
    length: Math.min(element.clientHeight / Math.max(element.scrollHeight, 1), 1),
    position: maxScroll > 0 ? element.scrollTop / maxScroll : 0,
  };
}

/**
 * Coordina país, prefijo, menú y formato de la variante telefónica.
 * País y prefijo inicializan estado una sola vez; no se sincronizan posteriormente.
 * El valor común permanece en Input y solo se escribe si no está controlado.
 * @param {object} options Configuración inicial, callbacks y acceso al valor interno.
 * @returns {object} Estado, refs y acciones del selector y del número nativo.
 */
export default function usePhoneInput({
  resolvedType, countryCode, countryPrefix, phoneOptions, isControlled,
  setInternalValue, onChange, onPhoneCountryChange, disabled,
}) {
  const [isPhoneMenuOpen, setIsPhoneMenuOpen] = useState(false);
  const [selectedPhoneOption, setSelectedPhoneOption] = useState(() => {
    const preferredByCountry = phoneOptions.find(
      (option) => option.countryCode === countryCode,
    );
    const fallbackByPrefix = phoneOptions.find(
      (option) => option.dialCode === countryPrefix,
    );

    return (
      preferredByCountry ??
      fallbackByPrefix ??
      phoneOptions[0]
    );
  });
  const [phonePrefixValue, setPhonePrefixValue] = useState(() =>
    normalizeDialCode(countryPrefix || phoneOptions[0]?.dialCode),
  );
  const phoneMenuRef = useRef(null);
  const phonePrefixInputRef = useRef(null);
  const phoneOptionsScrollRef = useRef(null);
  const [phoneScrollMetrics, setPhoneScrollMetrics] = useState({ length: 1, position: 0 });
  const resolvedPhoneOption = selectedPhoneOption ?? phoneOptions[0];
  const normalizedPhonePrefix = normalizeDialCode(phonePrefixValue);
  const filteredPhoneOptions =
    resolvedType === "Phone number"
      ? phoneOptions.filter((option) => {
          const optionDigits = getPhoneDigits(option.dialCode);
          const prefixDigits = getPhoneDigits(normalizedPhonePrefix);

          if (!prefixDigits) return true;
          return optionDigits.startsWith(prefixDigits);
        })
      : phoneOptions;
  // La medición espera al montaje del listado; el frame se cancela al cerrar o desmontar.
  useEffect(() => {
    if (!isPhoneMenuOpen) return undefined;
    const frameId = window.requestAnimationFrame(() => {
      setPhoneScrollMetrics(getVerticalScrollMetrics(phoneOptionsScrollRef.current));
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [filteredPhoneOptions.length, isPhoneMenuOpen]);

  // Los listeners conservan mousedown y Escape y se retiran al cerrar o desmontar.
  useEffect(() => {
    if (!isPhoneMenuOpen) {
      return undefined;
    }

    /** Cierra el menú si el mousedown ocurre fuera del selector. */
    const handlePointerDown = (event) => {
      if (!phoneMenuRef.current?.contains(event.target)) {
        setIsPhoneMenuOpen(false);
      }
    };

    /** Cierra el menú con Escape sin consumir el evento del documento. */
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsPhoneMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isPhoneMenuOpen]);

  /**
   * Notifica la selección antes de reformatear el valor interno y cerrar el menú.
   * El valor controlado se conserva hasta que su consumidor lo actualice.
   * @param {object|undefined} option País seleccionado.
   * @returns {void}
   */
  const handlePhoneOptionSelection = (option) => {
    if (!option) return;

    setSelectedPhoneOption(option);
    setPhonePrefixValue(option.dialCode);
    onPhoneCountryChange?.(option);

    if (!isControlled) {
      setInternalValue((current) => formatPhoneNumber(current, option));
    }

    setIsPhoneMenuOpen(false);
  };

  /**
   * Abre el menú desde el contenedor y enfoca el prefijo sin desplazar el foco por defecto.
   * @param {object} event Evento del control del prefijo.
   * @returns {void}
   */
  const handlePrefixMouseDown = (event) => {
    if (disabled || event.target.closest("input, button")) return;
    event.preventDefault();
    setIsPhoneMenuOpen(true);
    phonePrefixInputRef.current?.focus();
  };

  /**
   * Resuelve coincidencias exactas del prefijo, notifica el país y después reformatea solo el valor interno.
   * @param {object} event Evento del control del prefijo.
   * @returns {void}
   */
  const handlePrefixChange = (event) => {
    const nextPrefix = normalizeDialCode(event.target.value);
    setPhonePrefixValue(nextPrefix);
    const exactMatches = phoneOptions.filter((option) => option.dialCode === nextPrefix);
    const exactMatch = exactMatches.find(
      (option) => option.countryCode === resolvedPhoneOption.countryCode,
    ) ?? (exactMatches.length === 1 ? exactMatches[0] : null);
    if (exactMatch) {
      setSelectedPhoneOption(exactMatch);
      onPhoneCountryChange?.(exactMatch);
      if (!isControlled) {
        setInternalValue((current) => formatPhoneNumber(current, exactMatch));
      }
    }
    setIsPhoneMenuOpen(true);
  };

  /**
   * Consume Enter únicamente cuando puede seleccionar la primera opción visible.
   * @param {object} event Evento del control del prefijo.
   * @returns {void}
   */
  const handlePrefixKeyDown = (event) => {
    if (event.key !== "Enter" || !isPhoneMenuOpen) return;

    const firstVisibleOption = filteredPhoneOptions[0];
    if (!firstVisibleOption) return;

    event.preventDefault();
    handlePhoneOptionSelection(firstVisibleOption);
  };

  /**
   * Desplaza el contenedor y actualiza las métricas del scrollbar desde el DOM.
   * @param {number} nextPosition Posición relativa solicitada por el scrollbar.
   * @returns {void}
   */
  const handleScrollPositionChange = (nextPosition) => {
    const container = phoneOptionsScrollRef.current;
    if (!container) return;
    const maxScroll = Math.max(container.scrollHeight - container.clientHeight, 0);
    container.scrollTop = maxScroll * nextPosition;
    setPhoneScrollMetrics(getVerticalScrollMetrics(container));
  };

  /** Abre el menú al enfocar el campo de prefijo. */
  const handlePrefixFocus = () => setIsPhoneMenuOpen(true);

  /** Alterna el menú desde su botón sin cambiar la selección. */
  const handleToggleMenu = () => setIsPhoneMenuOpen((current) => !current);

  /**
   * Lee las métricas del contenedor tras su desplazamiento nativo.
   * @param {object} event Evento de scroll del listado.
   * @returns {void}
   */
  const handleOptionsScroll = (event) =>
    setPhoneScrollMetrics(getVerticalScrollMetrics(event.currentTarget));

  /**
   * Formatea el número antes de notificar al consumidor y modifica el mismo evento.
   * El estado interno solo cambia cuando el valor común no está controlado.
   * @param {object} event Evento de cambio del campo nativo.
   * @returns {void}
   */
  const handleChange = (event) => {
    const formattedValue = formatPhoneNumber(event.target.value, resolvedPhoneOption);
    if (!isControlled) {
      setInternalValue(formattedValue);
    }
    event.target.value = formattedValue;
    onChange?.(event);
  };

  return {
    resolvedPhoneOption,
    normalizedPhonePrefix,
    filteredPhoneOptions,
    isPhoneMenuOpen,
    phoneMenuRef,
    phonePrefixInputRef,
    phoneOptionsScrollRef,
    phoneScrollMetrics,
    handlePrefixMouseDown,
    handlePrefixChange,
    handlePrefixKeyDown,
    handleScrollPositionChange,
    handlePrefixFocus,
    handleToggleMenu,
    handleOptionsScroll,
    handlePhoneOptionSelection,
    handleChange,
  };
}
