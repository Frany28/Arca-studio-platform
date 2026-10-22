import { api } from "../../../../api/http.js";
import { useCursorSearchList } from "../../hooks/useCursorSearchList.js";

// Diez filas por página, como la tabla de usuarios; el contrato admite 1–100.
export const MEASUREMENT_UNITS_PAGE_SIZE = 10;

/**
 * Lee las denominaciones (unidades de medida) con búsqueda en la API y paginación por cursor,
 * mediante la lista compartida del módulo: la búsqueda se aplica tras una pausa y vuelve a la
 * primera página, y cada lectura aborta la anterior. No hay totales en el contrato.
 *
 * @returns {Object} Filas, estado de carga y error, búsqueda, paginación, recarga y reemplazo de
 * una fila editada.
 */
export function useMeasurementUnitDenominations() {
  const list = useCursorSearchList({
    collectionKey: "unitDenominations",
    errorMessage: "No se pudieron cargar las unidades de medida.",
    fetchPage: api.measurementUnits.listDenominations,
    pageSize: MEASUREMENT_UNITS_PAGE_SIZE,
  });

  return {
    error: list.error,
    items: list.items,
    loading: list.loading,
    search: list.search,
    pagination: list.pagination,
    reload: list.reload,
    reloadFromStart: list.reloadFromStart,
    replaceItem: list.replaceItem,
  };
}
