import { useCallback, useEffect, useMemo, useState } from "react";

import { searchAddressSuggestions } from "../utils/geoapify.js";

const EMPTY_RESULT = {
  error: "",
  query: "",
  status: "idle",
  suggestions: [],
};

/**
 * Busca direcciones para consultas recortadas de al menos dos caracteres.
 * Aplica debounce mediante window.setTimeout y cancela timer y request con
 * AbortController al cambiar dependencias o desmontar. Ignora abortos y expone
 * solo resultados y errores de la consulta vigente; el debounce no cuenta como carga.
 * clear reinicia el resultado local, sin cancelar por sí mismo una petición activa.
 *
 * @param {Object} [params={}] - Configuración de la búsqueda.
 * @param {number} [params.debounceMs=180] - Espera en milisegundos antes del request.
 * @param {boolean} [params.enabled=true] - Habilita la búsqueda automática.
 * @param {string} [params.query] - Texto de dirección.
 * @param {boolean} [params.selected=false] - Impide buscar si ya existe una selección.
 * @returns {Object} clear, error, hasSearched, isSearching y suggestions.
 */
export default function useAddressSuggestions({
  debounceMs = 180,
  enabled = true,
  query,
  selected = false,
} = {}) {
  const normalizedQuery = String(query || "").trim();
  const canSearch = enabled && !selected && normalizedQuery.length >= 2;
  const [result, setResult] = useState(EMPTY_RESULT);

  const clear = useCallback(() => {
    setResult(EMPTY_RESULT);
  }, []);

  useEffect(() => {
    if (!canSearch) {
      return undefined;
    }

    const requestQuery = normalizedQuery;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setResult({
        error: "",
        query: requestQuery,
        status: "searching",
        suggestions: [],
      });

      searchAddressSuggestions(requestQuery, { signal: controller.signal })
        .then((nextSuggestions) => {
          if (controller.signal.aborted) return;
          setResult({
            error: "",
            query: requestQuery,
            status: "complete",
            suggestions: nextSuggestions,
          });
        })
        .catch((requestError) => {
          if (requestError.name === "AbortError" || controller.signal.aborted) return;
          setResult({
            error: requestError.message,
            query: requestQuery,
            status: "error",
            suggestions: [],
          });
        });
    }, debounceMs);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [canSearch, debounceMs, normalizedQuery]);

  return useMemo(() => {
    const belongsToCurrentQuery = canSearch && result.query === normalizedQuery;
    return {
      clear,
      error: belongsToCurrentQuery ? result.error : "",
      hasSearched: belongsToCurrentQuery && result.status === "complete",
      isSearching: belongsToCurrentQuery && result.status === "searching",
      suggestions: belongsToCurrentQuery ? result.suggestions : [],
    };
  }, [canSearch, clear, normalizedQuery, result]);
}
