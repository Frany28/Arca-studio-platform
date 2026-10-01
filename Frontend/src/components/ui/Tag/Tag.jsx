/* Renderiza tags configurables con avatar, bandera, estado, contador y acción de eliminación opcional. */
import clsx from "clsx";
import Flag from "../../Flag.jsx";
import Avatar from "../Avatar/Avatar.jsx";
import {
  TAG_BASE_STYLES,
  TAG_INTERACTIVE_STYLES,
  TAG_SIZE_STYLES,
} from "./tagConfig.js";

// Icono visual usado para cerrar o eliminar un tag.
function CloseIcon({ className }) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={clsx("shrink-0", className)}
      aria-hidden="true"
    >
      <path
        d="M8.5 3.5L3.5 8.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <path
        d="M3.5 3.5L8.5 8.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Indicador de estado simple mostrado dentro del tag.
function DotIndicator() {
  return (
    <span className="inline-flex size-4 items-center justify-center" aria-hidden="true">
      <span className="size-2 rounded-full bg-[var(--color-success-200)]" />
    </span>
  );
}

// Representación visual opcional de checkbox dentro del tag.
function Checkbox({ className }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[0px_2px_4px_0px_rgba(27,28,29,0.04)]",
        className,
      )}
      aria-hidden="true"
    />
  );
}

// Coordina contenido, interacción, selección y acciones disponibles del tag.
function Tag({
  className,
  label = "Label",
  size = "S",
  type = "Universal tag",
  avatar = true,
  checkbox = false,
  closeIcon = true,
  count = true,
  dotIndicator = false,
  flag = false,
  countValue = "5",
  countryCode = "IN",
  avatarText = "A",
  avatarSrc = "",
  avatarTheme = "Neutral",
  avatarContent = "Text",
  selected = false,
  interactive = false,
  disabled = false,
  onClick,
  onRemove,
  ...props
}) {
  const resolvedSize = TAG_SIZE_STYLES[size] ? size : "S";
  const sizing = TAG_SIZE_STYLES[resolvedSize];
  const hasSelectAction = Boolean(onClick) && !onRemove;
  const Component = hasSelectAction ? "button" : "span";

  if (type !== "Universal tag") {
    return null;
  }

  return (
    <Component
      type={hasSelectAction ? "button" : undefined}
      className={clsx(
        TAG_BASE_STYLES,
        TAG_INTERACTIVE_STYLES.default,
        "shrink-0",
        (interactive || hasSelectAction) &&
          !disabled &&
          TAG_INTERACTIVE_STYLES.interactive,
        selected && TAG_INTERACTIVE_STYLES.selected,
        disabled && TAG_INTERACTIVE_STYLES.disabled,
        sizing.container,
        className,
      )}
      onClick={disabled || !hasSelectAction ? undefined : onClick}
      disabled={hasSelectAction ? disabled : undefined}
      aria-label={hasSelectAction ? `Seleccionar ${label}` : undefined}
      aria-pressed={hasSelectAction ? selected : undefined}
      {...props}
    >
      {checkbox ? <Checkbox className={sizing.checkbox} /> : null}
      {flag ? <Flag countryCode={countryCode} size={resolvedSize === "L" ? "20px" : "16px"} title={countryCode} /> : null}
      {avatar ? (
        <Avatar
          size="XS"
          theme={avatarTheme}
          content={avatarContent}
          initials={avatarText}
          name={label}
          src={avatarSrc}
          decorative
          className={sizing.avatar}
        />
      ) : null}
      {dotIndicator ? <DotIndicator /> : null}
      <span
        className={clsx(
          "inline-flex min-w-0 flex-1 items-center overflow-hidden text-ellipsis whitespace-nowrap text-[var(--color-text-200)]",
          sizing.text,
        )}
      >
        {label}
      </span>
      {count ? (
        <span className="inline-flex w-4 items-center justify-center rounded-[2px] bg-[var(--color-neutral-200)] px-[2px]">
          <span className={clsx("inline-flex items-center text-[var(--color-text-300)]", sizing.countText)}>
            {countValue}
          </span>
        </span>
      ) : null}
      {closeIcon && onRemove ? (
        <button
          type="button"
          className={clsx(
            "inline-flex items-center justify-center text-[var(--color-text-200)]",
            disabled ? "cursor-not-allowed" : "cursor-pointer",
            sizing.icon,
          )}
          onClick={(event) => {
            event.stopPropagation();
            if (!disabled) onRemove();
          }}
          disabled={disabled}
          aria-label={`Quitar ${label}`}
        >
          <CloseIcon className={sizing.icon} />
        </button>
      ) : closeIcon ? (
        <span
          className={clsx(
            "inline-flex items-center justify-center text-[var(--color-text-200)]",
            sizing.icon,
          )}
          aria-hidden="true"
        >
          <CloseIcon className={sizing.icon} />
        </span>
      ) : null}
    </Component>
  );
}

export default Tag;
