/* Renderiza alertas temáticas con acciones, cierre opcional y soporte de ancho completo. */
import { useState } from "react";
import clsx from "clsx";
import Button from "../Button/Button.jsx";
import {
  ALERT_DEFAULT_PROPS,
  ALERT_LAYOUTS,
  ALERT_THEMES,
} from "./alertConfig.js";

const ALERT_NODE_IDS = {
  Brand: {
    Box: "2068:22209",
    "Full width": "2068:22220",
  },
  Warning: {
    Box: "2068:22231",
    "Full width": "2068:22242",
  },
  Danger: {
    Box: "2068:22253",
    "Full width": "2068:22264",
  },
  Success: {
    Box: "2068:22275",
    "Full width": "2068:22286",
  },
  Info: {
    Box: "2068:22297",
    "Full width": "2068:22308",
  },
  content: "2068:22210",
  text: "2068:22213",
  description: "2068:22215",
  actions: "2068:22216",
  close: "2068:22219",
};

const ALERT_THEME_STYLES = {
  Brand: {
    border: "border-[var(--color-primary-300)]",
    tint: "bg-[var(--color-primary-10)]",
    icon: "text-[var(--color-primary-300)]",
    close:
      "text-[var(--color-text-100)] hover:bg-[var(--color-primary-10)] hover:text-[var(--color-text-300)]",
  },
  Warning: {
    border: "border-[var(--color-warning-200)]",
    tint: "bg-[var(--color-warning-10)]",
    icon: "text-[var(--color-warning-200)]",
    close:
      "text-[var(--color-warning-200)] hover:bg-[var(--color-warning-10)] hover:text-[var(--color-warning-200)]",
  },
  Danger: {
    border: "border-[var(--color-danger-200)]",
    tint: "bg-[var(--color-danger-10)]",
    icon: "text-[var(--color-danger-100)]",
    close:
      "text-[var(--color-danger-100)] hover:bg-[var(--color-danger-10)] hover:text-[var(--color-danger-100)]",
  },
  Success: {
    border: "border-[var(--color-success-200)]",
    tint: "bg-[var(--color-success-10)]",
    icon: "text-[var(--color-success-200)]",
    close:
      "text-[var(--color-success-200)] hover:bg-[var(--color-success-10)] hover:text-[var(--color-success-200)]",
  },
  Info: {
    border: "border-[var(--color-info-200)]",
    tint: "bg-[var(--color-info-10)]",
    icon: "text-[var(--color-info-200)]",
    close:
      "text-[var(--color-info-200)] hover:bg-[var(--color-info-10)] hover:text-[var(--color-info-200)]",
  },
};

// Icono informativo usado por la mayoría de temas de alerta.
function InfoCircleIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M10 18.3337C14.6024 18.3337 18.3333 14.6027 18.3333 10.0003C18.3333 5.39795 14.6024 1.66699 10 1.66699C5.39762 1.66699 1.66666 5.39795 1.66666 10.0003C1.66666 14.6027 5.39762 18.3337 10 18.3337Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M10 6.66699V10.41699"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="10" cy="13.333" r="0.833333" fill="currentColor" />
    </svg>
  );
}

// Icono específico para alertas de éxito.
function TickCircleIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <circle
        cx="10"
        cy="10"
        r="8.25"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M6.5 10.1L8.8 12.4L13.5 7.7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Icono usado por el botón para cerrar la alerta.
function CloseIcon({ className }) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M2 2L10 10"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <path
        d="M10 2L2 10"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Valida el tema solicitado y aplica el valor por defecto si es inválido.
function getResolvedTheme(theme) {
  return ALERT_THEMES.includes(theme) ? theme : ALERT_DEFAULT_PROPS.theme;
}

// Valida el layout solicitado y aplica el valor por defecto si es inválido.
function getResolvedLayout(layout) {
  return ALERT_LAYOUTS.includes(layout) ? layout : ALERT_DEFAULT_PROPS.layout;
}

// Selecciona el icono principal según el tema de la alerta.
function getAlertIcon(theme, className) {
  if (theme === "Success") {
    return <TickCircleIcon className={className} />;
  }

  return <InfoCircleIcon className={className} />;
}

// Adapta el tema de los botones de acción al tipo de alerta.
function getAlertButtonTheme(theme) {
  if (theme === "Danger") {
    return "Danger";
  }

  if (theme === "Info") {
    return "Info";
  }

  return "Primary";
}

