import { ArrowSwapVertical, Filter } from "iconsax-react";

/**
 * Encabezado de columna de las tablas del módulo con el icono decorativo de Figma (orden o
 * filtro), como en la tabla de usuarios. El orden real lo define el backend y los filtros viven
 * en la barra de herramientas, así que el icono no es interactivo.
 *
 * @param {Object} props - Texto e icono.
 * @param {import("react").ReactNode} props.children - Texto del encabezado.
 * @param {boolean} [props.filter=false] - Usa el icono de filtro en lugar del de orden.
 * @returns {import("react").ReactElement} Contenido del encabezado.
 */
function TableHeaderLabel({ children, filter = false }) {
  const Icon = filter ? Filter : ArrowSwapVertical;
  return (
    <span className="flex items-center gap-[8px] whitespace-nowrap">
      {children}
      <Icon size="16" variant="Linear" color="currentColor" aria-hidden="true" />
    </span>
  );
}

export default TableHeaderLabel;
