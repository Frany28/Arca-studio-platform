/* Renderiza un checkbox controlado o interno con estados visuales, modo oscuro y accesibilidad. */
import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  CHECKBOX_CHECKED_STATES,
  CHECKBOX_DEFAULT_PROPS,
  CHECKBOX_SIZES,
  CHECKBOX_SIZE_STYLES,
  CHECKBOX_STATES,
} from "./checkboxConfig.js";

const CHECKBOX_SHADOW_ELEVATION_S = "0px 2px 4px 0px rgba(27, 28, 29, 0.04)";
const CHECKBOX_SHADOW_ELEVATION_E1 = "var(--shadow-e1)";
const CHECKBOX_DARK_FOCUS_WRAPPER_BORDER = "rgba(42, 41, 41, 0.10)";
const CHECKBOX_NODE_IDS = {
  S: {
    Default: {
      No: "2061:22704",
      Yes: "2061:22705",
      Indeterminate: "2061:22707",
    },
    Hover: {
      No: "2061:22709",
      Yes: "2061:22711",
      Indeterminate: "2061:22713",
    },
    Focused: {
      No: "2061:22715",
      Yes: "2061:22717",
      Indeterminate: "2061:22720",
    },
    Disabled: {
      No: "2061:22723",
      Yes: "2061:22724",
      Indeterminate: "2061:22726",
    },
  },
  M: {
    Default: {
      No: "2061:22728",
      Yes: "2061:22729",
      Indeterminate: "2061:22731",
    },
    Hover: {
      No: "2061:22733",
      Yes: "2061:22735",
      Indeterminate: "2061:22737",
    },
    Focused: {
      No: "2061:22739",
      Yes: "2061:22741",
      Indeterminate: "2061:22744",
    },
    Disabled: {
      No: "2061:22747",
      Yes: "2061:22748",
      Indeterminate: "2061:22750",
    },
  },
};
const CHECKBOX_DARK_NODE_IDS = {
  S: {
    Default: {
      No: "2056:22203",
      Yes: "2056:22204",
      Indeterminate: "2056:22206",
    },
    Hover: {
      No: "2056:22208",
      Yes: "2056:22210",
      Indeterminate: "2056:22212",
    },
    Focused: {
      No: "2056:22214",
      Yes: "2056:22216",
      Indeterminate: "2056:22219",
    },
    Disabled: {
      No: "2056:22222",
      Yes: "2056:22223",
      Indeterminate: "2056:22225",
    },
  },
  M: {
    Default: {
      No: "2056:22227",
      Yes: "2056:22228",
      Indeterminate: "2056:22230",
    },
    Hover: {
      No: "2056:22232",
      Yes: "2056:22234",
      Indeterminate: "2056:22236",
    },
    Focused: {
      No: "2056:22238",
      Yes: "2056:22240",
      Indeterminate: "2056:22243",
    },
    Disabled: {
      No: "2056:22246",
      Yes: "2056:22247",
      Indeterminate: "2056:22249",
    },
  },
};

// Icono visual usado para el estado marcado.
function CheckIcon({ className, frameClassName }) {
  return (
    <span
      className={clsx(
        "relative shrink-0 overflow-clip rounded-[var(--radius-1)]",
        frameClassName,
      )}
      aria-hidden="true"
    >
      <span className="absolute inset-[22.06%_13.35%]">
        <svg
          viewBox="0 0 11 8"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={clsx("absolute inset-0 size-full", className)}
        >
          <path
            d="M3.26083 6.17167L0.828333 3.73917L0 4.56167L3.26083 7.8225L10.2608 0.8225L9.43833 0L3.26083 6.17167Z"
            fill="currentColor"
          />
        </svg>
      </span>
    </span>
  );
}

// Icono visual usado para el estado indeterminado.
function IndeterminateIcon({ className, frameClassName }) {
  return (
    <span
      className={clsx(
        "relative shrink-0 overflow-clip rounded-[var(--radius-1)]",
        frameClassName,
      )}
      aria-hidden="true"
    >
      <span className="absolute inset-[45.83%_20.83%]">
        <svg
          viewBox="0 0 7 1"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
          className={clsx("absolute inset-0 size-full", className)}
        >
          <path
            d="M7 1H0V0H7V1Z"
            fill="currentColor"
          />
        </svg>
      </span>
    </span>
  );
}

