import { useEffect, useState } from "react";

import { api } from "../../../../api/http.js";

/**
 * Denominaciones activas de la unidad base elegida en el formulario de servicios, para que solo
 * se ofrezcan combinaciones compatibles (la base de cada denominación es la elegida). Se leen la
 * primera vez que se elige cada base y se conservan por base mientras el formulario está montado;
 * cambiar de base aborta la lectura anterior. `add` incorpora la denominación recién creada desde
 * «+ Crear unidad» sin volver a leer.
 *
 * @param {Object} params - Base elegida y activación.
 * @param {number|null} params.measurementUnitId - Unidad base elegida.
 * @param {boolean} params.enabled - Permite la lectura (formulario listo).
 * @returns {{options: Array<Object>, loading: boolean, error: string, retry: () => void,
 * add: (denomination: Object) => void}} Opciones y acciones.
 */
export function useServiceDenominationOptions({ enabled, measurementUnitId }) {
  const [byUnit, setByUnit] = useState({});
  const [errors, setErrors] = useState({});
  const [attempt, setAttempt] = useState(0);
  const cached = measurementUnitId ? byUnit[measurementUnitId] : undefined;
  const error = measurementUnitId ? errors[measurementUnitId] || "" : "";
  const shouldLoad = Boolean(enabled && measurementUnitId && cached === undefined && !error);

  useEffect(() => {
    if (!shouldLoad) return undefined;
    const controller = new AbortController();
    api.measurementUnits.listAllDenominations({ measurementUnitId, signal: controller.signal, status: "active" })
      .then((payload) => {
        if (!controller.signal.aborted) setByUnit((current) => ({ ...current, [measurementUnitId]: payload?.unitDenominations || [] }));
      })
      .catch((requestError) => {
        if (requestError?.name === "AbortError" || controller.signal.aborted) return;
        setErrors((current) => ({ ...current, [measurementUnitId]: requestError?.message || "No se pudieron cargar las unidades de medida." }));
      });
    return () => controller.abort();
  }, [attempt, measurementUnitId, shouldLoad]);

  return {
    error,
    loading: shouldLoad,
    options: cached || [],
    /**
     * Repite la lectura de la base elegida tras un error.
     *
     * @returns {void}
     */
    retry: () => {
      setErrors((current) => ({ ...current, [measurementUnitId]: "" }));
      setAttempt((value) => value + 1);
    },
    /**
     * Añade una denominación creada a las opciones de su base, sin duplicarla.
     *
     * @param {{id: number, measurementUnit: {id: number}}} denomination - Denominación creada.
     * @returns {void}
     */
    add: (denomination) => {
      const unitId = denomination.measurementUnit.id;
      setByUnit((current) => {
        const list = current[unitId];
        if (!list) return current;
        return list.some((item) => item.id === denomination.id) ? current : { ...current, [unitId]: [...list, denomination] };
      });
    },
  };
}
