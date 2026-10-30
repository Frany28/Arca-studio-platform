import { useEffect, useRef } from "react";

import { InfoCircleIcon } from "../Label/LabelIcons.jsx";
import Tooltip from "./Tooltip.jsx";

/**
 * Icono informativo que muestra un texto en el Tooltip del sistema (Figma 5790:332129: burbuja de
 * hasta 224 px con flecha, encima del icono). El tooltip va en portal, así que el overflow de una
 * tabla no lo recorta, y se coloca dentro del viewport.
 *
 * Interacción: hover y foco de teclado (del Tooltip); un toque o clic lo abre, que es la vía en
 * dispositivos táctiles sin hover, y un toque fuera o Escape lo cierran. El estado es controlado
 * para combinar esas fuentes; los listeners de cierre solo existen mientras está abierto.
 *
 * @param {Object} props - Texto, nombre accesible y estado.
 * @param {string} props.label - Nombre accesible del botón.
 * @param {string} props.text - Texto no vacío del tooltip.
 * @param {boolean} props.open - Ayuda visible.
 * @param {(open: boolean) => void} props.onOpenChange - Solicita abrir o cerrar la ayuda.
 * @returns {import("react").ReactElement} Botón informativo con su tooltip.
 */
function InfoHint({ label, onOpenChange, open, text, ...props }) {
  const buttonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    const closeOnOutsidePress = (event) => {
      if (!buttonRef.current?.contains(event.target)) onOpenChange(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePress, true);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePress, true);
    };
  }, [onOpenChange, open]);

  return (
    <Tooltip
      asChild
      portal
      showTip
      tipPosition="Top center"
      open={open}
      onOpenChange={onOpenChange}
      text={text}
      className="max-w-[min(224px,calc(100vw-16px))]"
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        className="inline-flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--color-neutral-400)] transition-colors hover:text-[var(--color-text-100)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-10)]"
        onClick={() => onOpenChange(true)}
        {...props}
      >
        <InfoCircleIcon className="size-[15px]" />
      </button>
    </Tooltip>
  );
}

export default InfoHint;