// Coordina visibilidad, tema, layout, acciones y accesibilidad del mensaje.
function Alert({
  className,
  title = ALERT_DEFAULT_PROPS.title,
  description = ALERT_DEFAULT_PROPS.description,
  theme = ALERT_DEFAULT_PROPS.theme,
  layout = ALERT_DEFAULT_PROPS.layout,
  showIcon = ALERT_DEFAULT_PROPS.showIcon,
  showText = ALERT_DEFAULT_PROPS.showText,
  showActions = ALERT_DEFAULT_PROPS.showActions,
  showCloseButton = ALERT_DEFAULT_PROPS.showCloseButton,
  visible = ALERT_DEFAULT_PROPS.visible,
  defaultVisible = ALERT_DEFAULT_PROPS.defaultVisible,
  secondaryActionLabel = ALERT_DEFAULT_PROPS.secondaryActionLabel,
  primaryActionLabel = ALERT_DEFAULT_PROPS.primaryActionLabel,
  primaryActionDisabled = false,
  onDismiss,
  onPrimaryAction,
  onSecondaryAction,
  "aria-label": ariaLabel = ALERT_DEFAULT_PROPS["aria-label"],
  ...props
}) {
  const [internalVisible, setInternalVisible] = useState(defaultVisible);
  const isVisibleControlled = typeof visible === "boolean";
  const isVisible = isVisibleControlled ? visible : internalVisible;
  const resolvedTheme = getResolvedTheme(theme);
  const resolvedLayout = getResolvedLayout(layout);
  const visual = ALERT_THEME_STYLES[resolvedTheme];
  const isFullWidth = resolvedLayout === "Full width";

  if (!isVisible) {
    return null;
  }

  const handleDismiss = () => {
    if (!isVisibleControlled) {
      setInternalVisible(false);
    }

    onDismiss?.();
  };

  return (
    <article
      className={clsx(
        "relative flex gap-[16px] transition-colors duration-200",
        isFullWidth
          ? clsx(
              "w-full items-center justify-center border-b px-[24px] py-[12px]",
              visual.border,
              visual.tint,
            )
          : clsx(
              "w-full max-w-[722.615px] items-start rounded-[var(--radius-3)] border p-[16px] bg-[var(--color-neutral-100)]",
              visual.border,
            ),
        className,
      )}
      role="alert"
      aria-live="assertive"
      aria-label={ariaLabel}
      data-node-id={ALERT_NODE_IDS[resolvedTheme][resolvedLayout]}
      {...props}
    >
      <div
        className={clsx(
          "flex min-w-0 flex-1 gap-[16px]",
          isFullWidth ? "items-start min-[900px]:items-center" : "items-start",
          showCloseButton && "pr-[28px]",
        )}
        data-node-id={ALERT_NODE_IDS.content}
      >
        {showIcon ? (
          <span
            className={clsx(
              "inline-flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-2)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e1)]",
              visual.icon,
            )}
          >
            {getAlertIcon(resolvedTheme, "size-5")}
          </span>
        ) : null}

        <div
          className={clsx(
            "flex min-w-0 flex-1",
            isFullWidth
              ? "flex-col items-start gap-[12px] min-[900px]:flex-row min-[900px]:items-center min-[900px]:justify-between min-[900px]:gap-[16px]"
              : "flex-col items-start gap-[8px]",
          )}
        >
          <div
            className={clsx(
              "flex flex-col gap-[4px]",
              isFullWidth && "min-w-0 flex-1",
            )}
            data-node-id={ALERT_NODE_IDS.text}
          >
            <p className="text-heading-8 text-[var(--color-text-300)]">
              {title}
            </p>
            {showText ? (
              <p
                className="text-body-3 text-[var(--color-text-200)]"
                data-node-id={ALERT_NODE_IDS.description}
              >
                {description}
              </p>
            ) : null}
          </div>

          {showActions ? (
            <div
              className={clsx(
                "flex shrink-0 gap-[12px]",
                isFullWidth
                  ? "w-full flex-wrap items-center min-[900px]:w-auto min-[900px]:flex-nowrap min-[900px]:justify-end"
                  : "flex-wrap items-center",
              )}
              data-node-id={ALERT_NODE_IDS.actions}
            >
              <Button
                theme={getAlertButtonTheme(resolvedTheme)}
                type="Outline"
                size="S"
                fitContent
                showLeftIcon={false}
                showRightIcon={false}
                onClick={onSecondaryAction}
              >
                {secondaryActionLabel}
              </Button>
              <Button
                theme={getAlertButtonTheme(resolvedTheme)}
                type="Solid"
                size="S"
                fitContent
                showLeftIcon={false}
                showRightIcon={false}
                disabled={primaryActionDisabled}
                onClick={onPrimaryAction}
              >
                {primaryActionLabel}
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {showCloseButton ? (
        <Button
          theme="Primary"
          type="Ghost"
          size="S"
          showText={false}
          showLeftIcon
          showRightIcon={false}
          iconLeft={<CloseIcon className="size-3" />}
          className={clsx("absolute right-0 top-0", visual.close)}
          aria-label="Cerrar alerta"
          tooltip={false}
          onClick={handleDismiss}
          data-node-id={ALERT_NODE_IDS.close}
        />
      ) : null}
    </article>
  );
}

export default Alert;
