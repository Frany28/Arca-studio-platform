import { useEffect, useState } from "react";

import { api } from "../../../../api/http.js";

/**
 * Unidades de medida registradas (denominaciones activas de todas las bases) para el formulario de
 * servicios: son las únicas opciones del campo «Unidad de medida», nunca las unidades base sueltas.
 * Se leen una vez al abrir Crear o Editar, para derivar las bases con denominaciones activas, recorriendo GET
 * /admin/measurement-unit-denominations?status=active, y se conservan mientras está montado (el
 * formulario es de vida corta y las nuevas altas se incorporan con `add`). Cerrar el formulario
 * aborta la lectura; un error permite reintentar sin cerrarlo. Un alta durante la lectura no
 * la cancela ni sustituye el catálogo: ambas respuestas se combinan por identificador.
 *
 * @param {Object} params - Activación.
 * @param {boolean} params.enabled - Formulario listo para construir las opciones del selector.
 * @returns {{options: Array<Object>, loading: boolean, error: string, retry: () => void,
 * add: (denomination: Object) => void}} Denominaciones activas y acciones.
 */
export function useActiveDenominations({ enabled }) {
  const [catalog, setCatalog] = useState({ loaded: false, options: [] });
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const shouldLoad = enabled && !catalog.loaded && !error;

  useEffect(() => {
    if (!shouldLoad) return undefined;
    const controller = new AbortController();
    api.measurementUnits.listAllDenominations({ signal: controller.signal, status: "active" })
      .then((payload) => {
        if (controller.signal.aborted) return;
        // Mantiene las altas locales y deduplica; la lectura vigente prevalece si ya incluye una.
        setCatalog((current) => ({
          loaded: true,
          options: [...new Map([...current.options, ...(payload?.unitDenominations || [])].map((item) => [item.id, item])).values()],
        }));
      })
      .catch((requestError) => {
        if (requestError?.name === "AbortError" || controller.signal.aborted) return;
        setError(requestError?.message || "No se pudieron cargar las unidades de medida.");
      });
    return () => controller.abort();
  }, [attempt, shouldLoad]);

  return {
    error,
    loading: shouldLoad,
    options: catalog.options,
    /**
     * Repite la lectura tras un error.
     *
     * @returns {void}
     */
    retry: () => {
      setError("");
      setAttempt((value) => value + 1);
    },
    /**
     * Incorpora una denominación recién creada, sin duplicarla ni volver a leer.
     *
     * @param {{id: number}} denomination - Denominación creada (forma del contrato).
     * @returns {void}
     */
    add: (denomination) => {
      setCatalog((current) => {
        if (current.options.some((item) => item.id === denomination.id)) return current;
        return { ...current, options: [...current.options, denomination] };
      });
    },
  };
}
