import { useEffect, useRef, useState } from "react";
import { formatPhoneNumber, getPhoneDigits, normalizeDialCode } from "./phoneUtils.js";
import useInputOptionsScroll from "../options/useInputOptionsScroll.js";

/**
 * Coordina país, prefijo, menú y formato de la variante telefónica.
 * País y prefijo inicializan estado una sola vez; no se sincronizan posteriormente.
 * onPhoneCountryChange notifica la selección interna y no activa un modo controlado de país.
 * El valor común permanece en Input y solo se escribe si no está controlado.
 * @param {object} options Configuración inicial, callbacks y acceso al valor interno.
 * @param {string} options.countryCode País inicial; tiene prioridad sobre el fallback por prefijo.
 * @param {string} options.countryPrefix Prefijo inicial del buscador y fallback de país.
 * @param {Array<object>} options.phoneOptions Catálogo de países, máscaras y opciones visibles.
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
  // Scroll del listado con el ScrollBar compartido por los selectores del Input; mide al montar
  // el listado y al filtrar, y cancela su frame al cerrar o desmontar.
  const optionsScroll = useInputOptionsScroll({
    open: isPhoneMenuOpen,
    optionCount: filteredPhoneOptions.length,
    disabled,
  });

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
    if (!option || disabled) return;

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
    if (disabled) return;
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
    if (disabled || event.key !== "Enter" || !isPhoneMenuOpen) return;

    const firstVisibleOption = filteredPhoneOptions[0];
    if (!firstVisibleOption) return;

    event.preventDefault();
    handlePhoneOptionSelection(firstVisibleOption);
  };

  /** Abre el menú al enfocar el campo de prefijo. */
  const handlePrefixFocus = () => {
    if (!disabled) setIsPhoneMenuOpen(true);
  };

  /** Alterna el menú desde su botón sin cambiar la selección. */
  const handleToggleMenu = () => {
    if (!disabled) setIsPhoneMenuOpen((current) => !current);
  };

  /**
   * Formatea el número antes de notificar al consumidor y modifica el mismo evento.
   * El estado interno solo cambia cuando el valor común no está controlado.
   * @param {object} event Evento de cambio del campo nativo.
   * @returns {void}
   */
  const handleChange = (event) => {
    if (disabled) return;
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
    optionsScroll,
    handlePrefixMouseDown,
    handlePrefixChange,
    handlePrefixKeyDown,
    handlePrefixFocus,
    handleToggleMenu,
    handlePhoneOptionSelection,
    handleChange,
  };
}
