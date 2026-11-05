import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../../api/http.js";

// Resultado de la última lectura terminada; la carga se deriva comparando su id y revisión.
const INITIAL_STATE = Object.freeze({ error: "", errorStatus: null, projectRequest: null, requestId: null, revision: -1 });

/**
 * Lector por defecto: solicitud propia del cliente autenticado.
 *
 * @param {number|string} projectRequestId - Solicitud a consultar.
 * @param {{signal: AbortSignal}} options - Cancelación de la lectura.
 * @returns {Promise<{projectRequest: Object}>} Respuesta de la API.
 */
function fetchOwnProjectRequest(projectRequestId, { signal }) {
  return api.projectRequests.get(projectRequestId, { signal });
}

/**
 * Lee del backend una solicitud propia con su estado vigente y sus adjuntos persistidos,
 * para la vista de consulta. No usa archivos seleccionados en la sesión ni datos locales.
 *
 * Carga solo mientras `enabled` sea true y hay un id. Cada lectura aborta la anterior al
 * cambiar de id, al reintentar o al desmontar, de modo que una respuesta obsoleta nunca
 * sobrescribe la más reciente. El resultado se conserva para el mismo id (volver a la vista
 * no repite la petición); `reload` fuerza una nueva lectura, por ejemplo tras un error.
 * Sin caché compartida: el dato es privado del usuario y vive con la página.
 * `fetchProjectRequest` permite reutilizar el ciclo con otro endpoint autorizado (por ejemplo,
 * el detalle administrativo); debe ser una referencia estable para no repetir la lectura.
 *
 * @param {Object} params - Solicitud a consultar y activación.
 * @param {number|string|null} params.projectRequestId - Solicitud propia del cliente.
 * @param {boolean} params.enabled - Si la vista de consulta está visible.
 * @param {(id: number|string, options: {signal: AbortSignal}) => Promise<{projectRequest: Object}>} [params.fetchProjectRequest]
 *   Lector de la solicitud; por defecto, la solicitud propia del cliente.
 * @returns {{error: string, errorStatus: number|null, loading: boolean, projectRequest: Object|null, reload: Function}}
 *   Solicitud con `files`, estado de carga, mensaje y estado HTTP del error (null si fue de red) y reintento.
 */
export default function useProjectRequestDetail({ enabled, fetchProjectRequest = fetchOwnProjectRequest, projectRequestId }) {
  const [state, setState] = useState(INITIAL_STATE);
  const [revision, setRevision] = useState(0);
  // Clave (id + revisión) de la última lectura iniciada: evita repetirla al volver a la vista.
  const startedKeyRef = useRef(null);
  const hasId = projectRequestId !== null && projectRequestId !== undefined && projectRequestId !== "";
  const isCurrent = hasId && String(state.requestId) === String(projectRequestId);
  const isSettled = isCurrent && state.revision === revision;

  useEffect(() => {
    if (!enabled || !hasId) return undefined;
    const key = `${projectRequestId}:${revision}`;
    if (startedKeyRef.current === key) return undefined;

    startedKeyRef.current = key;
    const controller = new AbortController();
    let settled = false;
    fetchProjectRequest(projectRequestId, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        settled = true;
        setState({ error: "", errorStatus: null, projectRequest: data?.projectRequest || null, requestId: projectRequestId, revision });
      })
      .catch((error) => {
        // La cancelación es deliberada (cambio de vista, de id o desmontaje): no es un error visible.
        if (controller.signal.aborted || error?.name === "AbortError") return;
        settled = true;
        setState({
          error: error?.message || "No se pudo cargar la solicitud.",
          errorStatus: Number.isInteger(error?.status) ? error.status : null,
          projectRequest: null,
          requestId: projectRequestId,
          revision,
        });
      });

    return () => {
      controller.abort();
      // Una lectura abortada antes de terminar no cuenta: se repetirá al volver a la vista.
      if (!settled && startedKeyRef.current === key) startedKeyRef.current = null;
    };
  }, [enabled, fetchProjectRequest, hasId, projectRequestId, revision]);

  const reload = useCallback(() => setRevision((current) => current + 1), []);

  return {
    error: isSettled ? state.error : "",
    errorStatus: isSettled ? state.errorStatus : null,
    loading: enabled && hasId && !isSettled,
    projectRequest: isSettled ? state.projectRequest : null,
    reload,
  };
}
