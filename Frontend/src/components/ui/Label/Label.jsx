/* Renderiza etiquetas de formulario con indicador requerido e icono informativo opcional. */
import clsx from "clsx";
import { LABEL_STATE_STYLES } from "./labelConfig.js";
import { InfoCircleIcon } from "./LabelIcons.jsx";

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
