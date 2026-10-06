import { useCallback, useEffect, useState } from "react";

/**
 * Inicializa la pesta?a desde tab=renders/documents o el ?ndice proporcionado.
 * Posteriores queries reconocidas seleccionan esas pesta?as; quitar tab no restablece el ?ndice.
 * El setter cambia solo el estado local y la acci?n de limpieza elimina referencias de la URL.
 *
 * @param {Object} params - Selecci?n inicial y query del router.
 * @param {number} params.initialActiveProjectTabIndex - ?ndice inicial si tab no es reconocido.
 * @param {URLSearchParams} params.searchParams - Par?metros observados para seleccionar pesta?a.
 * @param {Function} params.setSearchParams - Actualiza la query al limpiar referencias.
 * @returns {{activeProjectTabIndex: number, clearFocusedRenderComment: Function, setActiveProjectTabIndex: Function}} Selecci?n local y acciones de actualizaci?n/limpieza.
 */
export default function useProjectDetailsTabs({
  initialActiveProjectTabIndex,
  searchParams,
  setSearchParams,
}) {
  const [activeProjectTabIndex, setActiveProjectTabIndex] = useState(() => {
    const requestedTab = searchParams.get("tab");
    if (requestedTab === "renders") return 1;
    if (requestedTab === "documents") return 2;
    return initialActiveProjectTabIndex;
  });

  useEffect(() => {
    let cancelled = false;
    const requestedTab = searchParams.get("tab");

    if (requestedTab !== "renders" && requestedTab !== "documents") {
      return undefined;
    }

    queueMicrotask(() => {
      if (cancelled) return;
      setActiveProjectTabIndex(requestedTab === "renders" ? 1 : 2);
    });

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  /**
   * Elimina ?nicamente imageId y commentId mediante replace y conserva el resto de la query.
   * Si ninguno est? presente, evita actualizar la URL.
   *
   * @returns {void} Limpia las referencias de imagen/observaci?n sin cambiar directamente la pesta?a.
   */
  const clearFocusedRenderComment = useCallback(() => {
    if (!searchParams.has("imageId") && !searchParams.has("commentId")) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("imageId");
    nextParams.delete("commentId");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  return {
    activeProjectTabIndex,
    clearFocusedRenderComment,
    setActiveProjectTabIndex,
  };
}
