import { api } from "../../../../api/http.js";
import { useCursorSearchList } from "../../hooks/useCursorSearchList.js";

// Diez filas por página, como Figma (5790:332031) y la tabla de unidades; el contrato admite 1–100.
export const SERVICE_CATALOG_PAGE_SIZE = 10;

// Parámetros de la API que representan el filtro por unidad: son excluyentes entre sí.
const UNIT_FILTER_NAMES = ["measurementUnitId", "unitDenominationId"];

/**
 * Lee el tabulador de servicios con búsqueda (nombre o código), filtros de estado y de unidad y
 * paginación por cursor sobre la lista compartida del módulo. El filtro por unidad usa una sola
 * opción a la vez: la unidad base (`measurementUnitId`, todas sus denominaciones) o una
 * denominación concreta (`unitDenominationId`). Cualquier cambio vuelve a la primera página.
 *
 * @returns {Object} Lista, filtros aplicados (estado y opción de unidad seleccionados), si hay
 * algún filtro o búsqueda y las acciones para cambiarlos o quitarlos.
 */
export function useServiceCatalogList() {
  const list = useCursorSearchList({
    collectionKey: "services",
    errorMessage: "No se pudo cargar el tabulador de servicios.",
    fetchPage: api.serviceCatalog.listServices,
    pageSize: SERVICE_CATALOG_PAGE_SIZE,
  });
  const { filters, search } = list;
  const unitFilterName = UNIT_FILTER_NAMES.find((name) => filters[name] !== undefined);
  const selectedUnitItemId = unitFilterName
    ? `${unitFilterName === "measurementUnitId" ? "unit" : "denomination"}:${filters[unitFilterName]}`
    : null;

  /**
   * Aplica una opción del filtro por unidad retirando la otra variante, o lo quita con null.
   *
   * @param {{filter: {name: string, value: number}}|null} item - Opción elegida.
   * @returns {void}
   */
  function setUnitFilter(item) {
    for (const name of UNIT_FILTER_NAMES) {
      list.setFilter(name, item?.filter.name === name ? item.filter.value : null);
    }
  }

  return {
    ...list,
    hasFilters: Boolean(search.query.trim() || Object.keys(filters).length),
    selectedStatusId: filters.status ?? null,
    selectedUnitItemId,
    setStatusFilter: (status) => list.setFilter("status", status),
    setUnitFilter,
  };
}
