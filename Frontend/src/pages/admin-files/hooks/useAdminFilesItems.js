import { api } from "../../../api/http.js";
import { useCursorSearchList } from "../../admin-services-quotes/hooks/useCursorSearchList.js";

// Figma 3727:683877: «0 de 10 seleccionados», diez filas por página.
export const ADMIN_FILES_PAGE_SIZE = 10;
// Sentido inicial al elegir cada columna: lo más reciente y lo más pesado primero; el nombre, A–Z.
const FIRST_ORDER = Object.freeze({ date: "desc", name: "asc", size: "desc" });
const INITIAL_FILTERS = Object.freeze({ order: "desc", sort: "date", tab: "approved" });

/**
 * Lee una página de la pestaña con el ámbito, los tipos y el orden aplicados. Los tipos viajan
 * como texto separado por comas en los filtros para que la comparación de cambios sea exacta.
 *
 * @param {Object} query - Filtros de useCursorSearchList con cursor, límite, búsqueda y señal.
 * @returns {Promise<{items: Array<Object>, nextCursor: string|null}>} Página.
 */
function fetchItemsPage({ extensions, ...query }) {
  return api.fileManager.listItems({
    ...query,
    extensions: extensions ? extensions.split(",") : undefined,
    includeSubfolders: Boolean(query.folderId),
  });
}

/**
 * Listado de la tabla: pestaña, ámbito del árbol, búsqueda, filtro de tipo, orden y paginación
 * por cursor (el cursor pertenece a su pestaña y orden: cambiar cualquiera vuelve a la primera
 * página, como exige la API). El ámbito del árbol solo acota «Aprobados»: pendientes y rechazados
 * listan todos los proyectos con su columna Proyecto, como en Figma.
 *
 * @returns {Object} Estado de useCursorSearchList y acciones de pestaña, ámbito, tipos y orden.
 */
export function useAdminFilesItems() {
  const list = useCursorSearchList({
    collectionKey: "items",
    errorMessage: "No se pudieron cargar los archivos.",
    fetchPage: fetchItemsPage,
    initialFilters: INITIAL_FILTERS,
    pageSize: ADMIN_FILES_PAGE_SIZE,
  });
  const { filters, setFilter } = list;
  const extensions = filters.extensions ? filters.extensions.split(",") : [];

  /**
   * Aplica la pestaña y el ámbito del árbol que le corresponde.
   *
   * @param {"approved"|"pending"|"rejected"} tab - Pestaña.
   * @param {{projectId: number|null, folderId: number|null}} scope - Selección del árbol.
   * @returns {void}
   */
  function applyView(tab, scope) {
    const scoped = tab === "approved";
    setFilter("tab", tab);
    setFilter("projectId", scoped ? scope.projectId : null);
    setFilter("folderId", scoped ? scope.folderId : null);
  }

  /**
   * Alterna el orden de una columna: la misma columna invierte el sentido; otra empieza por el suyo.
   *
   * @param {"date"|"name"|"size"} field - Columna.
   * @returns {void}
   */
  function toggleSort(field) {
    if (filters.sort === field) {
      setFilter("order", filters.order === "asc" ? "desc" : "asc");
      return;
    }
    setFilter("sort", field);
    setFilter("order", FIRST_ORDER[field]);
  }

  /**
   * Aplica los tipos marcados en el filtro «Tipo»; sin tipos, lo retira.
   *
   * @param {string[]} ids - Extensiones marcadas.
   * @returns {void}
   */
  function setExtensions(ids) {
    setFilter("extensions", ids.length ? [...ids].sort().join(",") : null);
  }

  /**
   * Quita la búsqueda y los tipos conservando pestaña, ámbito y orden.
   *
   * @returns {void}
   */
  function clearFilters() {
    list.search.clear();
    setFilter("extensions", null);
  }

  return {
    ...list,
    applyView,
    clearFilters,
    extensions,
    hasFilters: Boolean(list.search.query.trim() || extensions.length),
    setExtensions,
    sort: { field: filters.sort, order: filters.order },
    tab: filters.tab,
    toggleSort,
  };
}
