import { useEffect, useState } from "react";

import { api } from "../api/http.js";

/**
 * Mantiene una única cola y el estado de presentación de la solicitud activa.
 * Recibe la operación de envío sin conocer reglas de decisión o recomendación.
 * Conserva la primera página y descarta lecturas de efectos ya limpiados.
 *
 * @param {Object} params - Habilitación, ámbito de lectura y operación del consumidor.
 * @param {boolean} params.enabled - Habilita la lectura compartida de la cola.
 * @param {boolean} params.empty - Conserva el reinicio del escenario vacío.
 * @param {string} params.scopeKey - Cambiar el ámbito vuelve a leer la cola.
 * @param {Function} params.submitOperation - Guarda la solicitud y notifica sus efectos externos.
 * @returns {Object} Cola con reintento y workflow con selección, error y estado de envío.
 */
export function useProjectRequestWorkflow({ enabled, empty, scopeKey, submitOperation }) {
  const [reviewRequests, setReviewRequests] = useState([]);
  const [reviewRequestsError, setReviewRequestsError] = useState("");
  const [reviewRequestsLoading, setReviewRequestsLoading] = useState(
    enabled,
  );
  const [reviewRequestsRevision, setReviewRequestsRevision] = useState(0);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [workflowError, setWorkflowError] = useState("");
  const [workflowSubmitting, setWorkflowSubmitting] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setReviewRequests([]);
      setReviewRequestsLoading(false);
      return undefined;
    }

    // Solo carga la primera página de la cola (límite por defecto de la API);
    // no conserva nextCursor. La guarda ignora respuestas de efectos ya limpiados,
    // sin cancelar HTTP. Un fallo vacía la cola y conserva su error hasta otra lectura.
    let active = true;
    setReviewRequestsLoading(true);
    setReviewRequestsError("");
    api.projectRequests
      .listReviewQueue()
      .then((data) => {
        if (active) setReviewRequests(data.projectRequests || []);
      })
      .catch((error) => {
        if (active) {
          setReviewRequests([]);
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
   * Selecciona la versión de la solicitud presente en la cola por ID numérico.
   * Si no está en la cola usa el objeto recibido, sin cargar detalles adicionales;
   * limpia el error anterior antes de abrir el workflow.
   *
   * @param {Object} request - Solicitud elegida desde la cola o el overview.
   * @returns {void} Actualiza selectedRequest y workflowError.
   */
  const openRequestWorkflow = (request) => {
    const detailedRequest = reviewRequests.find(
      (candidate) => Number(candidate.id) === Number(request.id),
    );
    setWorkflowError("");
    setSelectedRequest(detailedRequest || request);
  };

  /**
   * Ejecuta la operación recibida y cierra la solicitud solo cuando termina con éxito.
   * El error conserva selección y borrador del modal; siempre libera submitting.
   * La recarga posterior se programa sin esperar la nueva lectura de la cola.
   *
   * @param {Object} params - Acción y nota normalizadas por el modal consumidor.
   * @returns {Promise<void>} Completa el envío; los errores quedan en workflow.error.
   */
  const submitRequestWorkflow = async ({ action, note }) => {
    if (!selectedRequest) return;
    setWorkflowSubmitting(true);
    setWorkflowError("");
    try {
      await submitOperation(selectedRequest, { action, note });
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
      loading: reviewRequestsLoading,
      retry: retryReviewQueue,
    },
    workflow: {
      selectedRequest,
      error: workflowError,
      submitting: workflowSubmitting,
      open: openRequestWorkflow,
      close: closeRequestWorkflow,
      submit: submitRequestWorkflow,
    },
  };
}
