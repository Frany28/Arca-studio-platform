/* Renderiza items de navegación seleccionables con estilos Brand, Underline y Divider. */
import { useEffect, useState } from "react";
import clsx from "clsx";
import * as IconsaxIcons from "iconsax-react";
import {
  TAB_ITEM_DEFAULT_PROPS,
  TAB_ITEM_SIZES,
  TAB_ITEM_SIZE_STYLES,
  TAB_ITEM_STATES,
} from "./tabItemConfig.js";

const TAB_ITEM_NODE_IDS = {
  Brand: {
    S: {
      Default: "2056:22476",
      Hover: "2056:22494",
      Selected: "2056:22512",
    },
    M: {
      Default: "2056:22530",
      Hover: "2056:22548",
      Selected: "2056:22566",
    },
  },
  Underline: {
    S: {
      Default: "2056:22482",
      Hover: "2056:22500",
      Selected: "2056:22518",
    },
    M: {
      Default: "2056:22536",
      Hover: "2056:22554",
      Selected: "2056:22572",
    },
  },
  Divider: {
    S: {
      Default: "2056:22488",
      Hover: "2056:22506",
      Selected: "2056:22524",
    },
    M: {
      Default: "2056:22542",
      Hover: "2056:22560",
      Selected: "2056:22578",
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

// Icono izquierdo predeterminado tomado de la librería de iconos.
function Box2Icon({ className }) {
  const Box2 = IconsaxIcons.Box2;

  if (Box2) {
    return (
      <Box2
        size="20"
        variant="Linear"
        color="currentColor"
        className={className}
      />
    );
  }

  return null;
}

// Icono derecho predeterminado usado en variantes con acción secundaria.
function WindowIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M6.5 5.5H13.5V12.5H6.5V5.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M9.5 8.5H16.5V15.5H9.5V8.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

// Resuelve el estado visual efectivo según selección, hover o estado forzado.
function getResolvedState({
  state,
  selected,
  isHovered,
}) {
  if (TAB_ITEM_STATES.includes(state)) {
    return state;
  }

  if (selected) {
    return "Selected";
  }

  if (isHovered) {
    return "Hover";
  }

  return "Default";
}

// Selecciona clases visuales según estilo, estado y tema actual.
function getTabItemVisualSpec(style, state, isDarkMode) {
  if (style === "Underline") {
    if (state === "Selected") {
      return {
        containerClassName:
          "bg-transparent border-b-2 border-[var(--color-text-300)] rounded-none",
        contentClassName: "text-[var(--color-text-300)]",
      };
    }

    if (state === "Hover") {
      return {
        containerClassName:
          "bg-transparent border-b-2 border-[var(--color-neutral-200)] rounded-none",
        contentClassName: "text-[var(--color-text-300)]",
      };
    }

    return {
      containerClassName:
        "bg-transparent border-b-2 border-transparent rounded-none",
      contentClassName: isDarkMode
        ? "text-[var(--color-text-200)]"
        : "text-[var(--color-text-100)]",
    };
  }

  if (style === "Divider") {
    if (state === "Selected") {
      return {
        containerClassName:
          "bg-transparent border-l-2 border-[var(--color-text-300)] rounded-none",
        contentClassName: "text-[var(--color-text-300)]",
      };
    }

    if (state === "Hover") {
      return {
        containerClassName:
          "bg-transparent border-l-2 border-[var(--color-neutral-200)] rounded-none",
        contentClassName: "text-[var(--color-text-300)]",
      };
    }

    return {
      containerClassName:
        "bg-transparent border-l-2 border-transparent rounded-none",
      contentClassName: isDarkMode
        ? "text-[var(--color-text-200)]"
        : "text-[var(--color-text-100)]",
    };
  }

  if (isDarkMode) {
    if (state === "Selected") {
      return {
        containerClassName: "bg-[var(--color-neutral-200)]",
        contentClassName: "text-[var(--color-text-300)]",
      };
    }

    if (state === "Hover") {
      return {
        containerClassName: "bg-[var(--color-neutral-200)]",
        contentClassName: "text-[var(--color-text-200)]",
      };
    }

    return {
      containerClassName: "bg-transparent",
      contentClassName: "text-[var(--color-text-200)]",
    };
  }

  if (state === "Selected") {
    return {
      containerClassName: "bg-[var(--color-neutral-200)]",
      contentClassName: "text-[var(--color-text-300)]",
    };
  }

  if (state === "Hover") {
    return {
      containerClassName: "bg-[var(--color-neutral-200)]",
      contentClassName: "text-[var(--color-text-200)]",
    };
  }

  return {
    containerClassName: "bg-transparent",
    contentClassName: "text-[var(--color-text-100)]",
  };
}

// Coordina estado controlado/interno, interacción y apariencia del item de navegación.
function TabItem({
  className,
  label = TAB_ITEM_DEFAULT_PROPS.label,
  size = TAB_ITEM_DEFAULT_PROPS.size,
  style = TAB_ITEM_DEFAULT_PROPS.style,
  state = TAB_ITEM_DEFAULT_PROPS.state,
  selected = TAB_ITEM_DEFAULT_PROPS.selected,
  defaultSelected = TAB_ITEM_DEFAULT_PROPS.defaultSelected,
  persistSelection = TAB_ITEM_DEFAULT_PROPS.persistSelection,
  interactive = TAB_ITEM_DEFAULT_PROPS.interactive,
  iconLeft = TAB_ITEM_DEFAULT_PROPS.iconLeft,
  iconRight = TAB_ITEM_DEFAULT_PROPS.iconRight,
  leftIcon = null,
  rightIcon = null,
  onSelectedChange,
  onClick,
  ...props
}) {
  const [internalSelected, setInternalSelected] = useState(defaultSelected);
  const [isHovered, setIsHovered] = useState(false);
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

  const resolvedSize = TAB_ITEM_SIZES.includes(size)
    ? size
    : TAB_ITEM_DEFAULT_PROPS.size;
  const resolvedStyle =
    style === "Underline"
      ? "Underline"
      : style === "Divider"
        ? "Divider"
        : "Brand";
  const isSelected =
    typeof selected === "boolean" ? selected : internalSelected;
  const hasForcedState = TAB_ITEM_STATES.includes(state);
  const resolvedState = getResolvedState({
    state,
    selected: isSelected,
    isHovered,
  });
  const isInteractive =
    !hasForcedState &&
    (interactive || typeof onSelectedChange === "function");
  const sizeStyles = TAB_ITEM_SIZE_STYLES[resolvedSize];
  const visualSpec = getTabItemVisualSpec(
    resolvedStyle,
    resolvedState,
    isDarkMode,
  );
  const Component = isInteractive ? "button" : "span";
  const resolvedLeftIcon =
    leftIcon ??
    (iconLeft ? <Box2Icon className={clsx(sizeStyles.icon, "shrink-0")} /> : null);
  const resolvedRightIcon =
    rightIcon ??
    (iconRight ? <WindowIcon className={clsx(sizeStyles.icon, "shrink-0")} /> : null);

  function handleClick(event) {
    if (isInteractive && persistSelection) {
      const nextSelected = true;

      if (typeof selected !== "boolean") {
        setInternalSelected(nextSelected);
      }

      onSelectedChange?.(nextSelected);
    }

    onClick?.(event);
  }

  return (
    <Component
      type={isInteractive ? "button" : undefined}
      className={clsx(
        "inline-flex items-center justify-center px-[12px] py-[8px] outline-none transition-colors duration-150",
        resolvedStyle === "Brand" && "rounded-[var(--radius-2)]",
        resolvedStyle === "Underline" && "px-[4px] pb-[8px]",
        resolvedStyle === "Divider" && "justify-start py-[8px] pl-[12px] pr-0",
        sizeStyles[resolvedStyle],
        visualSpec.containerClassName,
        isInteractive && "cursor-pointer focus-visible:ring-2 focus-visible:ring-[var(--color-primary-10)]",
        className,
      )}
      data-node-id={TAB_ITEM_NODE_IDS[resolvedStyle][resolvedSize][resolvedState]}
      onMouseEnter={isInteractive ? () => setIsHovered(true) : undefined}
      onMouseLeave={isInteractive ? () => setIsHovered(false) : undefined}
      onClick={handleClick}
      {...props}
    >
      <span
        className={clsx(
          "inline-flex items-center gap-[8px]",
          resolvedRightIcon && "w-full justify-between",
          visualSpec.contentClassName,
        )}
      >
        <span className="inline-flex min-w-0 items-center gap-[8px]">
          {resolvedLeftIcon}

          <span className="text-heading-8 whitespace-nowrap">
            {label}
          </span>
        </span>

        {resolvedRightIcon ? (
          <span className="inline-flex shrink-0 items-center justify-center">
            {resolvedRightIcon}
          </span>
        ) : null}
      </span>
    </Component>
  );
}

export default TabItem;
