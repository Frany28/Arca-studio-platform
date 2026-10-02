import { useEffect, useState } from "react";

import { api } from "../../../api/http.js";

/**
 * Coordina la cola de revisión, la solicitud activa y la asignación de responsables.
 * Admin decide aprobación, rechazo o cambios; architect envía recomendaciones.
 * Los callbacks conectan las mutaciones con el overview y el refresco del dashboard.
 *
 * @param {Object} params - Contexto del dashboard y sincronización externa.
 * @param {boolean} params.empty - Deshabilita la lectura de la cola en el escenario vacío.
 * @param {string} params.roleCode - Habilita la cola para admin/architect y distingue decisión de revisión.
 * @param {Object|null} params.firstAdminRequest - Solicitud prioritaria del overview para las acciones de login.
 * @param {Function} params.onRequestAssigneesUpdated - Recibe ID y responsables confirmados para actualizar el overview.
 * @param {Function} params.onAdminDecisionCommitted - Solicita refrescar overview, métricas y proyectos tras una decisión admin.
 * @returns {Object} reviewQueue agrupa lectura/error/reintento; workflow, selección/error/envío;
 * assignment, modal/borrador/envío/feedback; loginActions, accesos a asignación y revisión.
 */
export function useDashboardRequestWorkflow({
  empty,
  roleCode,
  firstAdminRequest,
  onRequestAssigneesUpdated,
  onAdminDecisionCommitted,
}) {
  const [reviewRequests, setReviewRequests] = useState([]);
  const [reviewRequestsError, setReviewRequestsError] = useState("");
  const [reviewRequestsLoading, setReviewRequestsLoading] = useState(
    ["admin", "architect"].includes(roleCode) && !empty,
  );
  const [reviewRequestsRevision, setReviewRequestsRevision] = useState(0);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [workflowError, setWorkflowError] = useState("");
  const [workflowSubmitting, setWorkflowSubmitting] = useState(false);
  const [assignmentModalRequest, setAssignmentModalRequest] = useState(null);
  const [assignmentDraft, setAssignmentDraft] = useState([]);
  const [assignmentSubmitting, setAssignmentSubmitting] = useState(false);
  const [assignmentFeedback, setAssignmentFeedback] = useState(null);
  const [assignmentModalRequested, setAssignmentModalRequested] = useState(false);

  useEffect(() => {
    if (!["admin", "architect"].includes(roleCode) || empty) {
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
  }, [roleCode, empty, reviewRequestsRevision]);

  /**
   * Persiste la asignación usando IDs numéricos y notifica los responsables devueltos.
   * Tras el éxito actualiza el overview mediante el callback y solicita recargar la cola;
   * los errores se propagan al consumidor, incluida la confirmación del modal.
   *
   * @param {Object} request - Solicitud cuyo ID se usará para guardar la asignación.
   * @param {Array} assignees - Responsables elegidos para construir assigneeIds.
   * @returns {Promise<void>} Finaliza el guardado y programa la lectura de la cola sin esperarla.
   * @throws {Error} Propaga fallos del guardado o de la sincronización externa.
   */
  const handleRequestAssigneesChange = async (request, assignees) => {
    const data = await api.admin.updateProjectRequestAssignees({
      assigneeIds: assignees.map((assignee) => Number(assignee.id)),
      projectRequestId: request.id,
    });

    onRequestAssigneesUpdated(request.id, data.assignees || []);
    setReviewRequestsRevision((current) => current + 1);
  };

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

  // Las acciones de login priorizan la solicitud del overview y usan la primera
  // de la cola como respaldo; si aún no hay solicitud, asignar queda pendiente.
  const loginNotificationRequest =
    firstAdminRequest || reviewRequests[0] || null;

  useEffect(() => {
    if (!assignmentModalRequested || !loginNotificationRequest) {
      return undefined;
    }

    // Abre la asignación en una microtarea cuando ya existe la solicitud prioritaria.
    // La limpieza evita aplicar una apertura programada por un efecto anterior.
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;

      setAssignmentDraft(loginNotificationRequest.assignees || []);
      setAssignmentModalRequest(loginNotificationRequest);
      setAssignmentModalRequested(false);
    });

    return () => {
      cancelled = true;
    };
  }, [assignmentModalRequested, loginNotificationRequest]);

  const handleLoginNotificationAssign = () => {
    setAssignmentModalRequested(true);
  };

  const handleLoginNotificationView = () => {
    if (loginNotificationRequest) {
      openRequestWorkflow(loginNotificationRequest);
    }
  };

  // El cierre manual se bloquea durante el envío; al cerrar descarta el borrador.
  const closeAssignmentModal = () => {
    if (assignmentSubmitting) return;

    setAssignmentModalRequest(null);
    setAssignmentDraft([]);
  };

  /**
   * Confirma una asignación solo con solicitud, borrador no vacío y sin otro envío.
   * Usa el guardado compartido y cierra el modal y limpia el borrador tanto en éxito
   * como en error; publica feedback descartable y siempre libera assignmentSubmitting.
   *
   * @returns {Promise<void>} Completa el flujo y su aviso; captura el error de asignación.
   */
  const confirmRequestAssignment = async () => {
    if (!assignmentModalRequest || !assignmentDraft.length || assignmentSubmitting) {
      return;
    }

    const request = assignmentModalRequest;
    const selectedNames = assignmentDraft.map((assignee) => assignee.name).join(", ");

    setAssignmentSubmitting(true);
    try {
      await handleRequestAssigneesChange(request, assignmentDraft);
      setAssignmentModalRequest(null);
      setAssignmentDraft([]);
      setAssignmentFeedback({
        id: `request-assignment-success-${Date.now()}`,
        type: "success",
        title: "Responsable asignado",
        message: `${selectedNames} revisará ${request.projectName}.`,
      });
    } catch (error) {
      setAssignmentModalRequest(null);
      setAssignmentDraft([]);
      setAssignmentFeedback({
        id: `request-assignment-error-${Date.now()}`,
        type: "error",
        title: "No se pudo asignar al responsable",
        message: error?.message || "Inténtalo nuevamente.",
      });
    } finally {
      setAssignmentSubmitting(false);
    }
  };

  /**
   * Envía la decisión admin o la recomendación de revisión para la solicitud activa.
   * Admin traduce changes_requested a request_changes y usa la nota como internalNotes
   * al aprobar o reason en otras decisiones; architect envía action como recommendation.
   * Tras éxito cierra el workflow y recarga la cola; admin además notifica al dashboard.
   * Un fallo conserva selección y workflowError para reintentar, y libera submitting.
   *
   * @param {Object} params - Acción y nota preparados por el modal.
   * @param {string} params.action - approve, reject o changes_requested según la opción elegida.
   * @param {string} params.note - Nota normalizada por el formulario consumidor.
   * @returns {Promise<void>} Finaliza el envío y solicita los refrescos sin esperar sus lecturas.
   */
  const submitRequestWorkflow = async ({ action, note }) => {
    if (!selectedRequest) return;
    setWorkflowSubmitting(true);
    setWorkflowError("");
    try {
      if (roleCode === "admin") {
        await api.admin.decideProjectRequest({
          action: action === "changes_requested" ? "request_changes" : action,
          internalNotes: action === "approve" ? note || undefined : undefined,
          projectRequestId: selectedRequest.id,
          reason: action === "approve" ? undefined : note,
        });
        // El hook delega al backend la decisión; no construye ni inserta un proyecto.
        // La página vuelve a leer proyectos para reflejar el resultado de la aprobación.
        onAdminDecisionCommitted();
      } else {
        await api.projectRequests.review({
          note,
          projectRequestId: selectedRequest.id,
          recommendation: action,
        });
      }
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

  const dismissAssignmentFeedback = () => {
    setAssignmentFeedback(null);
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
    assignment: {
      request: assignmentModalRequest,
      draft: assignmentDraft,
      submitting: assignmentSubmitting,
      feedback: assignmentFeedback,
      setDraft: setAssignmentDraft,
      close: closeAssignmentModal,
      confirm: confirmRequestAssignment,
      dismissFeedback: dismissAssignmentFeedback,
      updateAssignees: handleRequestAssigneesChange,
    },
    loginActions: {
      assign: handleLoginNotificationAssign,
      view: handleLoginNotificationView,
    },
  };
}
