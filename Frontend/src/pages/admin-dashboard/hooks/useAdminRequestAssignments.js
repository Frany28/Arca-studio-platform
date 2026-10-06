import { useEffect, useState } from "react";

import { api } from "../../../api/http.js";

/**
 * Gestiona asignación, borrador, confirmación y feedback del dashboard administrativo.
 * Las acciones de login priorizan overview y recurren a la cola común ya cargada.
 * Conserva la apertura diferida sin añadir lecturas ni alterar el contrato del modal.
 *
 * @param {Object} params - Solicitudes disponibles y sincronización con el dashboard.
 * @param {Object|null} params.firstAdminRequest - Solicitud prioritaria del overview.
 * @param {Array} params.reviewRequests - Primera página de la cola compartida.
 * @param {Function} params.openRequestWorkflow - Abre el detalle usando el workflow común.
 * @param {Function} params.retryReviewQueue - Programa la recarga tras una asignación confirmada.
 * @param {Function} params.onRequestAssigneesUpdated - Reconcilia responsables devueltos con el overview.
 * @returns {Object} Contratos assignment y loginActions consumidos por la página actual.
 */
export function useAdminRequestAssignments({
  firstAdminRequest,
  reviewRequests,
  openRequestWorkflow,
  retryReviewQueue,
  onRequestAssigneesUpdated,
}) {
  const [assignmentModalRequest, setAssignmentModalRequest] = useState(null);
  const [assignmentDraft, setAssignmentDraft] = useState([]);
  const [assignmentSubmitting, setAssignmentSubmitting] = useState(false);
  const [assignmentFeedback, setAssignmentFeedback] = useState(null);
  const [assignmentModalRequested, setAssignmentModalRequested] = useState(false);

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
    retryReviewQueue();
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

  const dismissAssignmentFeedback = () => {
    setAssignmentFeedback(null);
  };

  return {
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
