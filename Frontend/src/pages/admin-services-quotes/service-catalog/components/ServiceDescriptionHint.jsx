import { useEffect, useRef } from "react";

import { InfoCircleIcon } from "../../../../components/ui/Label/LabelIcons.jsx";
import Tooltip from "../../../../components/ui/Tooltip/Tooltip.jsx";

/**
 * Icono informativo junto al nombre de un servicio que muestra su descripción real en el Tooltip
 * del sistema (Figma 5790:332129: burbuja de hasta 224 px con flecha, encima del icono). El
 * consumidor solo lo monta si hay descripción. El tooltip va en portal, así que el overflow de
 * la tabla no lo recorta, y se coloca dentro del viewport.
 *
 * Interacción: hover y foco de teclado (del Tooltip); un toque o clic lo abre, que es la vía en
 * dispositivos táctiles sin hover, y un toque fuera o Escape lo cierran. El estado es controlado
 * para combinar esas fuentes; los listeners de cierre solo existen mientras está abierto.
 *
 * @param {Object} props - Servicio descrito.
 * @param {string} props.serviceName - Nombre del servicio, para el nombre accesible.
 * @param {string} props.description - Descripción no vacía.
 * @param {boolean} props.open - Ayuda activa según la coordinación de la tabla.
 * @param {(open: boolean) => void} props.onOpenChange - Solicita abrir o cerrar la ayuda.
 * @returns {import("react").ReactElement} Botón informativo con su tooltip.
 */
function ServiceDescriptionHint({ description, onOpenChange, open, serviceName }) {
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
      text={description}
      className="max-w-[min(224px,calc(100vw-16px))]"
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Ver descripción de ${serviceName}`}
        aria-expanded={open}
        data-service-description-hint
        className="inline-flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--color-neutral-400)] transition-colors hover:text-[var(--color-text-100)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-10)]"
        onClick={() => onOpenChange(true)}
      >
        <InfoCircleIcon className="size-[15px]" />
      </button>
    </Tooltip>
  );
}

export default ServiceDescriptionHint;
