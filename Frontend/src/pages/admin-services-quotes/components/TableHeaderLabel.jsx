import { ArrowSwapVertical, Filter } from "iconsax-react";

const SORT_LABELS = Object.freeze({ ascending: "ascendente", descending: "descendente" });

/**
 * Encabezado de columna de las tablas del módulo con el icono de Figma (orden o filtro), como en
 * la tabla de usuarios. Sin `onSort` el icono es decorativo: el orden lo define el backend y los
 * filtros viven en la barra de herramientas. Con `onSort` (Cotizaciones, Figma 5771:488506) el
 * encabezado es un botón que alterna el orden real; la celda `th` declara `aria-sort`.
 *
 * @param {Object} props - Texto, icono y orden opcional.
 * @param {import("react").ReactNode} props.children - Texto del encabezado.
 * @param {boolean} [props.filter=false] - Usa el icono de filtro en lugar del de orden.
 * @param {"ascending"|"descending"|"none"} [props.sortDirection] - Orden aplicado a esta columna.
 * @param {() => void} [props.onSort] - Alterna el orden de la columna.
 * @param {boolean} [props.disabled=false] - Bloquea el cambio de orden (por ejemplo, durante la carga).
 * @returns {import("react").ReactElement} Contenido del encabezado.
 */
function TableHeaderLabel({ children, disabled = false, filter = false, onSort, sortDirection = "none" }) {
  const Icon = filter ? Filter : ArrowSwapVertical;
  if (!onSort) {
    return (
      <span className="flex items-center gap-[8px] whitespace-nowrap">
        {children}
        <Icon size="16" variant="Linear" color="currentColor" aria-hidden="true" />
      </span>
    );
  }
  const current = SORT_LABELS[sortDirection];
  return (
    <button
      type="button"
      disabled={disabled}
      className="-mx-[4px] flex items-center gap-[8px] whitespace-nowrap rounded-[var(--radius-1)] px-[4px] text-heading-8 text-inherit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-300)] disabled:cursor-not-allowed"
      aria-label={current ? `Ordenar por ${children}, orden ${current} aplicado` : `Ordenar por ${children}`}
      onClick={onSort}
    >
      {children}
      <Icon size="16" variant={sortDirection === "none" ? "Linear" : "Bold"} color="currentColor" aria-hidden="true" />
    </button>
  );
}

export default TableHeaderLabel;
