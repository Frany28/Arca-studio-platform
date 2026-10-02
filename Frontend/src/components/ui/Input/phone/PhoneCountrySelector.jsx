import clsx from "clsx";
import Flag from "../../../Flag.jsx";
import ScrollBar from "../../ScrollBar/ScrollBar.jsx";
import { ChevronDownIcon } from "../InputIcons.jsx";
import { getPhoneDigits } from "./phoneUtils.js";

/**
 * Presenta el prefijo y el listado de países con la geometría y semántica originales.
 * Delega selección, teclado, foco y desplazamiento al hook telefónico.
 * @param {object} props Identificador, estilos, estado disabled y contrato del hook.
 * @returns {import("react").ReactElement} Selector sin wrappers adicionales.
 */
export default function PhoneCountrySelector({ inputId, disabled, sizing, stateStyles, phone }) {
  const {
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
  } = phone;
  return (
    <div
      ref={phoneMenuRef}
      className="relative"
    >
      <div
        className={clsx(
          "relative flex shrink-0 items-center gap-[8px] border-r border-[var(--color-neutral-200)]",
          disabled ? "cursor-not-allowed" : "cursor-text",
          isPhoneMenuOpen && "after:pointer-events-none after:absolute after:bottom-0 after:left-[-1px] after:right-0 after:h-px after:bg-[var(--color-neutral-200)]",
          sizing.phonePrefix,
        )}
        onMouseDown={handlePrefixMouseDown}
      >
        <Flag countryCode={resolvedPhoneOption.countryCode} size="20px" title={resolvedPhoneOption.label} useSvg loading="lazy" />
        <span className={clsx("flex w-[44px] items-center", stateStyles.prefix)}>
          <span className="text-body-3 shrink-0" aria-hidden="true">+</span>
          <input
            ref={phonePrefixInputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            value={getPhoneDigits(normalizedPhonePrefix)}
            disabled={disabled}
            className={clsx(
              "text-body-3 min-w-0 flex-1 border-0 bg-transparent tracking-[0px] outline-none",
              disabled ? "cursor-not-allowed" : "cursor-text",
              stateStyles.prefix,
            )}
            onFocus={handlePrefixFocus}
            onChange={handlePrefixChange}
            onKeyDown={handlePrefixKeyDown}
            role="combobox"
            aria-label="Buscar código de país por prefijo; el signo más es fijo"
            aria-expanded={isPhoneMenuOpen}
            aria-controls={isPhoneMenuOpen ? `${inputId}-phone-options` : undefined}
            aria-autocomplete="list"
            aria-haspopup="listbox"
          />
        </span>
        <button
          type="button"
          className={clsx("inline-flex size-5 items-center justify-center", disabled ? "cursor-not-allowed" : "cursor-pointer", stateStyles.trailingIcon)}
          onClick={handleToggleMenu}
          disabled={disabled}
          aria-label={isPhoneMenuOpen ? "Cerrar países" : "Mostrar países"}
          tabIndex={-1}
        >
          <ChevronDownIcon className="size-5" />
        </button>
      </div>

      {isPhoneMenuOpen ? (
        <div
          id={`${inputId}-phone-options`}
          role="listbox"
          aria-label="Países y códigos telefónicos"
          className="absolute left-[-1px] top-full z-20 w-[calc(100%+1px)] min-w-0 rounded-b-[12px] border border-[var(--color-neutral-200)] border-t-0 bg-[var(--color-neutral-100)] px-[4px] py-[8px]"
        >
          <div
            ref={phoneOptionsScrollRef}
            className="flex max-h-[152px] flex-col gap-[4px] overflow-x-hidden overflow-y-auto overscroll-contain pr-[12px] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            onScroll={handleOptionsScroll}
          >
          {filteredPhoneOptions.map((option) => (
            <button
              key={`${option.countryCode}-${option.dialCode}`}
              type="button"
              role="option"
              disabled={disabled}
              aria-selected={
                option.countryCode === resolvedPhoneOption.countryCode &&
                option.dialCode === resolvedPhoneOption.dialCode
              }
              className={clsx(
                "grid h-[35px] shrink-0 grid-cols-[20px_40px_minmax(0,1fr)] items-center gap-[2px] rounded-[8px] px-[8px] text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-10)]",
                option.countryCode === resolvedPhoneOption.countryCode &&
                  option.dialCode === resolvedPhoneOption.dialCode
                  ? "bg-[var(--color-neutral-200)]"
                  : !disabled && "hover:bg-[var(--color-neutral-200)]",
                disabled && "cursor-not-allowed",
              )}
              onClick={() => handlePhoneOptionSelection(option)}
            >
              <Flag
                countryCode={option.countryCode}
                size="20px"
                title={option.label}
                useSvg
                loading="lazy"
              />
              <span className="text-body-4 whitespace-nowrap text-[var(--color-text-300)]">
                {option.dialCode}
              </span>
              <span
                className="text-body-4 min-w-0 truncate text-[var(--color-text-200)]"
                title={option.label}
              >
                {option.abbreviation}
              </span>
            </button>
          ))}
          {filteredPhoneOptions.length === 0 ? (
            <div className="flex h-[35px] shrink-0 items-center px-[8px] text-body-4 text-[var(--color-text-100)]">
              Sin coincidencias
            </div>
          ) : null}
          </div>
          {phoneScrollMetrics.length < 1 ? (
            <ScrollBar
              height={152}
              length={phoneScrollMetrics.length}
              position={phoneScrollMetrics.position}
              interactive={!disabled}
              onPositionChange={handleScrollPositionChange}
              aria-label="Desplazar países"
              className="absolute right-0 top-[8px]"
              trackContainerClassName="bg-transparent"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