// Calcula el siguiente estado al interactuar con el checkbox.
function getNextCheckedState(currentChecked) {
  if (currentChecked === "Indeterminate") {
    return "Yes";
  }

  return currentChecked === "Yes" ? "No" : "Yes";
}

// Detecta si el documento está usando el tema oscuro.
function getDocumentDarkMode() {
  if (typeof document === "undefined") {
    return false;
  }

  return document.documentElement.classList.contains("dark");
}

// Resuelve estilos, icono y referencia visual según tamaño, estado y tema.
function getCheckboxVisualSpec(
  resolvedSize,
  resolvedChecked,
  resolvedState,
  isDarkMode,
) {
  const nodeIds = isDarkMode ? CHECKBOX_DARK_NODE_IDS : CHECKBOX_NODE_IDS;
  const isSelected =
    resolvedChecked === "Yes" || resolvedChecked === "Indeterminate";
  const isHoverUnchecked = resolvedChecked === "No" && resolvedState === "Hover";
  const nodeId = nodeIds[resolvedSize][resolvedState][resolvedChecked];
  const iconSizeClass = CHECKBOX_SIZE_STYLES[resolvedSize].icon;
  const iconType = isSelected || isHoverUnchecked
    ? resolvedChecked === "Indeterminate"
      ? "indeterminate"
      : "check"
    : null;

  if (resolvedState === "Disabled") {
    return {
      nodeId,
      boxClassName:
        "border-[var(--color-neutral-300)] bg-[var(--color-neutral-200)]",
      iconClassName: "text-[var(--color-neutral-500)]",
      iconType,
      iconSizeClass,
      boxShadow: CHECKBOX_SHADOW_ELEVATION_E1,
      focusRingStyle: undefined,
    };
  }

  if (resolvedState === "Hover") {
    return {
      nodeId,
      boxClassName: isSelected
        ? "border-[var(--color-primary-200)] bg-[var(--color-primary-300)]"
        : "border-[var(--color-neutral-400)] bg-[var(--color-neutral-100-uniform)]",
      iconClassName: isSelected
        ? "text-[var(--color-neutral-100-uniform)]"
        : "text-[var(--color-neutral-400)]",
      iconType,
      iconSizeClass,
      boxShadow: CHECKBOX_SHADOW_ELEVATION_E1,
      focusRingStyle: undefined,
    };
  }

  if (resolvedState === "Focused") {
    return {
      nodeId,
      boxClassName: isSelected
        ? "border-[var(--color-primary-100)] bg-[var(--color-primary-300)]"
        : "border-[var(--color-primary-100)] bg-[var(--color-neutral-100-uniform)]",
      iconClassName: isSelected
        ? "text-[var(--color-neutral-100-uniform)]"
        : "",
      iconType,
      iconSizeClass,
      boxShadow:
        resolvedSize === "M"
          ? CHECKBOX_SHADOW_ELEVATION_E1
          : CHECKBOX_SHADOW_ELEVATION_S,
      focusRingStyle: {
        inset: "calc(-1 * var(--stroke-2))",
        borderRadius: "calc(var(--radius-1) + var(--stroke-2))",
        ...(isDarkMode
          ? {
              boxSizing: "border-box",
              border: `var(--stroke-2) solid ${CHECKBOX_DARK_FOCUS_WRAPPER_BORDER}`,
              backgroundColor: CHECKBOX_DARK_FOCUS_WRAPPER_BORDER,
            }
          : {
              backgroundColor: "var(--color-primary-10)",
            }),
      },
    };
  }

  return {
    nodeId,
    boxClassName: isSelected
      ? "border-[var(--color-primary-100)] bg-[var(--color-primary-300)]"
      : "border-[var(--color-neutral-300)] bg-[var(--color-neutral-100-uniform)]",
    iconClassName: "text-[var(--color-neutral-100-uniform)]",
    iconType,
    iconSizeClass,
    boxShadow: CHECKBOX_SHADOW_ELEVATION_E1,
    focusRingStyle: undefined,
  };
}

