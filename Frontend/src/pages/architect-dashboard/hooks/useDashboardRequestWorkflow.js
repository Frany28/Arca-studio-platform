import { useEffect, useState } from "react";

import { api } from "../../../api/http.js";

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

  const handleRequestAssigneesChange = async (request, assignees) => {
    const data = await api.admin.updateProjectRequestAssignees({
      assigneeIds: assignees.map((assignee) => Number(assignee.id)),
      projectRequestId: request.id,
    });

    onRequestAssigneesUpdated(request.id, data.assignees || []);
    setReviewRequestsRevision((current) => current + 1);
  };

  const openRequestWorkflow = (request) => {
    const detailedRequest = reviewRequests.find(
      (candidate) => Number(candidate.id) === Number(request.id),
    );
    setWorkflowError("");
    setSelectedRequest(detailedRequest || request);
  };

  const loginNotificationRequest =
    firstAdminRequest || reviewRequests[0] || null;

  useEffect(() => {
    if (!assignmentModalRequested || !loginNotificationRequest) {
      return undefined;
    }

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

  const closeAssignmentModal = () => {
    if (assignmentSubmitting) return;

    setAssignmentModalRequest(null);
    setAssignmentDraft([]);
  };

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
