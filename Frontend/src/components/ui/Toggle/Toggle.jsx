/* Renderiza un interruptor accesible con estado controlado o interno y soporte de tema oscuro. */
import { useEffect, useState } from "react";
import clsx from "clsx";
import {
  TOGGLE_DEFAULT_PROPS,
  TOGGLE_SIZES,
  TOGGLE_SIZE_STYLES,
  TOGGLE_STATES,
} from "./toggleConfig.js";

const TOGGLE_NODE_IDS = {
  light: {
    S: {
      Default: {
        true: "2061:22832",
        false: "2061:22841",
      },
    },
    M: {
      Default: {
        true: "2061:22835",
        false: "2061:22845",
      },
      Hover: {
        true: "2061:22853",
      },
      Focused: {
        true: "2061:22856",
      },
      Disabled: {
        true: "2061:22859",
      },
    },
    L: {
      Default: {
        true: "2061:22838",
        false: "2061:22849",
      },
    },
  },
  dark: {
    S: {
      Default: {
        true: "2056:22331",
        false: "2056:22341",
      },
    },
    M: {
      Default: {
        true: "2056:22334",
        false: "2056:22344",
      },
      Hover: {
        true: "2056:22352",
      },
      Focused: {
        true: "2056:22355",
      },
      Disabled: {
        true: "2056:22358",
      },
    },
    L: {
      Default: {
        true: "2056:22337",
        false: "2056:22349",
      },
    },
  },
};

// Detecta si el documento está usando el tema oscuro.
function getDocumentDarkMode() {
  if (typeof document === "undefined") {
    return false;
  }

  return document.documentElement.classList.contains("dark");
}

// Obtiene la referencia visual correspondiente a tamaño, estado, valor y tema.
function getToggleNodeId(size, state, active, isDarkMode) {
  const themeKey = isDarkMode ? "dark" : "light";
  return TOGGLE_NODE_IDS[themeKey]?.[size]?.[state]?.[String(active)] ?? null;
}

// Resuelve los estilos del track, thumb y foco según el estado actual.
function getToggleVisualSpec(size, active, state, isDarkMode) {
  const sizeStyles = TOGGLE_SIZE_STYLES[size];
  const isDisabled = state === "Disabled";
  const isFocused = state === "Focused";
  const isHover = state === "Hover";

  if (isDisabled) {
    return {
      wrapperClassName: "",
      trackClassName: "",
      thumbClassName:
        "bg-[var(--color-neutral-bg)] border border-[var(--color-neutral-300)]",
      focusRingClassName: null,
      wrapperStyle: null,
      trackStyle: {
        padding: sizeStyles.padding,
        backgroundColor: "var(--color-neutral-200)",
      },
      thumbStyle: {
        boxShadow: sizeStyles.shadow,
      },
    };
  }

  if (active) {
    const trackStyle = {
      padding: sizeStyles.padding,
    };

    if (isHover) {
      trackStyle.backgroundColor = isDarkMode ? "#818181" : "#0f0f0f";
      trackStyle.borderWidth = "1px";
      trackStyle.borderStyle = "solid";
      trackStyle.borderColor = isDarkMode ? "#333333" : "#e8e8e8";
    } else if (isFocused) {
      trackStyle.backgroundColor = "var(--color-primary-300)";
      trackStyle.borderWidth = "1px";
      trackStyle.borderStyle = "solid";
      trackStyle.borderColor = "var(--color-primary-300)";
    } else {
      trackStyle.backgroundColor = "var(--color-primary-300)";
    }

    return {
      wrapperClassName: isFocused
        ? isDarkMode
          ? "box-border rounded-[16px] border-2"
          : ""
        : "",
      trackClassName: "",
      thumbClassName: "bg-[var(--color-neutral-100-uniform)]",
      focusRingClassName: isFocused
        ? isDarkMode
          ? null
          : "absolute inset-[-2px] rounded-full border-2 border-[var(--color-primary-10)]"
        : null,
      wrapperStyle:
        isFocused && isDarkMode
          ? {
              borderColor: "var(--color-primary-10)",
            }
          : null,
      trackStyle,
      thumbStyle: {
        boxShadow: sizeStyles.shadow,
      },
    };
  }

  const inactiveTrackStyle = {
    padding: sizeStyles.padding,
  };

  if (isHover) {
    inactiveTrackStyle.backgroundColor = "var(--color-neutral-300)";
    inactiveTrackStyle.borderWidth = "1px";
    inactiveTrackStyle.borderStyle = "solid";
    inactiveTrackStyle.borderColor = "var(--color-neutral-200)";
  } else if (isFocused) {
    inactiveTrackStyle.backgroundColor = "var(--color-neutral-200)";
    inactiveTrackStyle.borderWidth = "1px";
    inactiveTrackStyle.borderStyle = "solid";
    inactiveTrackStyle.borderColor = "var(--color-neutral-200)";
  } else {
    inactiveTrackStyle.backgroundColor = "var(--color-neutral-200)";
  }

  return {
    wrapperClassName: "",
    trackClassName: "",
    thumbClassName: "bg-[var(--color-neutral-100-uniform)]",
    focusRingClassName: isFocused
      ? "absolute inset-[-2px] rounded-full border-2 border-[var(--color-primary-10)]"
      : null,
    wrapperStyle: null,
    trackStyle: inactiveTrackStyle,
    thumbStyle: {
      boxShadow: sizeStyles.shadow,
    },
  };
}

