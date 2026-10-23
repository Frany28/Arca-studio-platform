import { useEffect, useState } from "react";

import { api } from "../../../../api/http.js";

/**
 * Unidades de medida registradas (denominaciones activas de todas las bases) para el formulario de
 * servicios: son las únicas opciones del campo «Unidad de medida», nunca las unidades base sueltas.
 * Se leen una vez al elegir una base o abrir el alta contextual, recorriendo las páginas de GET
 * /admin/measurement-unit-denominations?status=active, y se conservan mientras está montado (el
 * formulario es de vida corta y las nuevas altas se incorporan con `add`). Cerrar el formulario
 * aborta la lectura; un error permite reintentar sin cerrarlo.
 *
 * @param {Object} params - Activación.
 * @param {boolean} params.enabled - Formulario listo con base elegida o alta contextual abierta.
 * @returns {{options: Array<Object>, loading: boolean, error: string, retry: () => void,
 * add: (denomination: Object) => void}} Denominaciones activas y acciones.
 */
export function useActiveDenominations({ enabled }) {
  const [denominations, setDenominations] = useState(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const shouldLoad = enabled && denominations === null && !error;

  useEffect(() => {
    if (!shouldLoad) return undefined;
    const controller = new AbortController();
    api.measurementUnits.listAllDenominations({ signal: controller.signal, status: "active" })
      .then((payload) => {
        if (!controller.signal.aborted) setDenominations(payload?.unitDenominations || []);
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
    options: denominations || [],
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
      setDenominations((current) => {
        const list = current || [];
        return list.some((item) => item.id === denomination.id) ? list : [...list, denomination];
      });
    },
  };
}
