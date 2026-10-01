/* Renderiza avatares con imagen, iniciales o icono y aplica tamaños, temas y accesibilidad. */
import { useId, useState } from "react";
import clsx from "clsx";
import {
  AVATAR_DEFAULT_PROPS,
  AVATAR_SIZE_STYLES,
  AVATAR_THEME_STYLES,
} from "./avatarConfig.js";

// Icono de respaldo usado cuando el avatar no muestra imagen ni iniciales.
function AvatarIcon({ className }) {
  const clipPathId = useId();

  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={clsx("block", className)}
      aria-hidden="true"
    >
      <g clipPath={`url(#${clipPathId})`}>
        <path
          d="M20.1961 9.97461C16.2419 9.97461 13.0392 13.1773 13.0392 17.1315C13.0392 21.0856 16.2419 24.2883 20.1961 24.2883C24.1502 24.2883 27.3529 21.0856 27.3529 17.1315C27.3529 13.1773 24.1502 9.97461 20.1961 9.97461ZM20.1961 26.0776C15.4189 26.0776 5.88235 28.4751 5.88235 33.2344V43.9697H34.5098V33.2344C34.5098 28.4751 24.9733 26.0776 20.1961 26.0776Z"
          fill="currentColor"
        />
      </g>
      <defs>
        <clipPath id={clipPathId}>
          <path
            d="M0 20C0 8.95431 8.95431 0 20 0C31.0457 0 40 8.95431 40 20C40 31.0457 31.0457 40 20 40C8.95431 40 0 31.0457 0 20Z"
            fill="white"
          />
        </clipPath>
      </defs>
    </svg>
  );
}

// Limpia y limita las iniciales a un máximo de dos caracteres.
function normalizeInitials(initials) {
  const sanitized = String(initials ?? "")
    .trim()
    .replace(/\s+/g, "")
    .slice(0, 2)
    .toUpperCase();

  return sanitized || "JS";
}

// Obtiene iniciales a partir del nombre cuando no se proporcionan explícitamente.
function getInitialsFromName(name) {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

// Resuelve contenido, estilos y atributos accesibles antes de renderizar el avatar.
function Avatar({
  className,
  size = AVATAR_DEFAULT_PROPS.size,
  theme = AVATAR_DEFAULT_PROPS.theme,
  content = AVATAR_DEFAULT_PROPS.content,
  style,
  initials = AVATAR_DEFAULT_PROPS.initials,
  name = AVATAR_DEFAULT_PROPS.name,
  src = null,
  alt = "",
  decorative = AVATAR_DEFAULT_PROPS.decorative,
  icon = null,
  ...props
}) {
  const [failedImageSrc, setFailedImageSrc] = useState("");
  const resolvedSize = AVATAR_SIZE_STYLES[size] ? size : AVATAR_DEFAULT_PROPS.size;
  const resolvedTheme = AVATAR_THEME_STYLES[theme]
    ? theme
    : AVATAR_DEFAULT_PROPS.theme;
  const sizing = AVATAR_SIZE_STYLES[resolvedSize];
  const visual = AVATAR_THEME_STYLES[resolvedTheme];
  const resolvedStyle = style === "Text" || style === "Icon" ? style : null;
  const resolvedContentInput = resolvedStyle ?? content;
  const computedInitials = initials || getInitialsFromName(name);
  const normalizedInitials = normalizeInitials(computedInitials);
  const usesImage =
    typeof src === "string" &&
    src.trim().length > 0 &&
    failedImageSrc !== src;
  const resolvedContent = usesImage
    ? "Image"
    : resolvedContentInput === "Text"
      ? "Text"
      : "Icon";
  const accessibilityProps = decorative
    ? { "aria-hidden": "true" }
    : { role: "img", "aria-label": alt || name || normalizedInitials };

  return (
    <span
      className={clsx(
        "relative inline-flex shrink-0 overflow-hidden rounded-full leading-none",
        resolvedContent === "Text" && "items-center justify-center",
        sizing.container,
        visual.container,
        className,
      )}
      {...accessibilityProps}
      {...props}
    >
      {resolvedContent === "Image" ? (
        <img
          src={src}
          alt=""
          className="size-full object-cover"
          aria-hidden="true"
          onError={() => setFailedImageSrc(src)}
        />
      ) : null}

      {resolvedContent === "Icon" ? (
        <span
          className={clsx(
            "absolute inset-0 block",
            visual.content,
          )}
          aria-hidden="true"
        >
          {icon ?? <AvatarIcon className="size-full" />}
        </span>
      ) : null}

      {resolvedContent === "Text" ? (
        <span
          className={clsx(
            "inline-flex items-center justify-center tracking-[-0.5px]",
            sizing.text,
            visual.content,
          )}
        >
          {normalizedInitials}
        </span>
      ) : null}
    </span>
  );
}

export default Avatar;
