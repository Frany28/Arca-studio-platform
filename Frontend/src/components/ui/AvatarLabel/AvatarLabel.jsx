/* Combina un Avatar con nombre y subtítulo para identificar usuarios de forma consistente. */
import clsx from "clsx";
import Avatar from "../Avatar/Avatar.jsx";
import {
  AVATAR_LABEL_DEFAULT_PROPS,
  AVATAR_LABEL_SIZE_STYLES,
} from "./avatarLabelConfig.js";

// Normaliza texto, tamaño y contenido del avatar antes de renderizar la etiqueta.
function AvatarLabel({
  className,
  size = AVATAR_LABEL_DEFAULT_PROPS.size,
  label = AVATAR_LABEL_DEFAULT_PROPS.label,
  subtitle = AVATAR_LABEL_DEFAULT_PROPS.subtitle,
  showLabel = AVATAR_LABEL_DEFAULT_PROPS.showLabel,
  showSubtitle = AVATAR_LABEL_DEFAULT_PROPS.showSubtitle,
  avatarTheme = AVATAR_LABEL_DEFAULT_PROPS.avatarTheme,
  avatarContent = AVATAR_LABEL_DEFAULT_PROPS.avatarContent,
  avatarInitials = AVATAR_LABEL_DEFAULT_PROPS.avatarInitials,
  avatarName = AVATAR_LABEL_DEFAULT_PROPS.avatarName,
  avatarSrc = null,
  avatarAlt = "",
  avatarDecorative = AVATAR_LABEL_DEFAULT_PROPS.avatarDecorative,
  avatarClassName,
  textClassName,
  subtitleClassName,
  ...props
}) {
  const resolvedSize = AVATAR_LABEL_SIZE_STYLES[size]
    ? size
    : AVATAR_LABEL_DEFAULT_PROPS.size;
  const styles = AVATAR_LABEL_SIZE_STYLES[resolvedSize];
  const hasText = showLabel || showSubtitle;
  // Convierte valores inesperados a texto seguro para evitar renderizados inválidos.
  const resolveString = (value) => {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean")
      return String(value);
    if (typeof value === "object") {
      return value.name ?? value.email ?? JSON.stringify(value);
    }
    return String(value);
  };

  const safeLabel = resolveString(label);
  const safeSubtitle = resolveString(subtitle);

  return (
    <span
      className={clsx(
        "inline-flex shrink min-w-0 items-center",
        hasText && styles.container,
        className,
      )}
      {...props}
    >
      <Avatar
        size={styles.avatarSize}
        theme={avatarTheme}
        content={avatarContent}
        initials={avatarInitials}
        name={avatarName || label}
        src={avatarSrc}
        alt={avatarAlt}
        decorative={avatarDecorative}
        className={clsx(
          "border-0 border-transparent outline-none ring-0 shadow-none",
          avatarClassName,
        )}
      />

      {hasText ? (
        <span
          className={clsx(
            "flex min-w-0 shrink flex-col items-start",
            styles.textGroup,
          )}
        >
          {showLabel ? (
            <span
              className={clsx(
                "block max-w-full truncate tracking-[-0.5px] text-[var(--color-text-300)]",
                styles.label,
                textClassName,
              )}
            >
              {safeLabel}
            </span>
          ) : null}

          {showSubtitle ? (
            <span
              className={clsx(
                "block max-w-full truncate tracking-[-0.5px] text-[var(--color-text-200)]",
                styles.subtitle,
                subtitleClassName,
              )}
            >
              {safeSubtitle}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

export default AvatarLabel;
