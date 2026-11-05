import { useEffect, useRef, useState } from "react";

import { api } from "../api/http.js";

// Tope de páginas que se recorren para localizar una solicitud concreta (25 por página).
const MAX_LOOKUP_PAGES = 20;

/**
 * Combina una página nueva con las cargadas, sustituyendo por id la versión anterior.
 *
 * @param {Array} current - Solicitudes cargadas.
 * @param {Array} page - Solicitudes recibidas.
 * @returns {Array} Lista sin duplicados en el orden de llegada.
 */
function mergeQueuePage(current, page) {
  const byId = new Map(current.map((item) => [String(item.id), item]));
  for (const item of page || []) byId.set(String(item.id), item);
  return Array.from(byId.values());
}

/**
 * Mantiene una única cola paginada por cursor y el estado de presentación de la solicitud activa.
 * Recibe la operación de envío sin conocer reglas de decisión o recomendación.
 * La primera página se relee al cambiar el ámbito, reintentar o guardar; las siguientes se
 * cargan bajo demanda (`loadMore`) o hasta encontrar una solicitud (`loadUntil`), se combinan
 * por id y, si fallan, conservan lo ya cargado. Cada relectura de la primera página invalida
 * las páginas en curso, de modo que una respuesta antigua nunca mezcla datos de otra lectura.
 *
 * @param {Object} params - Habilitación, ámbito de lectura y operación del consumidor.
 * @param {boolean} params.enabled - Habilita la lectura compartida de la cola.
 * @param {boolean} params.empty - Conserva el reinicio del escenario vacío.
 * @param {string} params.scopeKey - Cambiar el ámbito vuelve a leer la cola.
 * @param {Function} params.submitOperation - Guarda la solicitud y notifica sus efectos externos.
 * @returns {Object} Cola con cursor, carga de páginas y reintento, y workflow con selección,
 *   error y estado de envío.
 */
