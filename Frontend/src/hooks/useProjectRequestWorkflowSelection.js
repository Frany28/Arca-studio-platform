import { useState } from "react";

import { isStaleProjectRequestError } from "../utils/projectRequestSync.js";

/**
 * Estado de presentación del modal de revisión o decisión de una solicitud: solicitud activa,
 * acción inicial, envío, error y aviso de éxito. No lee colecciones ni conoce las reglas de la
 * operación: la recibe del consumidor, igual que sus efectos posteriores.
 *
 * Lo comparten la cola paginada de los dashboards (`useProjectRequestWorkflow`) y la consulta
 * administrativa de una solicitud, que decide sin cargar la cola.
 *
 * - El aviso de éxito se publica solo tras la confirmación de la API, con un `id` nuevo.
 * - Un error conserva la selección y el borrador del modal y queda en `error`; si la solicitud
 *   cambió de estado o desapareció (otra persona decidió), se notifica `onStaleError` para releer.
 * - `submitting` protege contra envíos repetidos y bloquea el cierre manual.
 *
 * @param {Object} params - Operación y efectos del consumidor.
 * @param {(request: Object, values: Object) => Promise<unknown>} params.submitOperation - Guarda la
 *   solicitud; su resultado se entrega a `getSuccessFeedback` y `onSubmitted`.
 * @param {(request: Object, values: Object, result: unknown) => Object|null} [params.getSuccessFeedback]
 *   Aviso de éxito ({theme, title, content, description}) tras una operación confirmada.
 * @param {(request: Object, values: Object, result: unknown) => void} [params.onSubmitted] - Efectos
 *   tras la confirmación (por ejemplo, releer la cola).
 * @param {(error: Error) => void} [params.onStaleError] - Conflicto de estado obsoleto.
 * @param {(values: Object, result: unknown) => boolean} [params.keepOpenAfter] - Si devuelve true, el
 *   modal sigue abierto tras la confirmación y `completedAction` indica la acción completada (por
 *   ejemplo, «Solicitud Aprobada» con el contacto del cliente). Por defecto se cierra.
 * @returns {{selectedRequest: Object|null, initialAction: string|undefined, completedAction: string|null,
 *   error: string, submitting: boolean, feedback: Object|null, dismissFeedback: (id: string) => void,
 *   open: Function, close: Function, submit: Function}} Estado y acciones del modal.
 */
export function useProjectRequestWorkflowSelection({ getSuccessFeedback, keepOpenAfter, onStaleError, onSubmitted, submitOperation }) {
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [completedAction, setCompletedAction] = useState(null);
  const [initialAction, setInitialAction] = useState(undefined);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  /**
   * Abre el modal con la solicitud indicada. La acción inicial se guarda junto con la selección
   * para que cada apertura defina la suya y no herede la anterior; limpia el error previo.
   *
   * @param {Object} request - Solicitud a revisar o decidir.
   * @param {{initialAction?: string}} [options] - Acción preseleccionada en el modal.
   * @returns {void}
   */
  const open = (request, { initialAction: action } = {}) => {
    setError("");
    setCompletedAction(null);
    setInitialAction(action);
    setSelectedRequest(request);
  };

  /**
   * Ejecuta la operación y cierra el modal solo si termina con éxito. Siempre libera
   * `submitting`; los efectos posteriores no se esperan.
   *
   * @param {{action: string, meetingRecommendation?: string, note: string}} values - Valores del modal.
   * @returns {Promise<void>} Completa el envío; los errores quedan en `error`.
   */
  const submit = async ({ action, meetingRecommendation, note }) => {
    if (!selectedRequest || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const values = { action, meetingRecommendation, note };
      const result = await submitOperation(selectedRequest, values);
      const nextFeedback = getSuccessFeedback?.(selectedRequest, values, result) || null;
      // Una acción completada que el consumidor quiere mostrar mantiene el modal abierto.
      if (keepOpenAfter?.(values, result)) setCompletedAction(action);
      else setSelectedRequest(null);
      onSubmitted?.(selectedRequest, values, result);
      if (nextFeedback) setFeedback({ ...nextFeedback, id: `${selectedRequest.id}-${Date.now()}` });
    } catch (submitError) {
      setError(submitError?.message || "No se pudo guardar la revisión.");
      if (isStaleProjectRequestError(submitError)) onStaleError?.(submitError);
    } finally {
      setSubmitting(false);
    }
  };

  return {
    selectedRequest,
    initialAction,
    completedAction,
    error,
    submitting,
    feedback,
    // Solo cierra el aviso indicado: uno nuevo publicado durante la salida se conserva.
    dismissFeedback: (id) => setFeedback((current) => (current?.id === id ? null : current)),
    open,
    // El cierre manual conserva el error y se bloquea durante el envío; abrir otra solicitud o
    // intentar guardar lo limpia.
    close: () => {
      if (submitting) return;
      setSelectedRequest(null);
      setCompletedAction(null);
    },
    submit,
  };
}
