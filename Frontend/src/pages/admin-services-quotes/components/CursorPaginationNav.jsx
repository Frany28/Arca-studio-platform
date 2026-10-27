import clsx from "clsx";

import Button from "../../../components/ui/Button/Button.jsx";

/**
 * Paginación Anterior/Siguiente por cursor de las tablas del módulo (Figma 5790:351653 y
 * 5771:488562): sin totales ni números de página, porque el contrato no los ofrece. «Anterior»
 * deshabilitado conserva el borde y el texto `neutral-400` de Figma.
 *
 * @param {Object} props - Paginación, nombre accesible y geometría opcional.
 * @param {{hasPrevious: boolean, hasNext: boolean, previous: () => void, next: () => void}} props.pagination - Estado y acciones.
 * @param {string} props.ariaLabel - Nombre accesible de la navegación.
 * @param {{previous?: Object, next?: Object}} [props.buttonGeometry] - Medidas de Figma de cada botón (`style`).
 * @param {string} [props.className] - Clases del contenedor.
 * @returns {import("react").ReactElement} Navegación de páginas.
 */
function CursorPaginationNav({ ariaLabel, buttonGeometry, className, pagination }) {
  return (
    <nav className={clsx("flex items-center gap-[8px]", className)} aria-label={ariaLabel}>
      <Button theme="Primary" type="Outline" size="M" fitContent style={buttonGeometry?.previous} showLeftIcon={false} showRightIcon={false} disabled={!pagination.hasPrevious} className="disabled:!border-[var(--color-neutral-400)] disabled:!text-[var(--color-neutral-400)]" onClick={pagination.previous}>Anterior</Button>
      <Button theme="Primary" type="Solid" size="M" fitContent style={buttonGeometry?.next} showLeftIcon={false} showRightIcon={false} disabled={!pagination.hasNext} onClick={pagination.next}>Siguiente pág.</Button>
    </nav>
  );
}

export default CursorPaginationNav;
