import "./AdminTableToolbar.css";

/**
 * Distribuye búsqueda, filtros y la acción "Quitar filtros" de una tabla administrativa.
 * Solo define la composición responsive (container queries en AdminTableToolbar.css):
 * una columna con los filtros en fila en móvil, filtros a dos columnas desde 520 px y
 * búsqueda y filtros en una sola fila desde 845 px de ancho disponible. Los controles,
 * su estado y sus callbacks pertenecen a cada tabla.
 *
 * @param {Object} props Controles ya configurados por la tabla.
 * @param {import("react").ReactNode} props.search Campo de búsqueda.
 * @param {import("react").ReactNode} props.children Menús de filtro, en orden visual.
 * @param {import("react").ReactNode} props.clearFiltersAction Botón para quitar los filtros.
 * @returns {import("react").ReactElement} Toolbar de la tabla.
 */
function AdminTableToolbar({ search, children, clearFiltersAction }) {
  return (
    <div className="admin-table-toolbar">
      <div className="admin-table-toolbar__layout">
        {search}
        <div className="admin-table-toolbar__filters w-full">
          {children}
          <div className="admin-table-toolbar__clear-filters flex">{clearFiltersAction}</div>
        </div>
      </div>
    </div>
  );
}

export default AdminTableToolbar;
