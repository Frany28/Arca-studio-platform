/* Renderiza etiquetas de formulario con indicador requerido e icono informativo opcional. */
import clsx from "clsx";
import { LABEL_STATE_STYLES } from "./labelConfig.js";

// Icono informativo predeterminado mostrado junto al texto de la etiqueta.
function InfoCircleIcon({ className }) {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="9" fill="currentColor" />
      <path
        d="M9 5.8V9.55"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="9" cy="11.85" r="1" fill="white" />
    </svg>
  );
}

// Resuelve el estado visual y construye la etiqueta asociada al campo.
function Label({
  className,
  label = "Label",
  state = "Default",
  required = true,
  information = true,
  htmlFor,
  infoIcon = null,
  ...props
}) {
  const resolvedState = LABEL_STATE_STYLES[state] ? state : "Default";
  const styles = LABEL_STATE_STYLES[resolvedState];

  return (
    <label
      htmlFor={htmlFor}
      className={clsx(
        "inline-flex items-center gap-[2px] tracking-[-0.5px]",
        className,
      )}
      {...props}
    >
      <span className={clsx("text-heading-8 whitespace-nowrap", styles.label)}>
        {label}
      </span>

      {required ? (
        <span className={clsx("text-body-3 whitespace-nowrap", styles.meta)}>
          *
        </span>
      ) : null}

      {information ? (
        <span
          className={clsx(
            "inline-flex size-[18px] items-center justify-center",
            styles.info,
          )}
          aria-hidden="true"
        >
          {infoIcon ?? <InfoCircleIcon className="size-[15px] shrink-0" />}
        </span>
      ) : null}
    </label>
  );
}

export default Label;