// Coordina estado interno/controlado, interacción y atributos accesibles del checkbox.
function Checkbox({
  className,
  checked,
  defaultChecked = CHECKBOX_DEFAULT_PROPS.checked,
  size = CHECKBOX_DEFAULT_PROPS.size,
  state = CHECKBOX_DEFAULT_PROPS.state,
  interactive = CHECKBOX_DEFAULT_PROPS.interactive,
  disabled = CHECKBOX_DEFAULT_PROPS.disabled,
  onCheckedChange,
  onClick,
  style,
  ...props
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [internalChecked, setInternalChecked] = useState(defaultChecked);
  const [isDarkMode, setIsDarkMode] = useState(getDocumentDarkMode);

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

    return () => {
      observer.disconnect();
    };
  }, []);

  const resolvedSize = CHECKBOX_SIZES.includes(size)
    ? size
    : CHECKBOX_DEFAULT_PROPS.size;
  const resolvedChecked = CHECKBOX_CHECKED_STATES.includes(checked)
    ? checked
    : internalChecked;
  const hasForcedState = CHECKBOX_STATES.includes(state);
  const resolvedState = disabled
    ? "Disabled"
    : hasForcedState
      ? state
      : isHovered
        ? "Hover"
        : isFocused
          ? "Focused"
          : "Default";
  const isInteractive =
    !disabled &&
    !hasForcedState &&
    (interactive || typeof onCheckedChange === "function");
  const sizeStyles = CHECKBOX_SIZE_STYLES[resolvedSize];
  const iconFrameClass = resolvedSize === "M" ? "size-[14px]" : "size-[12px]";
  const visualSpec = getCheckboxVisualSpec(
    resolvedSize,
    resolvedChecked,
    resolvedState,
    isDarkMode,
  );
  const Component = isInteractive ? "button" : "span";

  function handleToggle(event) {
    if (!isInteractive) {
      onClick?.(event);
      return;
    }

    const nextChecked = getNextCheckedState(resolvedChecked);

    if (!CHECKBOX_CHECKED_STATES.includes(checked)) {
      setInternalChecked(nextChecked);
    }

    onCheckedChange?.(nextChecked);
    onClick?.(event);
  }

  return (
    <Component
      type={isInteractive ? "button" : undefined}
      role={isInteractive ? "checkbox" : undefined}
      aria-checked={
        isInteractive
          ? resolvedChecked === "Indeterminate"
            ? "mixed"
            : resolvedChecked === "Yes"
          : undefined
      }
      disabled={isInteractive ? disabled : undefined}
      className={clsx(
        "relative inline-flex shrink-0 items-center justify-center overflow-visible rounded-[var(--radius-1)] align-middle transition-[box-shadow] duration-150",
        sizeStyles.wrapper,
        isInteractive &&
          "cursor-pointer appearance-none border-0 bg-transparent p-0 outline-none focus-visible:outline-none",
        className,
      )}
      data-node-id={visualSpec.nodeId}
      style={style}
      onMouseEnter={isInteractive ? () => setIsHovered(true) : undefined}
      onMouseLeave={isInteractive ? () => setIsHovered(false) : undefined}
      onFocus={isInteractive ? () => setIsFocused(true) : undefined}
      onBlur={isInteractive ? () => setIsFocused(false) : undefined}
      onClick={handleToggle}
      {...props}
    >
      {visualSpec.focusRingStyle ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute z-0"
          style={visualSpec.focusRingStyle}
        />
      ) : null}
      <span
        className={clsx(
          "relative z-10 inline-flex flex-col items-center justify-center rounded-[var(--radius-1)] border transition-[background-color,border-color,box-shadow] duration-150",
          "size-full",
          visualSpec.boxClassName,
        )}
        style={{
          boxShadow: visualSpec.boxShadow,
        }}
      >
        {visualSpec.iconType === "check" ? (
          <CheckIcon
            className={clsx(
              visualSpec.iconClassName,
            )}
            frameClassName={iconFrameClass}
          />
        ) : null}

        {visualSpec.iconType === "indeterminate" ? (
          <IndeterminateIcon
            className={clsx(
              visualSpec.iconClassName,
            )}
            frameClassName={iconFrameClass}
          />
        ) : null}
      </span>
    </Component>
  );
}

export default Checkbox;
