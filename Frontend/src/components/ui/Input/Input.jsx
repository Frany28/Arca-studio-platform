import { useEffect, useId, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import Flag from "../../Flag.jsx";
import Tag from "../Tag/Tag.jsx";
import Label from "../Label/Label.jsx";
import HintText from "../HintText/HintText.jsx";
import ScrollBar from "../ScrollBar/ScrollBar.jsx";
import Tooltip from "../Tooltip/Tooltip.jsx";
import {
  INPUT_INTERACTIVE_STYLES,
  INPUT_SIZE_STYLES,
  INPUT_STATE_STYLES,
  INPUT_TAG_DEFAULT_ITEMS,
  INPUT_TYPES,
  PHONE_COUNTRY_OPTIONS,
  PASSWORD_REQUIREMENT_RULES,
} from "./inputConfig.js";

function UserIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M10 10C11.933 10 13.5 8.433 13.5 6.5C13.5 4.567 11.933 3 10 3C8.067 3 6.5 4.567 6.5 6.5C6.5 8.433 8.067 10 10 10Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M4.16669 16.1667C4.16669 13.8667 6.78335 12 10 12C13.2167 12 15.8334 13.8667 15.8334 16.1667"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SmsIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M14.1667 17.0833H5.83341C3.33341 17.0833 1.66675 15.8333 1.66675 12.9166V7.08329C1.66675 4.16663 3.33341 2.91663 5.83341 2.91663H14.1667C16.6667 2.91663 18.3334 4.16663 18.3334 7.08329V12.9166C18.3334 15.8333 16.6667 17.0833 14.1667 17.0833Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.1666 7.5L11.5582 9.58333C10.6999 10.2667 9.29158 10.2667 8.43325 9.58333L5.83325 7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeMiterlimit="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M9.58335 15.8333C13.0351 15.8333 15.8334 13.0351 15.8334 9.58333C15.8334 6.13155 13.0351 3.33333 9.58335 3.33333C6.13157 3.33333 3.33335 6.13155 3.33335 9.58333C3.33335 13.0351 6.13157 15.8333 9.58335 15.8333Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.6667 16.6667L15 15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LockIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M5 8.33329V6.66663C5 3.90829 5.83333 1.66663 10 1.66663C14.1667 1.66663 15 3.90829 15 6.66663V8.33329"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10.0001 15.4167C11.1507 15.4167 12.0834 14.4839 12.0834 13.3333C12.0834 12.1827 11.1507 11.25 10.0001 11.25C8.84949 11.25 7.91675 12.1827 7.91675 13.3333C7.91675 14.4839 8.84949 15.4167 10.0001 15.4167Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.1667 18.3334H5.83341C2.50008 18.3334 1.66675 17.5 1.66675 14.1667V12.5C1.66675 9.16671 2.50008 8.33337 5.83341 8.33337H14.1667C17.5001 8.33337 18.3334 9.16671 18.3334 12.5V14.1667C18.3334 17.5 17.5001 18.3334 14.1667 18.3334Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EyeIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M12.1083 10C12.1083 11.1646 11.1646 12.1083 10 12.1083C8.83538 12.1083 7.89166 11.1646 7.89166 10C7.89166 8.83537 8.83538 7.89166 10 7.89166C11.1646 7.89166 12.1083 8.83537 12.1083 10Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M17.2417 9.99999C16.275 12.9167 13.4167 15 10 15C6.58337 15 3.72504 12.9167 2.75837 9.99999C3.72504 7.08332 6.58337 5 10 5C13.4167 5 16.275 7.08332 17.2417 9.99999Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HelpIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M10 18.3333C14.6024 18.3333 18.3333 14.6024 18.3333 10C18.3333 5.39762 14.6024 1.66666 10 1.66666C5.39763 1.66666 1.66667 5.39762 1.66667 10C1.66667 14.6024 5.39763 18.3333 10 18.3333Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M7.57501 7.50001C7.77085 6.94384 8.15715 6.4749 8.66546 6.17783C9.17377 5.88076 9.77094 5.77475 10.3499 5.87864C10.9289 5.98253 11.4525 6.28952 11.8282 6.74544C12.2038 7.20137 12.4074 7.77594 12.4025 8.36816C12.4025 10.0417 9.89168 10.8333 9.89168 10.8333"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 14.1667H10.0083"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronDownIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M5 7.5L10 12.5L15 7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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

function getDefaultLeftIcon(type) {
  if (type === "Search bar") {
    return <SearchIcon className="size-5" />;
  }

  if (type === "Password") {
    return <LockIcon className="size-5" />;
  }

  if (type === "Tags") {
    return <UserIcon className="size-5" />;
  }

  return <SmsIcon className="size-5" />;
}

function getDefaultRightIcon(type, passwordVisible) {
  if (type === "Password") {
    return <EyeIcon className="size-5" data-visible={passwordVisible} />;
  }

  if (type === "Search bar" || type === "Tags") {
    return null;
  }

  return <HelpIcon className="size-5" />;
}

function hasTextValue(value) {
  if (value == null) {
    return false;
  }

  return String(value).trim().length > 0;
}

function normalizeTagSearchText(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

function getPhoneDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeDialCode(value) {
  const digits = getPhoneDigits(value);

  if (!digits) {
    return "+";
  }

  return `+${digits}`;
}

function getVerticalScrollMetrics(element) {
  if (!element) return { length: 1, position: 0 };
  const maxScroll = Math.max(element.scrollHeight - element.clientHeight, 0);
  return {
    length: Math.min(element.clientHeight / Math.max(element.scrollHeight, 1), 1),
    position: maxScroll > 0 ? element.scrollTop / maxScroll : 0,
  };
}

function formatPhoneNumber(value, option) {
  const digits = getPhoneDigits(value);
  const mask = option?.mask ?? "(###) ####-####";

  if (!digits) {
    return "";
  }

  let digitIndex = 0;
  let output = "";

  for (const character of mask) {
    if (character === "#") {
      if (digitIndex >= digits.length) {
        break;
      }

      output += digits[digitIndex];
      digitIndex += 1;
      continue;
    }

    if (digitIndex < digits.length) {
      output += character;
    }
  }

  return output;
}

function createTagFromText(value, fallbackIndex = 0) {
  const label = String(value ?? "").trim();

  if (!label) {
    return null;
  }

  return {
    id: `tag-custom-${label.toLowerCase().replace(/\s+/g, "-")}-${fallbackIndex}`,
    label,
    avatar: true,
    closeIcon: true,
    avatarText: label.charAt(0).toUpperCase() || String(fallbackIndex + 1),
  };
}

function normalizeTagItem(tag, fallbackId) {
  return {
    id: tag.id ?? fallbackId,
    avatar: true,
    closeIcon: true,
    ...tag,
  };
}

function InputField({
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
  const [selectedTags, setSelectedTags] = useState(() =>
    Array.isArray(tags)
      ? tags.map((tag, index) => normalizeTagItem(tag, `tag-selected-${index}`))
      : [],
  );
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
  const tagFieldScrollRef = useRef(null);

  const resolvedSize = INPUT_SIZE_STYLES[size] ? size : "S";
  const resolvedType = INPUT_TYPES[type] ? type : "Default input";
  const baseState = disabled ? "Disabled" : state;
  const sizing = INPUT_SIZE_STYLES[resolvedSize];
  const typeConfig = INPUT_TYPES[resolvedType];
  const isControlled = value !== undefined;
  const fieldValue = isControlled ? value : internalValue;

  const tagsAreControlled = typeof onTagsChange === "function";
  const visibleTags =
    resolvedType === "Tags" && tagsAreControlled ? tags : selectedTags;
  const normalizedVisibleTags = Array.isArray(visibleTags) ? visibleTags : [];
  const visibleTagIds = normalizedVisibleTags
    .map((tag, index) => String(tag.id ?? `${tag.label}-${index}`))
    .join("|");
  const selectedTagIds = new Set(
    normalizedVisibleTags.map((tag) => String(tag.id)),
  );
  const normalizedTagOptions = Array.isArray(tagOptions)
    ? tagOptions
        .map((tag, index) => normalizeTagItem(tag, `tag-option-${index}`))
        .filter((tag) => !selectedTagIds.has(String(tag.id)))
    : [];
  const hasSelectedTags =
    resolvedType === "Tags" && normalizedVisibleTags.length > 0;
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

  const currentValue = fieldValue ?? "";
  const isFilled =
    hasTextValue(currentValue) ||
    resolvedState === "Filled" ||
    hasSelectedTags;
  const showTags = resolvedType === "Tags" && normalizedVisibleTags.length > 0;
  const showTagsInsideField =
    resolvedType === "Tags" &&
    (["Filled", "Error"].includes(resolvedState) ||
      (baseState === "Default" && isFocused)) &&
    showTags;
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
  const resolvedPlaceholder =
    resolvedType === "Phone number"
      ? placeholder ?? resolvedPhoneOption?.placeholder ?? typeConfig.placeholder
      : placeholder ?? typeConfig.placeholder;

  useEffect(() => {
    if (!isPhoneMenuOpen) return undefined;
    const frameId = window.requestAnimationFrame(() => {
      setPhoneScrollMetrics(getVerticalScrollMetrics(phoneOptionsScrollRef.current));
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [filteredPhoneOptions.length, isPhoneMenuOpen]);

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
  const passwordStrengthState = disabled
    ? "Disabled"
    : passwordProgressCount === 0
      ? "Default"
      : passwordProgressCount >= (passwordRequirementItems?.length ?? 0)
        ? "Success"
        : "Error";

  const handleRightIconClick = () => {
    if (resolvedType === "Password" && !disabled) {
      setPasswordVisible((current) => !current);
    }

    onClickRightIcon?.();
  };

  const handleChange = (event) => {
    if (resolvedType === "Tags") {
      if (!isControlled) {
        setInternalValue(event.target.value);
      }

      onChange?.(event);
      return;
    }

    if (resolvedType === "Phone number") {
      const formattedValue = formatPhoneNumber(
        event.target.value,
        resolvedPhoneOption,
      );

      if (!isControlled) {
        setInternalValue(formattedValue);
      }

      event.target.value = formattedValue;
      onChange?.(event);
      return;
    }

    if (!isControlled) {
      setInternalValue(event.target.value);
    }

    onChange?.(event);
  };

  useEffect(() => {
    if (!isPhoneMenuOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!phoneMenuRef.current?.contains(event.target)) {
        setIsPhoneMenuOpen(false);
      }
    };

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

  const filteredSelectableTags = normalizedTagOptions.filter((option) => {
    const query = normalizeTagSearchText(currentValue);

    if (!query) {
      return true;
    }

    return normalizeTagSearchText(option.label).includes(query);
  });
  const resolvedMaxVisibleTagOptions = Number.isFinite(maxVisibleTagOptions)
    ? Math.max(0, Math.floor(maxVisibleTagOptions))
    : 3;
  const visibleSelectableTags = filteredSelectableTags.slice(
    0,
    resolvedMaxVisibleTagOptions,
  );
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

  useEffect(() => {
    if (resolvedType !== "Tags" || !tagFieldScrollRef.current) {
      return undefined;
    }

    const frameId = requestAnimationFrame(() => {
      tagFieldScrollRef.current?.scrollTo({ left: 0 });
    });

    return () => cancelAnimationFrame(frameId);
  }, [resolvedType, visibleTagIds]);

  const handleTagSelection = () => {
    const nextTag =
      visibleSelectableTags.find((option) => {
        const optionLabel = normalizeTagSearchText(option.label);
        const query = normalizeTagSearchText(currentValue);

        return (
          query &&
          optionLabel.includes(query)
        );
      }) ?? createTagFromText(currentValue, normalizedVisibleTags.length);

    if (!nextTag || disabled) {
      return;
    }

    const exists = normalizedVisibleTags.some((tag) => {
      const currentId = String(tag.id ?? "");
      const nextId = String(nextTag.id ?? "");
      const currentLabel = normalizeTagSearchText(tag.label);
      const nextLabel = normalizeTagSearchText(nextTag.label);

      return currentId === nextId || currentLabel === nextLabel;
    });

    if (exists) {
      return;
    }

    const nextTags = [...normalizedVisibleTags, nextTag];
    if (!tagsAreControlled) {
      setSelectedTags(nextTags);
    }
    onTagsChange?.(nextTags);

    if (!isControlled) {
      setInternalValue("");
    }
  };

  const handleRemoveTag = (tagId) => {
    if (disabled) {
      return;
    }

    const nextTags = normalizedVisibleTags.filter((tag) => tag.id !== tagId);
    if (!tagsAreControlled) {
      setSelectedTags(nextTags);
    }
    onTagsChange?.(nextTags);

    requestAnimationFrame(() => resolvedInputRef.current?.focus());
  };

  const handleTagOptionSelection = (tag) => {
    if (disabled) {
      return;
    }

    if (onTagOptionSelect) {
      onTagOptionSelect(tag);
      return;
    }

    const nextTags = [...normalizedVisibleTags, tag];
    if (!tagsAreControlled) {
      setSelectedTags(nextTags);
    }
    onTagsChange?.(nextTags);

    if (!isControlled) {
      setInternalValue("");
    }
  };

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

  const handleInputKeyDown = (event) => {
    if (resolvedType === "Tags") {
      if (
        (event.key === "Enter" || event.key === ",") &&
        hasTextValue(currentValue)
      ) {
        event.preventDefault();
        handleTagSelection();
      } else if (
        event.key === "Backspace" &&
        !hasTextValue(currentValue) &&
        normalizedVisibleTags.length > 0
      ) {
        event.preventDefault();
        handleRemoveTag(
          normalizedVisibleTags[normalizedVisibleTags.length - 1].id,
        );
      }
    }

    if (!event.defaultPrevented) {
      onKeyDown?.(event);
    }
  };

  const content = (
    <div
      className={clsx(
        "flex w-full items-center rounded-[var(--radius-2)] transition-[border-color,box-shadow,background-color] duration-150",
        resolvedType === "Phone number" ? "overflow-visible" : "overflow-hidden",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
        sizing.shell,
        stateStyles.shell,
        baseState === "Default" && !disabled && INPUT_INTERACTIVE_STYLES,
      )}
      data-state={resolvedState.toLowerCase()}
      onMouseEnter={() => {
        if (!disabled && baseState === "Default") {
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
              onMouseDown={(event) => {
                if (disabled || event.target.closest("input, button")) return;
                event.preventDefault();
                setIsPhoneMenuOpen(true);
                phonePrefixInputRef.current?.focus();
              }}
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
                  onFocus={() => setIsPhoneMenuOpen(true)}
                  onChange={(event) => {
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
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || !isPhoneMenuOpen) return;

                    const firstVisibleOption = filteredPhoneOptions[0];
                    if (!firstVisibleOption) return;

                    event.preventDefault();
                    handlePhoneOptionSelection(firstVisibleOption);
                  }}
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
                onClick={() => setIsPhoneMenuOpen((current) => !current)}
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
                  onScroll={(event) => setPhoneScrollMetrics(getVerticalScrollMetrics(event.currentTarget))}
                >
                {filteredPhoneOptions.map((option) => (
                  <button
                    key={`${option.countryCode}-${option.dialCode}`}
                    type="button"
                    role="option"
                    aria-selected={
                      option.countryCode === resolvedPhoneOption.countryCode &&
                      option.dialCode === resolvedPhoneOption.dialCode
                    }
                    className={clsx(
                      "grid h-[35px] shrink-0 grid-cols-[20px_40px_minmax(0,1fr)] items-center gap-[2px] rounded-[8px] px-[8px] text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-10)]",
                      option.countryCode === resolvedPhoneOption.countryCode &&
                        option.dialCode === resolvedPhoneOption.dialCode
                        ? "bg-[var(--color-neutral-200)]"
                        : "hover:bg-[var(--color-neutral-200)]",
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
                    interactive
                    onPositionChange={(nextPosition) => {
                      const container = phoneOptionsScrollRef.current;
                      if (!container) return;
                      const maxScroll = Math.max(container.scrollHeight - container.clientHeight, 0);
                      container.scrollTop = maxScroll * nextPosition;
                      setPhoneScrollMetrics(getVerticalScrollMetrics(container));
                    }}
                    aria-label="Desplazar países"
                    className="absolute right-0 top-[8px]"
                    trackContainerClassName="bg-transparent"
                  />
                ) : null}
              </div>
            ) : null}
          </div>
          <div className={clsx("flex min-w-0 flex-1 items-center gap-[8px]", sizing.field)}>
            <input
              ref={resolvedInputRef}
              id={inputId}
              type={inputType}
              disabled={disabled}
              value={fieldValue}
              placeholder={resolvedPlaceholder}
              aria-describedby={resolvedAriaDescribedBy}
              aria-invalid={resolvedAriaInvalid}
              className={clsx(
                "text-body-3 min-w-0 flex-1 border-0 bg-transparent tracking-[-0.5px] outline-none",
                disabled ? "cursor-not-allowed" : "cursor-text",
                isFilled ? stateStyles.inputText : stateStyles.placeholder,
                stateStyles.placeholder,
                inputClassName,
              )}
              onFocus={(event) => {
                setIsFocused(true);
                onFocus?.(event);
              }}
              onBlur={(event) => {
                setIsFocused(false);
                onBlur?.(event);
              }}
              onChange={handleChange}
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
                  disabled ? "cursor-not-allowed" : "cursor-pointer",
                )}
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={handleRightIconClick}
                disabled={disabled}
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
            {showTagsInsideField
              ? normalizedVisibleTags.map((tag, index) => (
                  <Tag
                    key={tag.id ?? `${tag.label}-${index}`}
                    size={sizing.tagSize}
                    label={tag.label}
                    avatar={tag.avatar ?? true}
                    avatarText={tag.avatarText ?? "A"}
                    avatarSrc={tag.avatarSrc ?? ""}
                    avatarTheme={tag.avatarTheme ?? "Neutral"}
                    avatarContent={tag.avatarContent ?? "Text"}
                    closeIcon={tag.closeIcon ?? true}
                    count={false}
                    className="max-w-full"
                    disabled={disabled}
                    onMouseDown={(event) => event.preventDefault()}
                    onRemove={() => handleRemoveTag(tag.id)}
                  />
                ))
              : null}

            <input
              ref={resolvedInputRef}
              id={inputId}
              type={inputType}
              disabled={disabled}
              value={fieldValue}
              placeholder={showTagsInsideField ? "" : resolvedPlaceholder}
              aria-describedby={resolvedAriaDescribedBy}
              aria-invalid={resolvedAriaInvalid}
              className={clsx(
                "text-body-3 min-w-0 flex-1 border-0 bg-transparent tracking-[-0.5px] outline-none",
                showTagsInsideField && "min-w-[48px]",
                disabled ? "cursor-not-allowed" : "cursor-text",
                isFilled ? stateStyles.inputText : stateStyles.placeholder,
                stateStyles.placeholder,
                inputClassName,
              )}
              onFocus={(event) => {
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
                disabled ? "cursor-not-allowed" : "cursor-pointer",
              )}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={handleRightIconClick}
              disabled={disabled}
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
        <div
          id={tagGroupId}
          className={clsx(
            "flex h-[22px] w-full flex-nowrap items-center gap-[4px] overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
            showTagGroupAsOverlay &&
              "absolute left-0 top-full z-[110] mt-[4px] rounded-[var(--radius-2)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e1)]",
          )}
          role="group"
          aria-label={
            tagGroupAriaLabel ?? `${label}: opciones y elementos seleccionados`
          }
        >
          {showSelectedTagsBelow
            ? normalizedVisibleTags.map((tag, index) => (
                <Tag
                  key={tag.id ?? `${tag.label}-${index}`}
                  size={sizing.tagSize}
                  label={tag.label}
                  avatar={tag.avatar ?? true}
                  avatarText={tag.avatarText ?? "A"}
              avatarSrc={tag.avatarSrc ?? ""}
              avatarTheme={tag.avatarTheme ?? "Neutral"}
              avatarContent={tag.avatarContent ?? "Text"}
                  closeIcon={tag.closeIcon ?? true}
                  count={false}
                  disabled={disabled}
                  onMouseDown={(event) => event.preventDefault()}
                  onRemove={() => handleRemoveTag(tag.id)}
                />
              ))
            : null}
          {showTagOptionsOnFocus
            ? visibleSelectableTags.map((tag, index) => (
                <Tag
                  key={tag.id ?? `${tag.label}-option-${index}`}
                  size={sizing.tagSize}
                  label={tag.label}
                  avatar={tag.avatar ?? true}
                  avatarText={tag.avatarText ?? "A"}
                  avatarSrc={tag.avatarSrc ?? ""}
                  avatarTheme={tag.avatarTheme ?? "Neutral"}
                  avatarContent={tag.avatarContent ?? "Text"}
                  closeIcon={false}
                  count={false}
                  disabled={disabled}
                  interactive
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleTagOptionSelection(tag)}
                />
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}

// La presentación control integra campos en composiciones existentes sin añadir wrappers.
// Conserva atributos HTML, eventos y referencias; field mantiene las variantes de formulario.
function Input({ presentation = "field", ...props }) {
  if (presentation === "control") {
    const { htmlType = "text", inputRef, ...attributes } = props;
    return <input ref={inputRef} type={htmlType} {...attributes} />;
  }
  return <InputField {...props} />;
}

export default Input;