// Coordina interacción, estado visual y atributos accesibles del interruptor.
function Toggle({
  className,
  active,
  defaultActive = TOGGLE_DEFAULT_PROPS.active,
  size = TOGGLE_DEFAULT_PROPS.size,
  state = TOGGLE_DEFAULT_PROPS.state,
  interactive = TOGGLE_DEFAULT_PROPS.interactive,
  disabled = TOGGLE_DEFAULT_PROPS.disabled,
  onActiveChange,
  onClick,
  ...props
}) {
  const [internalActive, setInternalActive] = useState(defaultActive);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
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

  const resolvedSize = TOGGLE_SIZES.includes(size)
    ? size
    : TOGGLE_DEFAULT_PROPS.size;
  const resolvedActive =
    typeof active === "boolean" ? active : internalActive;
  const hasForcedState = TOGGLE_STATES.includes(state);
  const isInteractive =
    !disabled &&
    !hasForcedState &&
    (interactive || typeof onActiveChange === "function");
  const resolvedState = disabled
    ? "Disabled"
    : hasForcedState
      ? state
      : isHovered
          ? "Hover"
          : isFocused
            ? "Focused"
            : "Default";
  const sizeStyles = TOGGLE_SIZE_STYLES[resolvedSize];
  const visualSpec = getToggleVisualSpec(
    resolvedSize,
    resolvedActive,
    resolvedState,
    isDarkMode,
  );
  const Component = isInteractive ? "button" : "span";
  const nodeId = getToggleNodeId(
    resolvedSize,
    resolvedState,
    resolvedActive,
    isDarkMode,
  );

  function handleToggle(event) {
    if (!isInteractive) {
      onClick?.(event);
      return;
    }

    const nextActive = !resolvedActive;

    if (typeof active !== "boolean") {
      setInternalActive(nextActive);
    }

    onActiveChange?.(nextActive);
    onClick?.(event);
  }

  return (
    <Component
      type={isInteractive ? "button" : undefined}
      role={isInteractive ? "switch" : undefined}
      aria-checked={isInteractive ? resolvedActive : undefined}
      disabled={isInteractive ? disabled : undefined}
      className={clsx(
        "relative inline-flex shrink-0 items-center overflow-visible rounded-full align-middle",
        sizeStyles.wrapper,
        isInteractive &&
          "cursor-pointer appearance-none bg-transparent outline-none focus-visible:outline-none",
        visualSpec.wrapperClassName,
        className,
      )}
      style={visualSpec.wrapperStyle ?? undefined}
      data-node-id={nodeId ?? undefined}
      onMouseEnter={isInteractive ? () => setIsHovered(true) : undefined}
      onMouseLeave={isInteractive ? () => setIsHovered(false) : undefined}
      onMouseDown={isInteractive ? () => setIsFocused(false) : undefined}
      onFocus={
        isInteractive
          ? (event) => {
              setIsFocused(event.currentTarget.matches(":focus-visible"));
            }
          : undefined
      }
      onBlur={isInteractive ? () => setIsFocused(false) : undefined}
      onClick={handleToggle}
      {...props}
    >
      {visualSpec.focusRingClassName ? (
        <span
          aria-hidden="true"
          className={clsx("pointer-events-none", visualSpec.focusRingClassName)}
        />
      ) : null}

      <span
        className={clsx(
          "relative z-10 flex w-full flex-1 items-center overflow-hidden rounded-full transition-[background-color,border-color] duration-150",
          resolvedActive ? "justify-end" : "justify-start",
          visualSpec.trackClassName,
        )}
        style={visualSpec.trackStyle}
      >
        <span
          aria-hidden="true"
          className={clsx(
            "shrink-0 rounded-full transition-transform duration-150",
            sizeStyles.thumb,
            visualSpec.thumbClassName,
          )}
          style={visualSpec.thumbStyle}
        />
      </span>
    </Component>
  );
}

export default Toggle;
