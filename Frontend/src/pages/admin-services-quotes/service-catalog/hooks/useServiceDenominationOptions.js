import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../../../api/http.js";

/**
 * Denominaciones activas por unidad base para el formulario de servicios: las de la base del
 * servicio (solo se ofrecen combinaciones compatibles) y las de la base elegida en «+ Crear
 * unidad» (para avisar de duplicados). Una sola caché por base mientras el formulario está
 * montado: cada base se lee una vez aunque la pidan ambos campos, y una lectura en curso no se
 * repite ni se aborta al cambiar de base (su resultado sigue sirviendo); solo se aborta al
 * desmontar. `add` incorpora la denominación recién creada sin volver a leer.
 *
 * @param {Object} params - Bases requeridas y activación.
 * @param {Array<number|null>} params.measurementUnitIds - Bases cuyas denominaciones se necesitan.
 * @param {boolean} params.enabled - Permite las lecturas (formulario listo).
 * @returns {{forUnit: (unitId: number|null) => {options: Array<Object>, loading: boolean, error: string},
 * retry: (unitId: number) => void, add: (denomination: Object) => void}} Consulta por base y acciones.
 */
export function useServiceDenominationOptions({ enabled, measurementUnitIds }) {
  const [byUnit, setByUnit] = useState({});
  const [errors, setErrors] = useState({});
  const controllersRef = useRef(new Map());
  // Clave estable de las bases pendientes de leer: el efecto solo se repite cuando cambia.
  const pending = [...new Set(measurementUnitIds.filter(Boolean))]
    .filter((unitId) => byUnit[unitId] === undefined && !errors[unitId]);
  const pendingKey = enabled ? pending.join(",") : "";

  useEffect(() => {
    for (const unitId of pendingKey ? pendingKey.split(",").map(Number) : []) {
      if (controllersRef.current.has(unitId)) continue;
      const controller = new AbortController();
      controllersRef.current.set(unitId, controller);
      api.measurementUnits.listAllDenominations({ measurementUnitId: unitId, signal: controller.signal, status: "active" })
        .then((payload) => {
          setByUnit((current) => ({ ...current, [unitId]: payload?.unitDenominations || [] }));
        })
        .catch((requestError) => {
          if (requestError?.name === "AbortError" || controller.signal.aborted) return;
          setErrors((current) => ({ ...current, [unitId]: requestError?.message || "No se pudieron cargar las unidades de medida." }));
        })
        .finally(() => {
          if (!controller.signal.aborted) controllersRef.current.delete(unitId);
        });
    }
  }, [pendingKey]);

  // Las lecturas en curso se abortan solo al cerrar el formulario.
  useEffect(() => {
    const controllers = controllersRef.current;
    return () => {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    };
  }, []);

  const forUnit = useCallback((unitId) => ({
    error: unitId ? errors[unitId] || "" : "",
    loading: Boolean(enabled && unitId && byUnit[unitId] === undefined && !errors[unitId]),
    options: (unitId && byUnit[unitId]) || [],
  }), [byUnit, enabled, errors]);

  return {
    forUnit,
    /**
     * Repite la lectura de una base tras un error.
     *
     * @param {number} unitId - Unidad base.
     * @returns {void}
     */
    retry: (unitId) => setErrors((current) => ({ ...current, [unitId]: "" })),
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
