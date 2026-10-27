import clsx from "clsx";
import { Calendar2 } from "iconsax-react";
import { useEffect, useId, useRef, useState } from "react";

import useMobileLayout from "../../../hooks/useMobileLayout.js";
import DateRangePicker from "./DateRangePicker.jsx";
import { formatShortDay } from "./dateRangeCalendar.js";

/**
 * Campo de filtro por intervalo de fechas (Figma 5771:488500 y 5790:341791): muestra el
 * intervalo aplicado (`20 Mar 2026 | 26 Mar 2026`) o el texto de ayuda, y abre bajo él el panel
 * de selección. Es un disparador de diálogo, no un menú: Escape o un clic fuera lo cierran sin
 * aplicar y el foco vuelve al disparador.
 *
 * @param {Object} props - Valor, textos y callbacks.
 * @param {{from: string|null, to: string|null}} props.value - Intervalo aplicado (claves `YYYY-MM-DD`).
 * @param {(range: {from: string, to: string}) => void} props.onChange - Aplica un intervalo.
 * @param {string} [props.placeholder="Filtrar por fecha"] - Texto sin intervalo aplicado.
 * @param {string} props["aria-label"] - Nombre accesible del disparador.
 * @param {boolean} [props.disabled=false] - Bloquea el campo (por ejemplo, durante la carga).
 * @param {string} [props.className] - Clases del contenedor.
 * @returns {import("react").ReactElement} Campo con su panel.
 */
function DateRangeField({ className, disabled = false, onChange, placeholder = "Filtrar por fecha", value, "aria-label": ariaLabel }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const triggerRef = useRef(null);
  const panelId = useId();
  const mobile = useMobileLayout();
  const label = value?.from ? `${formatShortDay(value.from)} | ${formatShortDay(value.to ?? value.from)}` : placeholder;
  const visibleOpen = open && !disabled;

  /**
   * Cierra el panel y devuelve el foco al disparador, para no perder la posición del teclado.
   *
   * @returns {void}
   */
  function close() {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  // Escape y el clic exterior se escuchan solo con el panel abierto; se retiran al cerrarlo.
  useEffect(() => {
    if (!visibleOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [visibleOpen]);

  return (
    <div ref={wrapperRef} className={clsx("relative w-full", visibleOpen ? "z-[100]" : "z-0", className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={`${ariaLabel}: ${label}`}
        aria-haspopup="dialog"
        aria-expanded={visibleOpen}
        aria-controls={visibleOpen ? panelId : undefined}
        className={clsx(
          "flex h-[39px] w-full items-center gap-[8px] rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] px-[16px] text-left transition-colors duration-150 motion-reduce:transition-none",
          "hover:bg-[var(--color-neutral-200)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-10)]",
          "disabled:cursor-not-allowed disabled:opacity-60",
        )}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={clsx("text-heading-8 min-w-0 flex-1 truncate", value?.from ? "text-[var(--color-text-200)]" : "text-[var(--color-text-100)]")}>
          {label}
        </span>
        <Calendar2 size="20" color="currentColor" className="shrink-0 text-[var(--color-text-200)]" aria-hidden="true" />
      </button>
      {visibleOpen ? (
        <div id={panelId} className="absolute left-0 top-full mt-[8px] max-[767px]:right-0">
          <DateRangePicker
            value={value}
            monthsShown={mobile ? 1 : 2}
            className="max-[767px]:w-full"
            onClose={close}
            onApply={(range) => {
              onChange(range);
              close();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

export default DateRangeField;
