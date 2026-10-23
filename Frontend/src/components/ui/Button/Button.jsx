/* Renderiza botones reutilizables con variantes visuales, iconos, estados y tooltip opcional. */
import clsx from "clsx";
import Tooltip from "../Tooltip/Tooltip.jsx";
import { resolveIconButtonTooltip } from "./buttonTooltip.js";
import {
  BUTTON_INTERACTIVE_STYLES,
  BUTTON_SIZE_STYLES,
  BUTTON_VISUALS,
} from "./buttonConfig.js";

/**
 * Normaliza las variantes y accesibilidad del botón reutilizable. Su ayuda es autónoma salvo
 * que el consumidor controle la apertura para coordinarla con otras capas, sin cambiar el diseño.
 * @param {Object} props - Variantes, contenido y atributos nativos del botón.
 * @param {boolean} [props.tooltipOpen] - Apertura controlada de la ayuda opcional.
 * @param {(open: boolean) => void} [props.onTooltipOpenChange] - Solicitudes de apertura y cierre.
 * @returns {import("react").ReactElement} Botón con su ayuda opcional en portal.
 */
function Button({
  className,
  children = "Button",
  iconLeft = null,
  iconRight = null,
  showLeftIcon = true,
  showRightIcon = true,
  showText = true,
  fitContent = false,
  size = "S",
  state = "Default",
  theme = "Primary",
  type = "Solid",
  htmlType = "button",
  disabled = false,
  style,
  tooltip,
  tooltipPosition = "Top center",
  // Opcionales: permiten coordinar las capas de una tabla sin desactivar los tooltips globales.
  tooltipOpen,
  onTooltipOpenChange,
  "aria-label": ariaLabel,
  ...props
}) {
  const resolvedTheme = BUTTON_VISUALS[theme] ? theme : "Primary";
  const resolvedType = BUTTON_VISUALS[resolvedTheme]?.[type] ? type : "Solid";
  const resolvedSize = BUTTON_SIZE_STYLES[size] ? size : "S";
  const resolvedState = disabled ? "Disabled" : state;
  const visual = BUTTON_VISUALS[resolvedTheme][resolvedType];
  const isLink = resolvedType === "Link";
  const iconOnly = !showText;
  const isDisabled = resolvedState === "Disabled";
  const interactiveClassName =
    BUTTON_INTERACTIVE_STYLES[resolvedTheme]?.[resolvedType];
  const showFocusRing =
    !isLink && !isDisabled && resolvedState === "Focused";
  const focusStyle = showFocusRing
    ? {
        outline: `var(--stroke-2) solid ${visual.FocusedOuter}`,
        outlineOffset: "0px",
      }
    : undefined;

  const buttonClassName = clsx(
    "flex items-center justify-center overflow-visible rounded-[var(--radius-2)] font-medium tracking-[-0.5px] transition-colors duration-150 motion-reduce:transition-none",
    isDisabled ? "cursor-not-allowed" : "cursor-pointer",
    iconOnly
      ? BUTTON_SIZE_STYLES[resolvedSize].iconOnly
      : isLink
        ? fitContent
          ? BUTTON_SIZE_STYLES[resolvedSize].linkFitContent
          : BUTTON_SIZE_STYLES[resolvedSize].link
        : fitContent
          ? BUTTON_SIZE_STYLES[resolvedSize].defaultFitContent
          : BUTTON_SIZE_STYLES[resolvedSize].default,
    resolvedState === "Default" && visual.Default,
    resolvedState === "Hover" && visual.Hover,
    resolvedState === "Disabled" && visual.Disabled,
    resolvedState === "Focused" && visual.FocusedInner,
    resolvedState === "Default" && !disabled && interactiveClassName,
    className,
  );

  const button = (
    <button
      type={htmlType}
      className={buttonClassName}
      disabled={isDisabled}
      style={{
        ...style,
        ...focusStyle,
      }}
      aria-label={ariaLabel}
      {...props}
    >
      {showLeftIcon && iconLeft ? (
        <span
          className="inline-flex shrink-0 items-center justify-center"
          aria-hidden="true"
        >
          {iconLeft}
        </span>
      ) : null}
      {showText ? (
        <span
          className={clsx(
            "inline-flex items-center justify-center",
            fitContent && "whitespace-nowrap",
            BUTTON_SIZE_STYLES[resolvedSize].text,
          )}
        >
          {children}
        </span>
      ) : null}
      {showText && showRightIcon && iconRight ? (
        <span
          className="inline-flex shrink-0 items-center justify-center"
          aria-hidden="true"
        >
          {iconRight}
        </span>
      ) : null}
    </button>
  );

  const tooltipText = resolveIconButtonTooltip({
    ariaLabel,
    showText,
    tooltip,
  });

  return tooltipText ? (
    <Tooltip
      asChild
      portal
      showTip
      text={tooltipText}
      tipPosition={tooltipPosition}
      open={tooltipOpen}
      onOpenChange={onTooltipOpenChange}
    >
      {button}
    </Tooltip>
  ) : (
    button
  );
}

export default Button;
