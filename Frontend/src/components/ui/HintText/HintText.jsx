/* Renderiza mensajes de ayuda, error o progreso de contraseña para campos de formulario. */
import clsx from "clsx";
import {
  HINT_TEXT_STATE_STYLES,
  PASSWORD_SEGMENT_STYLES,
  PASSWORD_DEFAULT_REQUIREMENTS,
} from "./hintTextConfig.js";

// Icono informativo usado en mensajes de ayuda normales.
function InfoCircleIcon({ className }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="8" fill="currentColor" />
      <path
        d="M8 4.8V8.55"
        stroke="white"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="8" cy="10.7" r="0.9" fill="white" />
    </svg>
  );
}

// Icono informativo específico para mensajes de error.
function ErrorInfoCircleIcon({ className }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="8" fill="currentColor" />
      <path
        d="M8 4.4V9"
        stroke="white"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="8" cy="11.6" r="1" fill="white" />
    </svg>
  );
}

// Icono usado para requisitos de contraseña pendientes.
function CloseCircleIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12.75 7.25L7.25 12.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M7.25 7.25L12.75 12.75"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Icono usado para requisitos de contraseña cumplidos.
function TickCircleIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.5" />
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

// Convierte el progreso o estado de contraseña en segmentos visuales.
function getPasswordSegments(state) {
  if (typeof state === "number") {
    if (state <= 0) {
      return ["idle", "idle", "idle"];
    }

    if (state === 1) {
      return ["error", "idle", "idle"];
    }

    if (state === 2) {
      return ["error", "warning", "idle"];
    }

    return ["error", "warning", "success"];
  }

  switch (state) {
    case "Error":
      return ["error", "idle", "idle"];
    case "Warning":
      return ["error", "warning", "idle"];
    case "Success":
      return ["error", "warning", "success"];
    default:
      return ["idle", "idle", "idle"];
  }
}

// Selecciona entre ayuda estándar o validación de contraseña según el tipo recibido.
function HintText({
  className,
  type = "Hint",
  state = "Default",
  hintText = "Texto de ayuda para los usuarios",
  hintIcon = true,
  icon = null,
  passwordTitle = "Debe contener al menos:",
  requirements = PASSWORD_DEFAULT_REQUIREMENTS,
  passwordProgress = null,
  ...props
}) {
  const resolvedState = HINT_TEXT_STATE_STYLES[state] ? state : "Default";
  const visual = HINT_TEXT_STATE_STYLES[resolvedState];

  if (type === "Password") {
    const segments = getPasswordSegments(
      typeof passwordProgress === "number" ? passwordProgress : resolvedState,
    );
    const isDisabled = resolvedState === "Disabled";
    const titleColor = isDisabled
      ? "text-[var(--color-neutral-300)]"
      : resolvedState === "Error"
        ? "text-[var(--color-danger-100)]"
        : resolvedState === "Success"
          ? "text-[var(--color-success-200)]"
          : "text-[var(--color-text-100)]";
    const requirementColor = isDisabled
      ? "text-[var(--color-neutral-300)]"
      : "text-[var(--color-text-100)]";

    return (
      <div className={clsx("inline-flex w-[300px] flex-col items-start gap-[8px]", className)} {...props}>
        <div className="flex w-full items-start gap-[8px]">
          {segments.map((segment, index) => (
            <span
              key={`${segment}-${index}`}
              className={clsx(
                "h-[4px] min-h-px min-w-px flex-1 rounded-[var(--radius-full)]",
                PASSWORD_SEGMENT_STYLES[segment],
              )}
              aria-hidden="true"
            />
          ))}
        </div>

        <p className={clsx("w-full text-body-3 tracking-[-0.5px]", titleColor)}>
          {passwordTitle}
        </p>

        {requirements.map((requirement) => {
          const met =
            typeof requirement.met === "boolean"
              ? requirement.met
              : requirement.metInStates?.includes(resolvedState);
          const statusColor = isDisabled
            ? "text-[var(--color-neutral-300)]"
            : met
              ? "text-[var(--color-success-200)]"
              : "text-[var(--color-neutral-400)]";

          return (
            <div key={requirement.label} className="flex w-full items-center gap-[4px]">
              <span className={clsx("inline-flex size-5 shrink-0 items-center justify-center", statusColor)} aria-hidden="true">
                {met ? (
                  <TickCircleIcon className="size-5 shrink-0" />
                ) : (
                  <CloseCircleIcon className="size-5 shrink-0" />
                )}
              </span>
              <p className={clsx("min-h-px min-w-px flex-1 text-body-3 tracking-[-0.5px]", requirementColor)}>
                {requirement.label}
              </p>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={clsx("inline-flex min-w-0 items-start gap-[2px]", className)} {...props}>
      {hintIcon ? (
        <span className={clsx("inline-flex size-4 shrink-0 items-center justify-center", visual.icon)} aria-hidden="true">
          {icon ??
            (resolvedState === "Error" ? (
              <ErrorInfoCircleIcon className="size-4 shrink-0" />
            ) : (
              <InfoCircleIcon className="size-4 shrink-0" />
            ))}
        </span>
      ) : null}

      {hintText ? (
        <p
          className={clsx(
            "text-body-3 min-w-0 flex-1 whitespace-normal break-words tracking-[-0.5px]",
            visual.text,
          )}
        >
          {hintText}
        </p>
      ) : null}
    </div>
  );
}

export default HintText;
