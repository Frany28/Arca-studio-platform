import CursorPaginationNav from "../../components/CursorPaginationNav.jsx";

// Figma 5771:488562: Anterior 75 × 41 px y Siguiente pág. 114 × 41 px, como el tabulador.
const FOOTER_BUTTON_GEOMETRY = {
  next: { height: 41, width: 114 },
  previous: { height: 41, width: 75 },
};

/**
 * Pie del listado de cotizaciones (Figma 5771:488560): contador de la selección a la izquierda y
 * la paginación por cursor a la derecha. El diseño no define acciones masivas, así que no se
 * reserva espacio para ellas. Los grupos pasan a filas sucesivas si no caben.
 *
 * @param {Object} props - Selección y paginación.
 * @param {number} props.selectedCount - Filas seleccionadas de la página.
 * @param {number} props.total - Filas visibles.
 * @param {Object} props.pagination - Paginación por cursor de useCursorSearchList.
 * @returns {import("react").ReactElement} Pie de la tabla.
 */
function QuotesFooter({ pagination, selectedCount, total }) {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-x-[24px] gap-y-[12px]" aria-label="Selección y paginación de cotizaciones">
      <span className="text-heading-8 text-[var(--color-text-300)]" aria-live="polite">
        {selectedCount} de {total} seleccionados
      </span>
      <CursorPaginationNav ariaLabel="Paginación de cotizaciones" buttonGeometry={FOOTER_BUTTON_GEOMETRY} pagination={pagination} />
    </footer>
  );
}

export default QuotesFooter;
