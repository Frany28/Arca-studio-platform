/* Renderiza etiquetas de estado con texto, punto, bandera o iconos según su variante. */
import clsx from "clsx";
import Flag from "../../Flag.jsx";
import {
  BADGE_SIZE_STYLES,
  BADGE_THEME_STYLES,
  BADGE_VARIATION_CLASSNAMES,
} from "./badgeConfig.js";

// Icono de respaldo usado en los laterales del badge cuando no se proporciona otro.
function CloseIcon({ className }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={clsx("shrink-0", className)}
      aria-hidden="true"
    >
      <path
        d="M10.6667 5.33301L5.33337 10.6663"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <path
        d="M5.33337 5.33301L10.6667 10.6663"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Valida tema, variante y tamaño usando valores seguros por defecto.
function resolveBadgeProps(theme, variation, size) {
  const resolvedTheme = BADGE_THEME_STYLES[theme] ? theme : "Brand 1";
  const resolvedVariation = BADGE_VARIATION_CLASSNAMES[variation]
    ? variation
    : "Simple";
  const resolvedSize = BADGE_SIZE_STYLES[size] ? size : "S";

  return { resolvedTheme, resolvedVariation, resolvedSize };
}

// Resuelve la apariencia final del badge y renderiza solo los elementos de la variante activa.
function Badge({
  className,
  label = "Label",
  theme = "Brand 1",
  variation = "Simple",
  size = "S",
  iconLeft = false,
  iconRight = false,
  leftIcon = null,
  rightIcon = null,
  element = null,
  countryCode = "IN",
  ...props
}) {
  const { resolvedTheme, resolvedVariation, resolvedSize } = resolveBadgeProps(
    theme,
    variation,
    size,
  );
  const visual = BADGE_THEME_STYLES[resolvedTheme];
  const sizing = BADGE_SIZE_STYLES[resolvedSize];
  const isDot = resolvedVariation === "Dot";
  const isFlagAvatar = resolvedVariation === "Flag / Avatar";
  const isSimple = resolvedVariation === "Simple";

  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-[var(--radius-full)] border tracking-[-0.5px]",
        visual.container,
        BADGE_VARIATION_CLASSNAMES[resolvedVariation],
        isSimple && sizing.simple,
        isDot && sizing.dot,
        isFlagAvatar && sizing.flagAvatar,
        className,
      )}
      {...props}
    >
      {isFlagAvatar ? (
        element ?? <Flag countryCode={countryCode} size="16px" title={countryCode} />
      ) : null}

      {isDot ? (
        <span
          className={clsx("shrink-0 rounded-full", sizing.dotSize, visual.dot)}
          aria-hidden="true"
        />
      ) : null}

      {iconLeft && !isDot && !isFlagAvatar ? (
        <span
          className={clsx("inline-flex items-center justify-center", sizing.icon, visual.content)}
          aria-hidden="true"
        >
          {leftIcon ?? <CloseIcon className={sizing.icon} />}
        </span>
      ) : null}

      <span className={clsx("inline-flex items-center whitespace-nowrap", sizing.text, visual.content)}>
        {label}
      </span>

      {iconRight && !isDot && !isFlagAvatar ? (
        <span
          className={clsx("inline-flex items-center justify-center", sizing.icon, visual.content)}
          aria-hidden="true"
        >
          {rightIcon ?? <CloseIcon className={sizing.icon} />}
        </span>
      ) : null}
    </span>
  );
}

export default Badge;
