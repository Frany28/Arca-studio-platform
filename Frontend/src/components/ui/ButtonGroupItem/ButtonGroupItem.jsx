/* Renderiza items seleccionables y grupos de botones con estado controlado o interno. */
import { useMemo, useState } from "react";
import clsx from "clsx";
import Tooltip from "../Tooltip/Tooltip.jsx";
import {
  BUTTON_GROUP_INTERACTIVE_STYLES,
  BUTTON_GROUP_ITEM_INTERACTIVE_STYLES,
  BUTTON_GROUP_ITEM_VISUALS,
  BUTTON_GROUP_WRAPPER_STYLES,
} from "./buttonGroupItemConfig.js";

// Icono visual predeterminado usado cuando el item no recibe uno personalizado.
function LocationSearchingIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={clsx("size-5 shrink-0", className)}
      aria-hidden="true"
    >
      <path
        d="M10 2.5C6.96243 2.5 4.5 4.96243 4.5 8C4.5 11.0376 6.96243 13.5 10 13.5C13.0376 13.5 15.5 11.0376 15.5 8C15.5 4.96243 13.0376 2.5 10 2.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M10 1V3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10 13V15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M3 8H5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M15 8H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// Resuelve el estado efectivo del item priorizando el estado deshabilitado.
function resolveItemState(state, disabled) {
  if (disabled) {
    return "Disabled";
  }

  return BUTTON_GROUP_ITEM_VISUALS[state] ? state : "Default";
}

// Gestiona selección individual, estado visual e interacción de cada item del grupo.
function ButtonGroupItem({
  className,
  label = "Text",
  state = "Default",
  showIcon = true,
  showText = true,
  icon = null,
  disabled = false,
  interactive = false,
  isGrouped = false,
  selected = null,
  defaultSelected = false,
  onSelectedChange,
  onClick,
  ...props
}) {
  const [internalSelected, setInternalSelected] = useState(defaultSelected);
  const isSelected = selected ?? internalSelected;
  const computedState =
    !disabled && interactive && isSelected ? "Selected" : state;
  const resolvedState = resolveItemState(computedState, disabled);
  const visual = BUTTON_GROUP_ITEM_VISUALS[resolvedState];
  const isDisabled = resolvedState === "Disabled";
  const isInteractive = interactive && !isDisabled && resolvedState !== "Selected";

  function handleClick(event) {
    if (interactive && !isDisabled && !isGrouped && selected === null) {
      const nextSelected = !internalSelected;
      setInternalSelected(nextSelected);
      onSelectedChange?.(nextSelected);
    }

    onClick?.(event);
  }

  const button = (
    <button
      type="button"
      className={clsx(
        "group flex h-[41px] min-w-0 items-center justify-center gap-[var(--spacing-spacing-gap-3,8px)] border px-[var(--spacing-spacing-gap-5,16px)] py-[var(--spacing-spacing-gap-4,12px)] text-center tracking-[-0.5px] transition-colors duration-150",
        "text-body-3",
        isDisabled ? "cursor-not-allowed" : "cursor-pointer",
        visual.container,
        isInteractive && BUTTON_GROUP_ITEM_INTERACTIVE_STYLES,
        className,
      )}
      disabled={isDisabled}
      onClick={handleClick}
      {...props}
    >
      {showIcon ? (
        <span
          className={clsx(
            "inline-flex items-center justify-center transition-colors duration-150",
            visual.icon,
          )}
        >
          {icon ?? <LocationSearchingIcon />}
        </span>
      ) : null}
      {showText ? (
        <span
          className={clsx(
            "inline-flex items-center justify-center whitespace-nowrap transition-colors duration-150",
            visual.label,
          )}
        >
          {label}
        </span>
      ) : null}
    </button>
  );

  return !showText && label ? (
    <Tooltip asChild portal showTip text={label} tipPosition="Top center">
      {button}
    </Tooltip>
  ) : (
    button
  );
}

// Coordina selección, normalización y renderizado de múltiples ButtonGroupItem.
export function ButtonGroup({
  className,
  items,
  persistSelection = true,
  selectedIndex = null,
  defaultSelectedIndex = null,
  onChange,
}) {
  const [internalSelectedIndex, setInternalSelectedIndex] = useState(defaultSelectedIndex);
  const isControlled = selectedIndex !== null && selectedIndex !== undefined;
  const activeIndex = persistSelection
    ? isControlled
      ? selectedIndex
      : internalSelectedIndex
    : null;

  const normalizedItems = useMemo(
    () =>
      items.map((item, index) => {
        const disabled = Boolean(item.disabled || item.state === "Disabled");
        const state =
          disabled ? "Disabled" : activeIndex === index ? "Selected" : item.state ?? "Default";

        return {
          ...item,
          disabled,
          state,
        };
      }),
    [activeIndex, items],
  );

  function handleSelect(index, item) {
    if (item.disabled) {
      return;
    }

    if (persistSelection && !isControlled) {
      setInternalSelectedIndex(index);
    }

    onChange?.(index);
  }

  return (
    <div className={clsx(BUTTON_GROUP_WRAPPER_STYLES, className)}>
      <div className="flex items-center overflow-hidden rounded-[var(--radius-2)]">
        {normalizedItems.map((item, index) => (
          <ButtonGroupItem
            key={`${item.label}-${index}`}
            {...item}
            className={clsx(
              "min-w-[68px] flex-1 rounded-none first:rounded-l-[var(--radius-2)] last:rounded-r-[var(--radius-2)]",
              index > 0 && "border-l-0",
              activeIndex !== index && !item.disabled && BUTTON_GROUP_INTERACTIVE_STYLES,
            )}
            isGrouped
            interactive
            onClick={() => handleSelect(index, item)}
          />
        ))}
      </div>
    </div>
  );
}

export default ButtonGroupItem;
