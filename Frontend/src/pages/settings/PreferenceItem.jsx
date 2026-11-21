/**
 * Fila de Preferencias («Progress section» de Figma 3727:688298): icono de 40 px, título h8 y
 * descripción b3, y el control a la derecha. El texto ocupa el espacio libre y se ajusta en varias
 * líneas, así que los interruptores siguen en la misma fila en móvil; solo un control ancho
 * (selector de tema, `settings-form-field`) baja a su propia línea cuando no cabe (SettingsPage.css).
 *
 * @param {Object} props - Icono, textos, control y clases adicionales.
 * @param {import("react").ReactNode} props.icon - Icono del contenedor.
 * @param {string} props.title - Título de la preferencia.
 * @param {string} props.description - Descripción.
 * @param {import("react").ReactNode} props.rightContent - Control (selector o interruptor).
 * @param {string} [props.className] - Clases adicionales (p. ej. el divisor inferior).
 * @returns {import("react").ReactElement} Fila de preferencia.
 */
export default function PreferenceItem({
  icon,
  title,
  description,
  rightContent,
  className,
}) {
  return (
    <div
      className={`settings-form-section settings-preference-row flex items-center justify-between gap-x-[24px] pb-[16px] ${className ?? ""}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-[8px]">
        <div className="shrink-0 rounded-[8px] border border-[var(--color-neutral-200)] shadow-[var(--shadow-e1)]">
          <div className="flex size-[40px] items-center justify-center rounded-[8px] bg-[var(--color-neutral-100)] text-[var(--color-success-200)]">
            {icon}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-[2px]">
          <span className="text-heading-8 tracking-[-0.5px] text-[var(--color-text-300)]">
            {title}
          </span>
          <p className="text-body-3 tracking-[-0.5px] text-[var(--color-text-200)]">
            {description}
          </p>
        </div>
      </div>
      <div className="settings-preference-control shrink-0">{rightContent}</div>
    </div>
  );
}
