/* Renderiza campos de entrada reutilizables con variantes de texto, teléfono, búsqueda, contraseña y tags. */
import { useId, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import usePhoneInput from "./phone/usePhoneInput.js";
import PhoneCountrySelector from "./phone/PhoneCountrySelector.jsx";
import useInputTags from "./tags/useInputTags.js";
import InputTagGroup from "./tags/InputTagGroup.jsx";
import Label from "../Label/Label.jsx";
import HintText from "../HintText/HintText.jsx";
import Tooltip from "../Tooltip/Tooltip.jsx";
import { getDefaultLeftIcon, getDefaultRightIcon } from "./InputIcons.jsx";
import {
  INPUT_INTERACTIVE_STYLES,
  INPUT_SIZE_STYLES,
  INPUT_STATE_STYLES,
  INPUT_TAG_DEFAULT_ITEMS,
  INPUT_TYPES,
  PHONE_COUNTRY_OPTIONS,
  PASSWORD_REQUIREMENT_RULES,
} from "./inputConfig.js";

/**
 * Presenta la marca de pago decorativa conservando sus estilos en ambos temas.
 * @param {object} props Clase de tamaño y marca visible.
 * @returns {import("react").ReactElement} Badge sin semántica interactiva.
 */
function PaymentBadge({ className, brand = "VISA" }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center rounded-[4px] border font-semibold tracking-[0.5px]",
        "border-[#E1E4EA] bg-white text-[#1A1F71]",
        "dark:border-[var(--color-neutral-300)] dark:bg-[var(--color-neutral-200)] dark:text-[var(--color-neutral-1000)]",
        className,
      )}
      aria-hidden="true"
    >
      {brand}
    </span>
  );
}

/**
 * Determina si el valor común contiene texto para el estado Filled y el teclado de tags.
 * @param {*} value Valor controlado o interno del campo.
 * @returns {boolean} Si existe texto después de quitar espacios exteriores.
 */
function hasTextValue(value) {
  if (value == null) {
    return false;
  }

  return String(value).trim().length > 0;
}

/**
 * Compone las variantes manteniendo el valor común, foco y estado visual del campo.
 * value !== undefined controla el valor; defaultValue solo inicializa el estado interno.
 * Teléfono y tags conservan sus contratos específicos en hooks independientes.
 * @param {object} props API pública del Input, callbacks y atributos del campo nativo.
 * @param {boolean} props.required Obligatoriedad visual y nativa; conserva true por defecto.
 * @param {boolean} props.disabled Bloqueo efectivo, también activado por state="Disabled".
 * @returns {import("react").ReactElement} Campo accesible con sus adornos y ayudas.
 */
