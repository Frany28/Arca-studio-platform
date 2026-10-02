import { useState } from "react";

/**
 * Resuelve expansión y selección con una única fuente de verdad por propiedad.
 * Las props controladas prevalecen; los valores por defecto inicializan únicamente el estado interno.
 *
 * @param {Object} options Props de estado y callbacks públicos de la sidebar.
 * @param {string} [options.activeItemId] Selección controlada cuando es una cadena no vacía.
 * @param {string|null} [options.defaultActiveItemId] Selección inicial no controlada.
 * @param {boolean} [options.expanded] Expansión controlada cuando es un booleano.
 * @param {boolean} options.defaultExpanded Expansión inicial no controlada.
 * @param {Function} [options.onItemSelect] Recibe el item completo solicitado.
 * @param {Function} [options.onExpandedChange] Recibe la expansión solicitada en ambos modos.
 * @param {Function} [options.onCollapseClick] Callback compatible que recibe el mismo booleano.
 * @returns {Object} Selección y expansión resueltas, handler de selección y alternancia.
 */
export default function useSideNavigationState({
  activeItemId,
  defaultActiveItemId,
  expanded,
  defaultExpanded,
  onItemSelect,
  onExpandedChange,
  onCollapseClick,
}) {
  const [internalActiveItemId, setInternalActiveItemId] = useState(defaultActiveItemId);
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const isActiveControlled = typeof activeItemId === "string" && activeItemId.length > 0;
  const isExpandedControlled = typeof expanded === "boolean";
  const resolvedActiveItemId = isActiveControlled ? activeItemId : internalActiveItemId;
  const isExpanded = isExpandedControlled ? expanded : internalExpanded;

  /**
   * Actualiza la selección interna únicamente cuando el padre no la controla.
   * Notifica el item original en ambos modos sin asumir un destino ni ejecutar navegación.
   *
   * @param {Object} item Item seleccionado con su identificador y campos originales.
   * @returns {void} Actualiza o solicita la selección activa.
   */
  const handleItemSelect = (item) => {
    if (!isActiveControlled) {
      setInternalActiveItemId(item.id);
    }

    onItemSelect?.(item);
  };

  /**
   * Solicita alternar la expansión sin duplicar el estado proporcionado por el padre.
   * En modo no controlado actualiza el estado interno y notifica los callbacks compatibles.
   *
   * @returns {void} Actualiza o solicita la expansión de esta instancia.
   */
  const handleToggleExpanded = () => {
    const nextExpanded = !isExpanded;

    if (!isExpandedControlled) {
      setInternalExpanded(nextExpanded);
    }

    onExpandedChange?.(nextExpanded);
    onCollapseClick?.(nextExpanded);
  };

  return { resolvedActiveItemId, isExpanded, handleItemSelect, handleToggleExpanded };
}
