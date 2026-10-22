import { useState } from "react";

const EMPTY_SELECTION = new Set();

/**
 * Selección de filas de la página visible. Pertenece a la página recibida (`pageKey`): cambiar de
 * página, de búsqueda o de filtros, o recargar, la reinicia sin efectos de sincronización,
 * porque una selección guardada con otra clave se ignora. Reemplazar una fila tras cambiar su
 * estado no cambia la clave y conserva la selección. Solo cuenta filas presentes en la página.
 *
 * @param {Array<{id: number|string}>} items - Filas visibles.
 * @param {number} pageKey - Identificador de la página recibida.
 * @returns {{selectedIds: Set<string>, selectedCount: number, headerChecked: "No"|"Yes"|"Indeterminate",
 * isSelected: (id: number|string) => boolean, toggle: (id: number|string) => void, toggleAll: () => void}}
 * Estado y acciones de selección.
 */
export function usePageSelection(items, pageKey) {
  const [selection, setSelection] = useState({ key: pageKey, ids: EMPTY_SELECTION });
  const storedIds = selection.key === pageKey ? selection.ids : EMPTY_SELECTION;
  const visibleIds = items.map((item) => String(item.id));
  const selectedIds = new Set(visibleIds.filter((id) => storedIds.has(id)));
  const selectedCount = selectedIds.size;

  /**
   * Alterna una fila de la página visible.
   *
   * @param {number|string} id - Identificador de la fila.
   * @returns {void}
   */
  function toggle(id) {
    const next = new Set(selectedIds);
    const key = String(id);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelection({ key: pageKey, ids: next });
  }

  /**
   * Selecciona todas las filas visibles o, si ya lo estaban, las deselecciona.
   *
   * @returns {void}
   */
  function toggleAll() {
    const allSelected = visibleIds.length > 0 && selectedCount === visibleIds.length;
    setSelection({ key: pageKey, ids: allSelected ? new Set() : new Set(visibleIds) });
  }

  return {
    headerChecked: selectedCount === 0 ? "No" : selectedCount === visibleIds.length ? "Yes" : "Indeterminate",
    isSelected: (id) => selectedIds.has(String(id)),
    selectedCount,
    selectedIds,
    toggle,
    toggleAll,
  };
}
