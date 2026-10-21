import { useEffect, useMemo, useState } from "react";

import { api } from "../../../../api/http.js";
import { toBaseUnitOptions } from "../utils/measurementUnitPresentation.js";

/**
 * Carga el catálogo de unidades base activas (48 en el seed aprobado) para el selector de
 * abreviaturas. Se solicita la primera vez que `enabled` es verdadero (al abrir el formulario)
 * y se conserva mientras el panel esté montado, porque el catálogo base es de solo lectura en
 * la API; un error permite reintentar sin cerrar el formulario.
 *
 * @param {Object} params - Activación de la lectura.
 * @param {boolean} params.enabled - Solicita el catálogo cuando aún no está disponible.
 * @returns {{options: Array<Object>, loading: boolean, error: string, retry: Function}} Opciones.
 */
export function useMeasurementUnitBaseOptions({ enabled }) {
  const [units, setUnits] = useState(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const shouldLoad = enabled && units === null;

  useEffect(() => {
    if (!shouldLoad) return undefined;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) setError("");
    });
    api.measurementUnits.listBaseUnits({ signal: controller.signal })
      .then((payload) => {
        if (!controller.signal.aborted) setUnits(payload?.measurementUnits || []);
      })
      .catch((requestError) => {
        if (requestError?.name === "AbortError" || controller.signal.aborted) return;
        setError(requestError?.message || "No se pudieron cargar las unidades base.");
      });
    return () => controller.abort();
  }, [attempt, shouldLoad]);

  const options = useMemo(() => toBaseUnitOptions(units), [units]);

  return {
    error,
    loading: shouldLoad && !error,
    options,
    retry: () => setAttempt((value) => value + 1),
  };
}
