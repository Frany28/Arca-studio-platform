import { useEffect, useId, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import Avatar from "../Avatar/Avatar.jsx";
import Checkbox from "../Checkbox/Checkbox.jsx";
import Flag from "../../Flag.jsx";
import {
  DROPDOWN_MENU_DEFAULT_ITEMS,
  DROPDOWN_MENU_DEFAULT_PROPS,
  DROPDOWN_MENU_STATES,
  DROPDOWN_MENU_TYPES,
} from "./dropdownMenuConfig.js";
import { updateDropdownCheckboxItems } from "./dropdownMenuSelection.js";

const DROPDOWN_MENU_NODE_IDS = {
  trigger: {
    Text: {
      Default: "2056:24207",
      Hover: "2056:24216",
      Selected: "2056:24224",
    },
    Icon: {
      Default: "2056:24232",
      Hover: "2061:24743",
      Selected: "2061:24757",
    },
    Checkbox: {
      Default: "2056:24270",
      Hover: "2061:24781",
      Selected: "2061:24792",
    },
    "User profile": {
      Default: "2056:24298",
      Hover: "2056:24298",
      Selected: "2056:24298",
    },
    Flag: {
      Default: "2056:24329",
      Hover: "2056:24329",
      Selected: "2056:24329",
    },
  },
  divider: "2056:24215",
  wrapper: "2056:24358",
  content: "2056:24360",
};

function ArrowDownIcon({ className }) {
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

function GridIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <rect
        x="2.91667"
        y="2.91667"
        width="14.1667"
        height="14.1667"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M10 3.33301V16.6663" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3.33325 9.99967H16.6666"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function getDocumentDarkMode() {
  if (typeof document === "undefined") {
    return false;
  }

  return document.documentElement.classList.contains("dark");
}

function DropdownCheckbox({
  checked = "No",
  visualState = "Default",
  className,
}) {
  const resolvedChecked = visualState === "Selected" ? "Yes" : checked;

  const resolvedState = visualState === "Hover" ? "Hover" : "Default";

  return (
    <Checkbox
      size="S"
      checked={resolvedChecked}
      state={resolvedState}
      interactive={false}
      className={className}
    />
  );
}

function getDefaultMenuItems(type) {
  if (type === "Flag") {
    return [
      { id: "us", label: "Estados Unidos", type: "Flag", countryCode: "US" },
      { id: "ve", label: "Venezuela", type: "Flag", countryCode: "VE" },
      { id: "es", label: "España", type: "Flag", countryCode: "ES" },
      { id: "ar", label: "Argentina", type: "Flag", countryCode: "AR" },
    ];
  }

  if (type === "User profile") {
    return [
      {
        id: "alan",
        label: "Alan Wake",
        supportingText: "@alanwake",
        type: "User profile",
        avatarSrc:
          "https://www.figma.com/api/mcp/asset/51a3a0d7-a97f-48eb-a263-877571497be3",
      },
      {
        id: "saga",
        label: "Saga Anderson",
        supportingText: "@saga",
        type: "User profile",
        avatarSrc:
          "https://www.figma.com/api/mcp/asset/51a3a0d7-a97f-48eb-a263-877571497be3",
      },
      {
        id: "casey",
        label: "Alex Casey",
        supportingText: "@casey",
        type: "User profile",
        avatarSrc:
          "https://www.figma.com/api/mcp/asset/51a3a0d7-a97f-48eb-a263-877571497be3",
      },
    ];
  }

  if (type === "Icon") {
    return [
      { id: "dashboard", label: "Dashboard", type: "Icon" },
      { id: "analytics", label: "Analíticas", type: "Icon" },
      { id: "reports", label: "Reportes", type: "Icon" },
      { id: "settings", label: "Configuración", type: "Icon" },
    ];
  }

  if (type === "Text") {
    return [
      {
        id: "username",
        label: "Etiqueta",
        supportingText: "",
        type: "Text",
      },
      {
        id: "billing",
        label: "Facturación",
        supportingText: "",
        type: "Text",
      },
      {
        id: "support",
        label: "Soporte",
        supportingText: "",
        type: "Text",
      },
    ];
  }

  return DROPDOWN_MENU_DEFAULT_ITEMS;
}

function getResolvedType(type) {
  return DROPDOWN_MENU_TYPES.includes(type) ? type : "Text";
}

function getResolvedState(state, isHovered, isPressed) {
  if (DROPDOWN_MENU_STATES.includes(state)) {
    return state;
  }

  if (isPressed) {
    return "Selected";
  }

  if (isHovered) {
    return "Hover";
  }

  return "Default";
}

function getDefaultRowHeight(type) {
  if (type === "Flag" || type === "User profile") {
    return "h-[40px]";
  }
  return "h-[39px]";
}

function getTriggerTextClasses(type, state) {
  if (type === "Text" && state === "Selected") {
    return {
      label: "text-[var(--color-neutral-100-uniform)]",
      supporting: "text-[var(--color-neutral-100-uniform)]",
      icon: "text-[var(--color-neutral-100-uniform)]",
      arrow: "text-[var(--color-neutral-100-uniform)]",
    };
  }

  if (type === "Icon") {
    if (state === "Selected") {
      return {
        label: "text-[var(--color-text-300)]",
        supporting: "text-[var(--color-text-300)]",
        icon: "text-[var(--color-text-300)]",
        arrow: "text-[var(--color-text-300)]",
      };
    }

    if (state === "Hover") {
      return {
        label: "text-[var(--color-text-200)]",
        supporting: "text-[var(--color-text-200)]",
        icon: "text-[var(--color-text-200)]",
        arrow: "text-[var(--color-text-200)]",
      };
    }

    return {
      label: "text-[var(--color-text-200)]",
      supporting: "text-[var(--color-text-100)]",
      icon: "text-[var(--color-text-100)]",
      arrow: "text-[var(--color-text-100)]",
    };
  }

  if (type === "Checkbox") {
    if (state === "Selected") {
      return {
        label: "text-[var(--color-text-300)]",
        supporting: "text-[var(--color-text-300)]",
        icon: "text-[var(--color-text-300)]",
        arrow: "text-[var(--color-text-300)]",
      };
    }

    if (state === "Hover") {
      return {
        label: "text-[var(--color-text-200)]",
        supporting: "text-[var(--color-text-200)]",
        icon: "text-[var(--color-text-200)]",
        arrow: "text-[var(--color-text-200)]",
      };
    }
  }

  const isSelected = state === "Selected";
  const isHovered = state === "Hover";
  const interactiveColor = isSelected
    ? "text-[var(--color-text-300)]"
    : isHovered
      ? "text-[var(--color-text-200)]"
      : "text-[var(--color-text-100)]";

  return {
    label: isSelected
      ? "text-[var(--color-text-300)]"
      : "text-[var(--color-text-200)]",
    supporting: "text-[var(--color-text-100)]",
    icon:
      type === "Icon"
        ? isSelected
          ? "text-[var(--color-text-300)]"
          : isHovered
            ? "text-[var(--color-text-200)]"
            : "text-[var(--color-text-100)]"
        : interactiveColor,
    arrow: interactiveColor,
  };
}

function TriggerLeading({
  type,
  state,
  checked,
  countryCode,
  avatarSrc,
  label,
}) {
  if (type === "Icon") {
    const { icon } = getTriggerTextClasses(type, state);
    return <GridIcon className={clsx("size-5 shrink-0", icon)} />;
  }

  if (type === "Checkbox") {
    return (
      <DropdownCheckbox
        checked={checked}
        visualState={state}
        className="shrink-0"
      />
    );
  }

  if (type === "User profile") {
    return (
      <Avatar
        size="S"
        theme="Neutral"
        content="Image"
        src={avatarSrc}
        alt={label}
        decorative
      />
    );
  }

  if (type === "Flag") {
    return (
      <Flag
        countryCode={countryCode}
        size="24px"
        title={countryCode}
        useSvg
        loading="lazy"
      />
    );
  }

  return null;
}

function renderMenuItemLeading(
  itemType,
  item,
  fallbackAvatarSrc,
  fallbackCountryCode,
) {
  if (itemType === "Checkbox") {
    return (
      <DropdownCheckbox
        checked={item.checked ?? "No"}
        visualState={item.visualState ?? "Default"}
        className="shrink-0"
      />
    );
  }

  if (itemType === "Icon") {
    const iconState =
      item.visualState === "Selected"
        ? "text-[var(--color-text-300)]"
        : item.visualState === "Hover"
          ? "text-[var(--color-text-200)]"
          : "text-[var(--color-text-100)]";

    return <GridIcon className={clsx("size-5 shrink-0", iconState)} />;
  }

  if (itemType === "User profile") {
    return (
      <Avatar
        size="S"
        theme="Neutral"
        content="Image"
        src={item.avatarSrc ?? fallbackAvatarSrc}
        alt={item.label}
        decorative
      />
    );
  }

  if (itemType === "Flag") {
    return (
      <Flag
        countryCode={item.countryCode ?? fallbackCountryCode}
        size="24px"
        title={item.countryCode ?? fallbackCountryCode}
        useSvg
        loading="lazy"
      />
    );
  }

  return null;
}

function DropdownMenu({
  className,
  triggerClassName,
  triggerWrapperClassName,
  contentClassName,
  itemClassName,
  rowHeightClassName,
  triggerHeightClassName = "h-[39px]",
  triggerPaddingXClassName = "px-[12px]",
  contentPaddingClassName = "px-[8px] pt-[8px] pb-[8px]",
  type = DROPDOWN_MENU_DEFAULT_PROPS.type,
  label = DROPDOWN_MENU_DEFAULT_PROPS.label,
  supportingText = DROPDOWN_MENU_DEFAULT_PROPS.supportingText,
  showDivider = DROPDOWN_MENU_DEFAULT_PROPS.showDivider,
  showContainer = DROPDOWN_MENU_DEFAULT_PROPS.showContainer,
  checked = DROPDOWN_MENU_DEFAULT_PROPS.checked,
  countryCode = DROPDOWN_MENU_DEFAULT_PROPS.countryCode,
  avatarSrc = DROPDOWN_MENU_DEFAULT_PROPS.avatarSrc,
  state,
  open,
  defaultOpen = DROPDOWN_MENU_DEFAULT_PROPS.defaultOpen,
  interactive = DROPDOWN_MENU_DEFAULT_PROPS.interactive,
  disabled = DROPDOWN_MENU_DEFAULT_PROPS.disabled,
  items =DROPDOWN_MENU_DEFAULT_PROPS.items,
  hoveredItemId = DROPDOWN_MENU_DEFAULT_PROPS.hoveredItemId,
  selectedItemId = DROPDOWN_MENU_DEFAULT_PROPS.selectedItemId,
  multiple = false,
  truncateTriggerLabel = DROPDOWN_MENU_DEFAULT_PROPS.truncateTriggerLabel,
  preserveMenuSpace = DROPDOWN_MENU_DEFAULT_PROPS.preserveMenuSpace,
  onOpenChange,
  onItemSelect,
  onItemsChange,
  onClick,
  "aria-label": ariaLabel = DROPDOWN_MENU_DEFAULT_PROPS["aria-label"],
  ...props
}) {
  const menuId = useId();
  const wrapperRef = useRef(null);
  const triggerRef = useRef(null);

  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [internalHoveredItemId, setInternalHoveredItemId] = useState(null);
  const [internalSelectedItemId, setInternalSelectedItemId] = useState(
    selectedItemId ?? null,
  );
  const [internalItems, setInternalItems] = useState(() =>
    Array.isArray(items) && items.length > 0
      ? items
      : getDefaultMenuItems(getResolvedType(type)),
  );
  const [isDarkMode, setIsDarkMode] = useState(getDocumentDarkMode);

  const resolvedType = getResolvedType(type);
  const isOpenControlled = typeof open === "boolean";
  // Un menú deshabilitado nunca se muestra abierto, aunque el consumidor conserve open=true.
  const resolvedOpen = !disabled && (isOpenControlled ? open : internalOpen);

  const baseResolvedState = getResolvedState(state, isHovered, isPressed);
  const resolvedState =
    resolvedOpen && !DROPDOWN_MENU_STATES.includes(state)
      ? "Default"
      : baseResolvedState;

  const triggerTextClasses = getTriggerTextClasses(resolvedType, resolvedState);

  const normalizedItems = useMemo(
    () =>
      Array.isArray(internalItems) && internalItems.length > 0
        ? internalItems
        : getDefaultMenuItems(resolvedType),
    [internalItems, resolvedType],
  );

  const shouldShowContainer = showContainer || resolvedOpen;
  const shouldRenderContent = resolvedOpen || preserveMenuSpace;
  const resolvedHoveredItemId = hoveredItemId ?? internalHoveredItemId ?? null;
  const resolvedSelectedItemId =
    selectedItemId ?? internalSelectedItemId ?? null;

  const selectedTriggerItem =
    normalizedItems.find((item) => item.id === resolvedSelectedItemId) ??
    (resolvedType === "Checkbox"
      ? (normalizedItems.find(
          (item) =>
            getResolvedType(item.type ?? resolvedType) === "Checkbox" &&
            item.checked === "Yes",
        ) ?? null)
      : null);

  const triggerLabel = selectedTriggerItem?.label ?? label;
  const triggerSupportingText =
    selectedTriggerItem?.supportingText ?? supportingText;
  const triggerAvatarSrc = selectedTriggerItem?.avatarSrc ?? avatarSrc;
  const triggerCountryCode = selectedTriggerItem?.countryCode ?? countryCode;
  const triggerChecked =
    resolvedType === "Checkbox" && selectedTriggerItem?.checked === "Yes"
      ? "Yes"
      : checked;

  const leading = TriggerLeading({
    type: resolvedType,
    state: resolvedState,
    checked: triggerChecked,
    countryCode: triggerCountryCode,
    avatarSrc: triggerAvatarSrc,
    label: triggerLabel,
  });

  const itemHoverClassName = isDarkMode
    ? "hover:bg-[var(--color-neutral-300)]"
    : "hover:bg-[var(--color-neutral-200)]";

  useEffect(() => {
    if (Array.isArray(items) && items.length > 0) {
      setInternalItems(items);
      return;
    }
    setInternalItems(getDefaultMenuItems(resolvedType));
  }, [items, resolvedType]);

  useEffect(() => {
    setInternalSelectedItemId(selectedItemId ?? null);
  }, [selectedItemId]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      setIsDarkMode(getDocumentDarkMode());
    });

    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!resolvedOpen || !interactive || typeof document === "undefined") {
      return undefined;
    }

    function setMenuOpen(nextOpen) {
      if (!isOpenControlled) {
        setInternalOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    }

    function handlePointerDown(event) {
      if (wrapperRef.current?.contains(event.target)) {
        return;
      }

      setMenuOpen(false);
      setIsPressed(false);
      setIsHovered(false);
      setInternalHoveredItemId(null);
    }

    function handleKeyDown(event) {
      if (event.key !== "Escape") {
        return;
      }

      setMenuOpen(false);
      setIsPressed(false);
      setIsHovered(false);
      setInternalHoveredItemId(null);
      triggerRef.current?.focus();
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [interactive, isOpenControlled, onOpenChange, resolvedOpen]);

  const setMenuOpen = (nextOpen) => {
    if (!isOpenControlled) {
      setInternalOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  const handleToggle = () => {
    if (!interactive) {
      onClick?.();
      return;
    }

    const nextOpen = !resolvedOpen;
    setMenuOpen(nextOpen);
    setIsPressed(false);
    setIsHovered(false);

    if (nextOpen) {
      triggerRef.current?.blur();
    }

    onClick?.();
  };

  const handlePressStart = () => {
    if (!DROPDOWN_MENU_STATES.includes(state)) {
      setIsPressed(true);
    }
  };

  const handlePressEnd = () => {
    if (!DROPDOWN_MENU_STATES.includes(state)) {
      setIsPressed(false);
    }
  };

  const handleItemClick = (item) => {
    const itemType = getResolvedType(item.type ?? resolvedType);

    if (itemType === "Checkbox") {
      const nextItems = updateDropdownCheckboxItems(
        normalizedItems,
        item.id,
        multiple,
      );

      const nextSelectedItem =
        nextItems.find((currentItem) => currentItem.id === item.id) ?? item;

      const nextSelectedItemId = nextSelectedItem.id ?? null;

      setInternalItems(nextItems);
      setInternalSelectedItemId(multiple ? null : nextSelectedItemId);
      onItemsChange?.(nextItems);
      onItemSelect?.(nextSelectedItem);
      if (!multiple) {
        setMenuOpen(false);
        setInternalHoveredItemId(null);
      }
      return;
    }

    setInternalSelectedItemId(item.id ?? null);
    onItemSelect?.(item);
    setMenuOpen(false);
    setInternalHoveredItemId(null);
  };

  return (
    <div
      ref={wrapperRef}
      className={clsx(
        "relative inline-flex w-full flex-col items-start",
        resolvedOpen ? "z-[100]" : "z-0",
        className,
      )}
      {...props}
    >
      <div
        className={clsx(
          "relative z-[1] w-full border bg-transparent",
          shouldShowContainer
            ? "rounded-[12px] border-[var(--color-neutral-200)]"
            : "rounded-none border-x-transparent border-t-transparent border-b-[var(--color-neutral-400)]",
          resolvedOpen && "rounded-b-none",
          resolvedOpen && showDivider
            ? "border-b-[var(--color-neutral-200)]"
            : resolvedOpen && "border-b-transparent",
          triggerWrapperClassName,
        )}
        data-node-id={
          shouldShowContainer ? DROPDOWN_MENU_NODE_IDS.wrapper : undefined
        }
      >
        <button
          ref={triggerRef}
          type="button"
          className={clsx(
            "group flex w-full items-center gap-[8px] rounded-[12px] text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-10)]",
            disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
            triggerHeightClassName,
            triggerPaddingXClassName,
            resolvedState !== "Default" &&
              !resolvedOpen &&
              "bg-[var(--color-neutral-200)]",
            resolvedOpen && "rounded-b-none",
            triggerClassName,
          )}
          aria-label={ariaLabel}
          aria-expanded={resolvedOpen}
          aria-haspopup="menu"
          aria-controls={resolvedOpen ? `${menuId}-content` : undefined}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => {
            setIsHovered(false);
            handlePressEnd();
          }}
          onMouseDown={handlePressStart}
          onMouseUp={handlePressEnd}
          onTouchStart={handlePressStart}
          onTouchEnd={handlePressEnd}
          onTouchCancel={handlePressEnd}
          onBlur={handlePressEnd}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              handlePressStart();
            }
          }}
          onKeyUp={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              handlePressEnd();
            }
          }}
          disabled={disabled}
          onClick={handleToggle}
        >
          <div
            className={clsx(
              "flex min-w-0 flex-1 items-center",
              resolvedType === "Text" ? "gap-[0px]" : "gap-[12px]",
            )}
          >
            {leading}

            <div className="flex min-w-0 flex-1 items-center gap-[8px] tracking-[-0.5px]">
              <p
                className={clsx(
                  "text-[14px] font-medium leading-[17px] tracking-[-0.5px]",
                  truncateTriggerLabel ? "min-w-0 flex-1 truncate" : "shrink-0",
                  triggerTextClasses.label,
                )}
              >
                {triggerLabel}
              </p>

              {triggerSupportingText ? (
                <p
                  className={clsx(
                    "min-w-0 flex-1 text-body-4",
                    triggerTextClasses.supporting,
                  )}
                >
                  {triggerSupportingText}
                </p>
              ) : null}
            </div>
          </div>

          <span
            className={clsx(
              "inline-flex size-5 shrink-0 items-center justify-center",
              triggerTextClasses.arrow,
            )}
          >
            <ArrowDownIcon className="size-5" />
          </span>
        </button>
      </div>

      {shouldRenderContent ? (
        <div
          id={`${menuId}-content`}
          role="menu"
          className={clsx(
            "absolute inset-x-0 top-full z-[110] box-border w-auto rounded-b-[12px] border border-[var(--color-neutral-200)] border-t-0 bg-[var(--color-neutral-100)]",
            contentPaddingClassName,
            resolvedOpen ? "flex flex-col gap-[4px]" : "hidden",
            contentClassName,
          )}
          data-node-id={DROPDOWN_MENU_NODE_IDS.content}
        >
          {normalizedItems.map((item, index) => {
            const itemType = getResolvedType(item.type ?? resolvedType);
            const isHoveredItem = item.id === resolvedHoveredItemId;
            const isCheckboxSelected =
              itemType === "Checkbox" && item.checked === "Yes";

            const isSelectedItem =
              itemType === "Checkbox"
                ? isCheckboxSelected
                : item.id === resolvedSelectedItemId;

            const itemVisualState =
              itemType === "Checkbox"
                ? isHoveredItem
                  ? "Hover"
                  : isCheckboxSelected
                    ? "Selected"
                    : "Default"
                : isSelectedItem
                  ? "Selected"
                  : isHoveredItem
                    ? "Hover"
                    : "Default";

            return (
              <button
                key={item.id ?? `${item.label}-${index}`}
                type="button"
                role={itemType === "Checkbox" ? "menuitemcheckbox" : "menuitem"}
                aria-checked={
                  itemType === "Checkbox" ? item.checked === "Yes" : undefined
                }
                className={clsx(
                  "group flex w-full items-center gap-[8px] rounded-[8px] px-[8px] text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-10)]",
                  rowHeightClassName ?? getDefaultRowHeight(itemType),
                  itemType === "Checkbox"
                    ? isSelectedItem
                      ? "bg-[var(--color-neutral-200)] hover:bg-[var(--color-neutral-200)] focus-visible:bg-[var(--color-neutral-200)]"
                      : "hover:bg-[var(--color-neutral-200)] focus-visible:bg-[var(--color-neutral-200)]"
                    : isSelectedItem
                      ? "bg-[var(--color-neutral-200)] hover:bg-[var(--color-neutral-200)] focus-visible:bg-[var(--color-neutral-200)]"
                      : itemHoverClassName,
                  isHoveredItem &&
                    !isSelectedItem &&
                    "bg-[var(--color-neutral-200)]",
                  itemClassName,
                )}
                onMouseEnter={() => setInternalHoveredItemId(item.id ?? null)}
                onMouseLeave={() => setInternalHoveredItemId(null)}
                onClick={() =>
                  handleItemClick({
                    ...item,
                    visualState: itemVisualState,
                  })
                }
              >
                <div className="flex min-w-0 flex-1 items-center gap-[12px]">
                  {renderMenuItemLeading(
                    itemType,
                    {
                      ...item,
                      visualState: itemVisualState,
                    },
                    avatarSrc,
                    countryCode,
                  )}

                  <div className="flex min-w-0 flex-1 items-center gap-[8px] tracking-[-0.5px]">
                    <p
                      className={clsx(
                        "shrink-0 text-heading-8",
                        isSelectedItem
                          ? "text-[var(--color-text-300)]"
                          : isHoveredItem
                            ? "text-[var(--color-text-200)]"
                            : "text-[var(--color-text-200)]",
                      )}
                    >
                      {item.label}
                    </p>

                    {item.supportingText ? (
                      <p
                        className={clsx(
                          "min-w-0 flex-1 text-body-4",
                          isSelectedItem
                            ? "text-[var(--color-text-300)]"
                            : isHoveredItem
                              ? "text-[var(--color-text-200)]"
                              : "text-[var(--color-text-100)]",
                        )}
                      >
                        {item.supportingText}
                      </p>
                    ) : null}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default DropdownMenu;