function Input({
  className,
  id,
  label = "Label",
  hintText = "Texto de ayuda para los usuarios",
  placeholder,
  size = "S",
  state = "Default",
  type = "Default input",
  showLabel = true,
  showHint = true,
  showLeftIcon = true,
  showRightIcon = true,
  showLabelInfo = true,
  information: legacyInformation,
  required = true,
  leftIcon = null,
  rightIcon = null,
  rightIconAriaLabel,
  paymentIcon = false,
  paymentBrand = "VISA",
  countryCode = "US",
  countryPrefix = "+1",
  phoneOptions = PHONE_COUNTRY_OPTIONS,
  tags = [],
  tagOptions = INPUT_TAG_DEFAULT_ITEMS,
  tagGroupAriaLabel,
  tagGroupPlacement = "inline",
  showTagOptionsOnFocus = false,
  maxVisibleTagOptions = 3,
  showPasswordStrength = false,
  passwordRequirements,
  passwordHintTitle,
  disabled = false,
  value,
  defaultValue,
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  onTagsChange,
  onTagOptionSelect,
  onPhoneCountryChange,
  onClickRightIcon,
  inputRef,
  inputClassName,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  style,
  ...props
}) {
  // Prop heredada de Label sin efecto en Input: se consume para no enviarla al DOM.
  void legacyInformation;
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const tagGroupId = `${inputId}-tags`;
  const internalInputRef = useRef(null);
  const resolvedInputRef = inputRef ?? internalInputRef;
  const [isFocused, setIsFocused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");

  const resolvedSize = INPUT_SIZE_STYLES[size] ? size : "S";
  const resolvedType = INPUT_TYPES[type] ? type : "Default input";
  // Ambas entradas públicas expresan el mismo bloqueo funcional y visual.
  const isDisabled = disabled || state === "Disabled";
  const baseState = isDisabled ? "Disabled" : state;
  const sizing = INPUT_SIZE_STYLES[resolvedSize];
  const typeConfig = INPUT_TYPES[resolvedType];
  const isControlled = value !== undefined;
  const fieldValue = isControlled ? value : internalValue;
  const phone = usePhoneInput({
    resolvedType, countryCode, countryPrefix, phoneOptions, isControlled,
    setInternalValue, onChange, onPhoneCountryChange, disabled: isDisabled,
  });
  const { resolvedPhoneOption } = phone;

  const currentValue = fieldValue ?? "";
  const hasInputText = hasTextValue(currentValue);
  const inputTags = useInputTags({
    resolvedType, tags, tagOptions, currentValue, hasInputText, maxVisibleTagOptions,
    isControlled, setInternalValue, disabled: isDisabled, onTagsChange, onTagOptionSelect,
    onKeyDown, resolvedInputRef,
  });
  const {
    normalizedVisibleTags, hasSelectedTags, visibleSelectableTags, tagFieldScrollRef,
    handleRemoveTag, handleTagOptionSelection, handleInputKeyDown,
  } = inputTags;
  const resolvedState =
    baseState === "Default"
      ? resolvedType === "Tags"
        ? isFocused
          ? "Focused"
          : hasSelectedTags
            ? "Filled"
            : isHovered
              ? "Hover"
              : "Default"
        : isFocused
          ? "Focused"
          : isHovered
            ? "Hover"
            : baseState
      : baseState;
  const stateStyles = INPUT_STATE_STYLES[resolvedState];

  const isFilled =
    hasInputText ||
    resolvedState === "Filled" ||
    hasSelectedTags;
  const showTags = resolvedType === "Tags" && normalizedVisibleTags.length > 0;
  const showTagsInsideField =
    resolvedType === "Tags" &&
    (["Filled", "Error"].includes(resolvedState) ||
      (baseState === "Default" && isFocused)) &&
    showTags;
  const resolvedPlaceholder =
    resolvedType === "Phone number"
      ? placeholder ?? resolvedPhoneOption?.placeholder ?? typeConfig.placeholder
      : placeholder ?? typeConfig.placeholder;

  const inputType = useMemo(() => {
    if (resolvedType !== "Password") {
      return typeConfig.inputType;
    }

    return passwordVisible ? "text" : "password";
  }, [passwordVisible, resolvedType, typeConfig.inputType]);

  const leadingIcon = leftIcon ?? getDefaultLeftIcon(resolvedType);
  const trailingIcon =
    rightIcon ?? getDefaultRightIcon(resolvedType, passwordVisible);
  const trailingIconLabel =
    rightIconAriaLabel ||
    (resolvedType === "Password"
      ? passwordVisible
        ? "Ocultar contraseña"
        : "Mostrar contraseña"
      : `Información sobre ${label}`);
  const passwordRequirementItems =
    resolvedType === "Password" && showPasswordStrength
      ? (passwordRequirements ?? PASSWORD_REQUIREMENT_RULES).map(
          (requirement) => ({
            label: requirement.label,
            met: requirement.test ? requirement.test(String(currentValue)) : false,
          }),
        )
      : passwordRequirements;
  const passwordProgressCount = Array.isArray(passwordRequirementItems)
    ? passwordRequirementItems.filter((item) => item.met).length
    : 0;
  const passwordStrengthState = isDisabled
    ? "Disabled"
    : passwordProgressCount === 0
      ? "Default"
      : passwordProgressCount >= (passwordRequirementItems?.length ?? 0)
        ? "Success"
        : "Error";

  /**
   * Alterna la visibilidad de password antes de notificar la acción lateral.
   * El botón conserva el foco del campo mediante su mousedown existente.
   * @returns {void}
   */
  const handleRightIconClick = () => {
    if (isDisabled) return;
    if (resolvedType === "Password") {
      setPasswordVisible((current) => !current);
    }

    onClickRightIcon?.();
  };

  /**
   * Delega el formato telefónico y actualiza los demás valores antes de notificar.
   * Los campos controlados esperan el nuevo valor del consumidor sin escribir estado interno.
   * @param {object} event Evento original del campo nativo.
   * @returns {void}
   */
  const handleChange = (event) => {
    if (isDisabled) return;
    if (resolvedType === "Phone number") {
      phone.handleChange(event);
      return;
    }

    if (!isControlled) {
      setInternalValue(event.target.value);
    }

    onChange?.(event);
  };

  const showSelectedTagsBelow =
    resolvedType === "Tags" &&
    resolvedState === "Focused" &&
    showTags &&
    !showTagsInsideField;
  const showTagsBelowField =
    showSelectedTagsBelow ||
    (resolvedType === "Tags" &&
      resolvedState === "Focused" &&
      showTagOptionsOnFocus &&
      visibleSelectableTags.length > 0);
  const showTagGroupAsOverlay =
    resolvedType === "Tags" && tagGroupPlacement === "overlay";
  const showResolvedHint =
    showHint && !(resolvedType === "Tags" && resolvedState === "Focused");
  const resolvedAriaDescribedBy = [
    ariaDescribedBy,
    showResolvedHint ? hintId : null,
  ]
    .filter(Boolean)
    .join(" ") || undefined;
  const resolvedAriaInvalid =
    ariaInvalid ?? (resolvedState === "Error" ? true : undefined);

  const content = (
    <div
      className={clsx(
        "flex w-full items-center rounded-[var(--radius-2)] transition-[border-color,box-shadow,background-color] duration-150",
        resolvedType === "Phone number" ? "overflow-visible" : "overflow-hidden",
        isDisabled ? "cursor-not-allowed" : "cursor-pointer",
        sizing.shell,
        stateStyles.shell,
        baseState === "Default" && !isDisabled && INPUT_INTERACTIVE_STYLES,
      )}
      data-state={resolvedState.toLowerCase()}
      onMouseEnter={() => {
        if (!isDisabled && baseState === "Default") {
          setIsHovered(true);
        }
      }}
      onMouseLeave={() => setIsHovered(false)}
    >
      {resolvedType === "Phone number" ? (
        <div
          className={clsx(
            "flex min-w-0 flex-1 items-center rounded-[inherit]",
            stateStyles.contentBorder,
          )}
        >
          <PhoneCountrySelector
            inputId={inputId}
            disabled={isDisabled}
            sizing={sizing}
            stateStyles={stateStyles}
            phone={phone}
          />
          <div className={clsx("flex min-w-0 flex-1 items-center gap-[8px]", sizing.field)}>
            <input
              ref={resolvedInputRef}
              id={inputId}
              type={inputType}
              required={required}
              disabled={isDisabled}
              value={fieldValue}
              placeholder={resolvedPlaceholder}
              aria-describedby={resolvedAriaDescribedBy}
              aria-invalid={resolvedAriaInvalid}
              className={clsx(
                "text-body-3 min-w-0 flex-1 border-0 bg-transparent tracking-[-0.5px] outline-none",
                isDisabled ? "cursor-not-allowed" : "cursor-text",
                isFilled ? stateStyles.inputText : stateStyles.placeholder,
                stateStyles.placeholder,
                inputClassName,
              )}
              onFocus={(event) => {
                if (isDisabled) return;
                setIsFocused(true);
                onFocus?.(event);
              }}
              onBlur={(event) => {
                setIsFocused(false);
                onBlur?.(event);
              }}
              onChange={handleChange}
              onKeyDown={handleInputKeyDown}
              {...props}
            />
            {showRightIcon && trailingIcon ? (
              <Tooltip
                asChild
                portal
                showTip
                text={trailingIconLabel}
                tipPosition="Top center"
              >
                <button
                type="button"
                className={clsx(
                  "inline-flex size-5 shrink-0 items-center justify-center",
                  stateStyles.trailingIcon,
                  isDisabled ? "cursor-not-allowed" : "cursor-pointer",
                )}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={handleRightIconClick}
                disabled={isDisabled}
                aria-label={trailingIconLabel}
              >
                {trailingIcon}
                </button>
              </Tooltip>
            ) : null}
          </div>
        </div>
      ) : (
        <div
          className={clsx(
            "flex min-w-0 flex-1 items-center gap-[8px] rounded-[inherit]",
            sizing.field,
            stateStyles.contentBorder,
          )}
        >
          {showLeftIcon && leadingIcon ? (
            <span
              className={clsx(
                "inline-flex size-5 shrink-0 items-center justify-center",
                stateStyles.leadingIcon,
              )}
            >
              {leadingIcon}
            </span>
          ) : null}

          <div
            ref={resolvedType === "Tags" ? tagFieldScrollRef : undefined}
            className={clsx(
              "flex min-w-0 flex-1 items-center gap-[4px]",
              resolvedType === "Tags"
                ? "flex-nowrap overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                : "flex-wrap",
            )}
          >
            {showTagsInsideField ? (
              <InputTagGroup
                inline
                normalizedVisibleTags={normalizedVisibleTags}
                sizing={sizing}
                disabled={isDisabled}
                handleRemoveTag={handleRemoveTag}
              />
            ) : null}

            <input
              ref={resolvedInputRef}
              id={inputId}
              type={inputType}
              required={required}
              disabled={isDisabled}
              value={fieldValue}
              placeholder={showTagsInsideField ? "" : resolvedPlaceholder}
              aria-describedby={resolvedAriaDescribedBy}
              aria-invalid={resolvedAriaInvalid}
              className={clsx(
                "text-body-3 min-w-0 flex-1 border-0 bg-transparent tracking-[-0.5px] outline-none",
                showTagsInsideField && "min-w-[48px]",
                isDisabled ? "cursor-not-allowed" : "cursor-text",
                isFilled ? stateStyles.inputText : stateStyles.placeholder,
                stateStyles.placeholder,
                inputClassName,
              )}
              onFocus={(event) => {
                if (isDisabled) return;
                setIsFocused(true);
                onFocus?.(event);
              }}
              onBlur={(event) => {
                setIsFocused(false);
                onBlur?.(event);
              }}
              onKeyDown={handleInputKeyDown}
              onChange={handleChange}
              {...props}
            />
          </div>

          {paymentIcon ? (
            <PaymentBadge className={sizing.paymentBadge} brand={paymentBrand} />
          ) : null}

          {showRightIcon && trailingIcon ? (
            <Tooltip
              asChild
              portal
              showTip
              text={trailingIconLabel}
              tipPosition="Top center"
            >
              <button
              type="button"
              className={clsx(
                "inline-flex size-5 shrink-0 items-center justify-center",
                stateStyles.trailingIcon,
                isDisabled ? "cursor-not-allowed" : "cursor-pointer",
              )}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={handleRightIconClick}
              disabled={isDisabled}
              aria-label={trailingIconLabel}
            >
              {trailingIcon}
              </button>
            </Tooltip>
          ) : null}
        </div>
      )}
    </div>
  );

  return (
    <div
      className={clsx(
        "flex w-full max-w-[320px] flex-col items-start gap-[8px]",
        showTagGroupAsOverlay && "relative",
        className,
      )}
      style={style}
      data-state={resolvedState.toLowerCase()}
    >
      {showLabel ? (
        <Label
          htmlFor={inputId}
          label={label}
          required={required}
          information={showLabelInfo}
          state={stateStyles.labelState}
        />
      ) : null}

      {content}

      {showResolvedHint ? (
        <HintText
          id={hintId}
          state={stateStyles.hintState}
          hintText={hintText}
          className="w-full"
          role={resolvedState === "Error" ? "alert" : undefined}
        />
      ) : null}

      {showPasswordStrength ? (
        <HintText
          type="Password"
          state={passwordStrengthState}
          passwordTitle={passwordHintTitle}
          requirements={passwordRequirementItems}
          passwordProgress={passwordProgressCount}
          className="w-full"
        />
      ) : null}

      {showTagsBelowField ? (
        <InputTagGroup
          normalizedVisibleTags={normalizedVisibleTags}
          visibleSelectableTags={visibleSelectableTags}
          sizing={sizing}
          disabled={isDisabled}
          handleRemoveTag={handleRemoveTag}
          handleTagOptionSelection={handleTagOptionSelection}
          tagGroupId={tagGroupId}
          tagGroupAriaLabel={tagGroupAriaLabel}
          label={label}
          showSelectedTagsBelow={showSelectedTagsBelow}
          showTagOptionsOnFocus={showTagOptionsOnFocus}
          showTagGroupAsOverlay={showTagGroupAsOverlay}
        />
      ) : null}
    </div>
  );
}

export default Input;
