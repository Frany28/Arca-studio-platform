import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../../api/http.js";

// Resultado de la última lectura terminada; la carga se deriva comparando su id y revisión.
const INITIAL_STATE = Object.freeze({ error: "", errorStatus: null, projectRequest: null, requestId: null, revision: -1 });

// Estados HTTP con los que una revalidación sustituye la solicitud mostrada por el error: la
// solicitud dejó de existir o de ser accesible y no debe seguir visible. Una caída de red o
// del servidor conserva lo mostrado y solo informa del fallo.
const REVALIDATION_REPLACING_STATUSES = new Set([400, 401, 403, 404]);

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
 * Estado de error de una lectura terminada.
 *
 * @param {Error & {status?: number}} error - Error de la API.
 * @param {number|string} requestId - Solicitud leída.
 * @param {number} revision - Revisión de la lectura.
 * @returns {Object} Estado con mensaje y estado HTTP (null si fue de red).
 */
function toFailureState(error, requestId, revision) {
  return {
    error: error?.message || "No se pudo cargar la solicitud.",
    errorStatus: Number.isInteger(error?.status) ? error.status : null,
    projectRequest: null,
    requestId,
    revision,
  };
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
 * `revalidate` vuelve a leer en segundo plano sin mostrar la carga: conserva la solicitud
 * visible hasta recibir la nueva. Solo hay una revalidación activa; `reload`, cambiar de id o
 * desmontar la cancelan, y su respuesta se descarta si entretanto cambió la lectura vigente.
 * Si la solicitud ya no existe o dejó de estar autorizada, el error sustituye a lo mostrado.
 *
 * @param {Object} params - Solicitud a consultar y activación.
 * @param {number|string|null} params.projectRequestId - Solicitud propia del cliente.
 * @param {boolean} params.enabled - Si la vista de consulta está visible.
 * @param {(id: number|string, options: {signal: AbortSignal}) => Promise<{projectRequest: Object}>} [params.fetchProjectRequest]
 *   Lector de la solicitud; por defecto, la solicitud propia del cliente.
 * @returns {{error: string, errorStatus: number|null, loading: boolean, projectRequest: Object|null, reload: Function,
 *   revalidate: () => Promise<{status: "updated"|"failed"|"discarded"|"skipped", previous?: Object, projectRequest?: Object|null,
 *   error?: Error, replaced?: boolean}>}} `replaced` indica que el error sustituyó a la solicitud mostrada.
 *   Solicitud con `files`, estado de carga, mensaje y estado HTTP del error (null si fue de red),
 *   reintento y revalidación en segundo plano.
 */
export default function useProjectRequestDetail({ enabled, fetchProjectRequest = fetchOwnProjectRequest, projectRequestId }) {
  const [state, setState] = useState(INITIAL_STATE);
  const [revision, setRevision] = useState(0);
  // Clave (id + revisión) de la última lectura iniciada: evita repetirla al volver a la vista.
  const startedKeyRef = useRef(null);
  // Revalidación en curso y copia de lo vigente para resolverla fuera del render.
  const revalidationRef = useRef(null);
  const latestRef = useRef({ enabled, fetchProjectRequest, projectRequestId, revision, state });
  const hasId = projectRequestId !== null && projectRequestId !== undefined && projectRequestId !== "";
  const isCurrent = hasId && String(state.requestId) === String(projectRequestId);
  const isSettled = isCurrent && state.revision === revision;

  useEffect(() => {
    latestRef.current = { enabled, fetchProjectRequest, projectRequestId, revision, state };
  });

  useEffect(() => {
    if (!enabled || !hasId) return undefined;
    const key = `${projectRequestId}:${revision}`;
    if (startedKeyRef.current === key) return undefined;

    startedKeyRef.current = key;
    // Una lectura completa sustituye a cualquier revalidación anterior.
    revalidationRef.current?.abort();
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
        setState(toFailureState(error, projectRequestId, revision));
      });

    return () => {
      controller.abort();
      // Una lectura abortada antes de terminar no cuenta: se repetirá al volver a la vista.
      if (!settled && startedKeyRef.current === key) startedKeyRef.current = null;
    };
  }, [enabled, fetchProjectRequest, hasId, projectRequestId, revision]);

  // Al desmontar, una revalidación pendiente no debe actualizar estado.
  useEffect(() => () => revalidationRef.current?.abort(), []);

  const reload = useCallback(() => setRevision((current) => current + 1), []);

  const revalidate = useCallback(async () => {
    const snapshot = latestRef.current;
    const shown = snapshot.state;
    const matchesShown = String(shown.requestId) === String(snapshot.projectRequestId) && shown.revision === snapshot.revision;
    // Solo se revalida una solicitud ya mostrada; durante la carga o un error manda `reload`.
    if (!snapshot.enabled || !matchesShown || !shown.projectRequest) return { status: "skipped" };

    revalidationRef.current?.abort();
    const controller = new AbortController();
    revalidationRef.current = controller;
    const { projectRequestId: requestId, revision: requestRevision } = snapshot;
    // La respuesta solo se aplica si sigue vigente la misma solicitud y revisión.
    const isStillCurrent = () => !controller.signal.aborted
      && String(latestRef.current.projectRequestId) === String(requestId)
      && latestRef.current.revision === requestRevision;
    const applyIfCurrent = (nextState) => setState((current) => (
      String(current.requestId) === String(requestId) && current.revision === requestRevision ? nextState : current
    ));

    try {
      const data = await snapshot.fetchProjectRequest(requestId, { signal: controller.signal });
      if (!isStillCurrent()) return { status: "discarded" };
      const projectRequest = data?.projectRequest || null;
      applyIfCurrent({ error: "", errorStatus: null, projectRequest, requestId, revision: requestRevision });
      return { previous: shown.projectRequest, projectRequest, status: "updated" };
    } catch (error) {
      if (!isStillCurrent() || error?.name === "AbortError") return { status: "discarded" };
      const replaced = REVALIDATION_REPLACING_STATUSES.has(error?.status);
      if (replaced) applyIfCurrent(toFailureState(error, requestId, requestRevision));
      return { error, replaced, status: "failed" };
    } finally {
      if (revalidationRef.current === controller) revalidationRef.current = null;
    }
  }, []);

  return {
    error: isSettled ? state.error : "",
    errorStatus: isSettled ? state.errorStatus : null,
    loading: enabled && hasId && !isSettled,
    projectRequest: isSettled ? state.projectRequest : null,
    reload,
    revalidate,
  };
}