export function useProjectRequestWorkflow({ enabled, empty, scopeKey, submitOperation }) {
  const [reviewRequests, setReviewRequests] = useState([]);
  const [reviewRequestsError, setReviewRequestsError] = useState("");
  const [reviewRequestsLoading, setReviewRequestsLoading] = useState(
    enabled,
  );
  const [reviewRequestsRevision, setReviewRequestsRevision] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState("");
  // Copias síncronas para recorrer páginas en un mismo manejador y descartar lecturas antiguas.
  const queueRef = useRef({ cursor: null, generation: 0, loadingMore: false, requests: [] });
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [selectedInitialAction, setSelectedInitialAction] = useState(undefined);
  const [workflowError, setWorkflowError] = useState("");
  const [workflowSubmitting, setWorkflowSubmitting] = useState(false);

  useEffect(() => {
    // Nueva generación: las páginas adicionales todavía en curso se descartan al llegar.
    queueRef.current = { cursor: null, generation: queueRef.current.generation + 1, loadingMore: false, requests: [] };
    if (!enabled) {
      setReviewRequests([]);
      setNextCursor(null);
      setReviewRequestsLoading(false);
      return undefined;
    }

    // Primera página (límite por defecto de la API). La guarda ignora respuestas de efectos
    // ya limpiados, sin cancelar HTTP. Un fallo vacía la cola y conserva su error hasta otra lectura.
    let active = true;
    const { generation } = queueRef.current;
    setReviewRequestsLoading(true);
    setReviewRequestsError("");
    setLoadMoreError("");
    setLoadingMore(false);
    api.projectRequests
      .listReviewQueue()
      .then((data) => {
        if (!active || queueRef.current.generation !== generation) return;
        const requests = data.projectRequests || [];
        queueRef.current = { ...queueRef.current, cursor: data.nextCursor || null, requests };
        setReviewRequests(requests);
        setNextCursor(data.nextCursor || null);
      })
      .catch((error) => {
        if (active) {
          setReviewRequests([]);
          setNextCursor(null);
          setReviewRequestsError(error?.message || "No se pudieron cargar las solicitudes.");
        }
      })
      .finally(() => {
        if (active) setReviewRequestsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [enabled, scopeKey, empty, reviewRequestsRevision]);

  /**
   * Carga la página siguiente si hay cursor y no hay otra en curso. Conserva lo cargado si
   * falla y descarta la respuesta si entretanto se releyó la primera página.
   *
   * @returns {Promise<Array|null>} Cola resultante, o null si no se cargó ninguna página.
   */
  const loadMore = async () => {
    const { cursor, generation, loadingMore: busy } = queueRef.current;
    if (!cursor || busy) return null;

    queueRef.current = { ...queueRef.current, loadingMore: true };
    setLoadingMore(true);
    setLoadMoreError("");
    try {
      const data = await api.projectRequests.listReviewQueue({ cursor });
      if (queueRef.current.generation !== generation) return null;
      const requests = mergeQueuePage(queueRef.current.requests, data.projectRequests);
      queueRef.current = { ...queueRef.current, cursor: data.nextCursor || null, requests };
      setReviewRequests(requests);
      setNextCursor(data.nextCursor || null);
      return requests;
    } catch (error) {
      if (queueRef.current.generation === generation) {
        setLoadMoreError(error?.message || "No se pudieron cargar más solicitudes.");
      }
      return null;
    } finally {
      if (queueRef.current.generation === generation) {
        queueRef.current = { ...queueRef.current, loadingMore: false };
        setLoadingMore(false);
      }
    }
  };

  /**
   * Recorre páginas hasta encontrar la solicitud (con un tope), para que una solicitud que no
   * está en la primera página muestre sus datos completos en lugar de quedar parcial.
   *
   * @param {number|string} requestId - Solicitud buscada.
   * @returns {Promise<Object|null>} Solicitud encontrada o null.
   */
  const loadUntil = async (requestId) => {
    const find = (requests) => requests.find((item) => String(item.id) === String(requestId)) || null;
    let found = find(queueRef.current.requests);
    for (let page = 0; !found && page < MAX_LOOKUP_PAGES && queueRef.current.cursor; page += 1) {
      const requests = await loadMore();
      if (!requests) break;
      found = find(requests);
    }
    return found;
  };

  /**
   * Selecciona la versión de la solicitud presente en la cola por ID numérico.
   * Si no está en la cola usa el objeto recibido, sin cargar detalles adicionales;
   * limpia el error anterior antes de abrir el workflow. La acción inicial se guarda
   * junto con la selección para que cada apertura defina la suya y no herede la anterior.
   *
   * @param {Object} request - Solicitud elegida desde la cola o el overview.
   * @param {Object} [options] - Preferencias de presentación de esta apertura.
   * @param {string} [options.initialAction] - Acción preseleccionada en el modal.
   * @returns {void} Actualiza selectedRequest, initialAction y workflowError.
   */
  const openRequestWorkflow = (request, { initialAction } = {}) => {
    const detailedRequest = reviewRequests.find(
      (candidate) => Number(candidate.id) === Number(request.id),
    );
    setWorkflowError("");
    setSelectedInitialAction(initialAction);
    setSelectedRequest(detailedRequest || request);
  };

  /**
   * Ejecuta la operación recibida y cierra la solicitud solo cuando termina con éxito.
   * El error conserva selección y borrador del modal; siempre libera submitting.
   * La recarga posterior se programa sin esperar la nueva lectura de la cola.
   *
   * @param {Object} params - Acción, reunión opcional y nota normalizadas por el modal consumidor.
   * @returns {Promise<void>} Completa el envío; los errores quedan en workflow.error.
   */
  const submitRequestWorkflow = async ({ action, meetingRecommendation, note }) => {
    if (!selectedRequest) return;
    setWorkflowSubmitting(true);
    setWorkflowError("");
    try {
      await submitOperation(selectedRequest, { action, meetingRecommendation, note });
      setSelectedRequest(null);
      setReviewRequestsRevision((current) => current + 1);
    } catch (error) {
      setWorkflowError(error?.message || "No se pudo guardar la revisión.");
    } finally {
      setWorkflowSubmitting(false);
    }
  };

  const retryReviewQueue = () => {
    setReviewRequestsRevision((current) => current + 1);
  };

  // El cierre manual conserva workflowError y se bloquea durante submitting;
  // abrir otra solicitud o intentar guardar limpia ese error.
  const closeRequestWorkflow = () => {
    if (!workflowSubmitting) setSelectedRequest(null);
  };

  return {
    reviewQueue: {
      requests: reviewRequests,
      error: reviewRequestsError,
      hasMore: Boolean(nextCursor),
      loading: reviewRequestsLoading,
      loadingMore,
      loadMore,
      loadMoreError,
      loadUntil,
      retry: retryReviewQueue,
    },
    workflow: {
      selectedRequest,
      initialAction: selectedInitialAction,
      error: workflowError,
      submitting: workflowSubmitting,
      open: openRequestWorkflow,
      close: closeRequestWorkflow,
      submit: submitRequestWorkflow,
    },
  };
}
