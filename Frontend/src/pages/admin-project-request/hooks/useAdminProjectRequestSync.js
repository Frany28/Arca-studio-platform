import { useCallback, useState } from "react";

import { useResumeRevalidation } from "../../../hooks/useResumeRevalidation.js";
import {
  getExternalProjectRequestUpdateFeedback,
  hasProjectRequestChanged,
} from "../../../utils/projectRequestSync.js";

/**
 * Mantiene vigente la consulta administrativa sin tiempo real: revalida la solicitud al volver
 * a la pestaña o recuperar la conexión (la visita a la ruta ya lee siempre el estado vigente)
 * y comunica el resultado.
 *
 * - Cambios de otras personas confirmados por la nueva lectura: aviso `Info` «Solicitud
 *   actualizada», distinto de los avisos de éxito de operaciones propias. Sin cambios, nada.
 * - Fallo de red o del servidor: conserva lo mostrado y ofrece «Reintentar» en un aviso `Danger`.
 * - Solicitud eliminada o sin permiso: el detalle sustituye el contenido por su estado de error.
 *
 * @param {Object} params - Detalle leído y su revalidación.
 * @param {boolean} params.hasProjectRequest - Si hay una solicitud mostrada que revalidar.
 * @param {(options?: {fresh?: boolean}) => Promise<Object>} params.revalidate - Revalidación de
 *   `useProjectRequestDetail`; la revalidación con aviso acepta y reenvía las mismas opciones.
 * @returns {{feedback: Object|null, dismissFeedback: (id: number) => void, revalidate: Function}} Aviso
 *   vigente (con `id` nuevo para volver a mostrarse), su cierre por id y la revalidación con aviso.
 */
export function useAdminProjectRequestSync({ hasProjectRequest, revalidate }) {
  const [feedback, setFeedback] = useState(null);

  const revalidateWithFeedback = useCallback(async (options) => {
    // Se reenvía solo `fresh`: como manejador de eventos o del listener recibe otros argumentos.
    const result = await revalidate(options?.fresh === true ? { fresh: true } : undefined);
    if (result.status === "updated" && result.projectRequest && hasProjectRequestChanged(result.previous, result.projectRequest)) {
      setFeedback({ id: Date.now(), ...getExternalProjectRequestUpdateFeedback(result.previous, result.projectRequest) });
    } else if (result.status === "failed" && !result.replaced) {
      setFeedback({
        canRetry: true,
        description: result.error?.message || "Comprueba tu conexión e inténtalo nuevamente.",
        id: Date.now(),
        theme: "Danger",
        title: "No se pudo actualizar la solicitud",
      });
    }
  }, [revalidate]);

  useResumeRevalidation(revalidateWithFeedback, { enabled: hasProjectRequest });

  return {
    // Solo cierra el aviso indicado: uno nuevo publicado durante la salida se conserva.
    dismissFeedback: useCallback((id) => setFeedback((current) => (current?.id === id ? null : current)), []),
    feedback,
    revalidate: revalidateWithFeedback,
  };
}
