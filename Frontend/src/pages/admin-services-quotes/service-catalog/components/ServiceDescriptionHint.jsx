import InfoHint from "../../../../components/ui/Tooltip/InfoHint.jsx";

/**
 * Icono informativo junto al nombre de un servicio que muestra su descripción real en el Tooltip
 * del sistema (`InfoHint`). El consumidor solo lo monta si hay descripción.
 *
 * @param {Object} props - Servicio descrito.
 * @param {string} props.serviceName - Nombre del servicio, para el nombre accesible.
 * @param {string} props.description - Descripción no vacía.
 * @param {boolean} props.open - Ayuda activa según la coordinación de la tabla.
 * @param {(open: boolean) => void} props.onOpenChange - Solicita abrir o cerrar la ayuda.
 * @returns {import("react").ReactElement} Botón informativo con su tooltip.
 */
function ServiceDescriptionHint({ description, onOpenChange, open, serviceName }) {
  return (
    <InfoHint
      label={`Ver descripción de ${serviceName}`}
      text={description}
      open={open}
      onOpenChange={onOpenChange}
      data-service-description-hint
    />
  );
}

export default ServiceDescriptionHint;
