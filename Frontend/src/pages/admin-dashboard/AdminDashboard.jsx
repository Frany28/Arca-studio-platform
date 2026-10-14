import { useMemo, useState } from "react";

import { useAuth } from "../../auth/AuthContext.jsx";
import { getUserDisplay } from "../../auth/userDisplay.js";
import AlertToast from "../../components/ui/AlertToast/AlertToast.jsx";
import NotificationsDrawer from "../../components/EnvironmentNotificationsDrawer.jsx";
import { useDashboardNavigation } from "../../hooks/useDashboardNavigation.js";
import { useProjectRequestWorkflow } from "../../hooks/useProjectRequestWorkflow.js";
import InternalDashboardLayout from "../../layouts/InternalDashboardLayout.jsx";
import { getProjectPath } from "../../utils/projectRoutes.js";
import { isProjectOperationallyReadOnly } from "../../utils/projectReadOnly.js";
import AdminDashboardHeader from "./components/AdminDashboardHeader.jsx";
import AdminDashboardMetrics from "./components/AdminDashboardMetrics.jsx";
import AdminDashboardOperations from "./components/AdminDashboardOperations.jsx";
import AdminDashboardOverview from "./components/AdminDashboardOverview.jsx";
import AdminActiveProjects from "./components/admin-active-projects/index.js";
import AdminRequestDetailsDrawer from "./components/admin-request-details/index.js";
import AdminRequestLoginAlert from "./components/AdminRequestLoginAlert.jsx";
import AdminRequestAssignmentModal from "./components/AdminRequestAssignmentModal.jsx";
import { useAdminDashboardData } from "./hooks/useAdminDashboardData.js";
import { useAdminProjectMutations } from "./hooks/useAdminProjectMutations.js";
import { useAdminRequestAssignments } from "./hooks/useAdminRequestAssignments.js";
import { useAdminRequestDetails } from "./hooks/useAdminRequestDetails.js";
import { submitAdminRequestDecision } from "./utils/adminRequestDecision.js";
import { useDashboardProjects } from "../../hooks/useDashboardProjects.js";
import ProjectRequestWorkflowModal from "../../components/project-requests/ProjectRequestWorkflowModal.jsx";

/**
 * Compone exclusivamente métricas, operación, solicitudes y proyectos administrativos.
 * Conserva mutaciones, feedback y claves coordinadas de refresco de la página original.
 *
 * @param {Object} props - Opciones del escenario de dashboard.
 * @param {boolean} [props.empty=false] - Omite cargas y muestra los estados vacíos actuales.
 * @returns {import("react").ReactElement} Dashboard administrativo con navegación y drawer compartidos.
 */
function AdminDashboard({ empty = false }) {
  const { loginEventId, user } = useAuth();
  const currentUser = getUserDisplay(user);
  const [projectsRequestKey, setProjectsRequestKey] = useState(0);
  const {
    projectsError,
    projectsLoading,
    projectRows,
    setProjects,
  } = useDashboardProjects({ empty, user, projectsRequestKey });
  const navigation = useDashboardNavigation({ projectRows, roleCode: currentUser.roleCode });
  const { navigate, isNotificationsDrawerOpen, setIsNotificationsDrawerOpen, handleActivitySelect } = navigation;
  const [adminMetricsRequestKey, setAdminMetricsRequestKey] = useState(0);
  const [adminOverviewRequestKey, setAdminOverviewRequestKey] = useState(0);
  const {
    adminMetrics,
    adminMetricsError,
    adminMetricsLoading,
    adminOverview,
    adminOverviewError,
    adminOverviewLoading,
    adminAssignees,
    adminAssigneesLoading,
    setAdminOverview,
  } = useAdminDashboardData({
    empty,
    roleCode: currentUser.roleCode,
    user,
    adminMetricsRequestKey,
    adminOverviewRequestKey,
  });
  /**
   * Reconcilia responsables confirmados con las solicitudes del overview.
   * Conserva los demás datos de cada solicitud y la colección actual.
   * @param {number} requestId - ID confirmado de la solicitud.
   * @param {Array} assignees - Responsables devueltos por la API.
   * @returns {void} Programa la actualización local del overview.
   */
  const handleRequestAssigneesUpdated = (requestId, assignees) => {
    setAdminOverview((currentOverview) => ({
      ...currentOverview,
      newRequests: (currentOverview?.newRequests || []).map((currentRequest) =>
        currentRequest.id === requestId
          ? { ...currentRequest, assignees }
          : currentRequest,
      ),
    }));
  };

  /**
   * Programa las tres lecturas externas tras una decisión confirmada.
   * La cola se refresca por separado desde el núcleo compartido del workflow.
   * @returns {void} Incrementa las claves de overview, métricas y proyectos.
   */
  const handleAdminDecisionCommitted = () => {
    setAdminOverviewRequestKey((current) => current + 1);
    setAdminMetricsRequestKey((current) => current + 1);
    setProjectsRequestKey((current) => current + 1);
  };

  const { reviewQueue, workflow } = useProjectRequestWorkflow({
    enabled: currentUser.roleCode === "admin" && !empty,
    empty,
    scopeKey: currentUser.roleCode,
    submitOperation: (request, values) => submitAdminRequestDecision(request, values, handleAdminDecisionCommitted),
  });
  const { assignment, loginActions } = useAdminRequestAssignments({
    firstAdminRequest: adminOverview?.newRequests?.[0] || null,
    reviewRequests: reviewQueue.requests,
    openRequestWorkflow: workflow.open,
    retryReviewQueue: reviewQueue.retry,
    onRequestAssigneesUpdated: handleRequestAssigneesUpdated,
  });
  const requestDetails = useAdminRequestDetails({
    newRequests: adminOverview?.newRequests,
    reviewQueue,
    openRequestWorkflow: workflow.open,
  });
  const upcomingDeliveries = useMemo(
    () =>
      [...projectRows]
        .filter(
          (project) =>
            !isProjectOperationallyReadOnly(project) && project.status !== "cancelled",
        )
        .sort((first, second) => {
          const firstDate = first.endDate
            ? new Date(first.endDate).getTime()
            : Number.POSITIVE_INFINITY;
          const secondDate = second.endDate
            ? new Date(second.endDate).getTime()
            : Number.POSITIVE_INFINITY;

          return firstDate - secondDate;
        })
        .slice(0, 3),
    [projectRows],
  );
  const handleNotificationsToggle = () => {
    const willOpen = !isNotificationsDrawerOpen;

    setIsNotificationsDrawerOpen(willOpen);

    if (willOpen) {
      setAdminOverviewRequestKey((current) => current + 1);
    }
  };

  const { updateProjectAssignees, applyProjectBulkAction } = useAdminProjectMutations({
    setProjects,
    // Una acción confirmada cambia contadores y actividad derivados de los proyectos.
    onProjectsChanged: () => {
      setAdminMetricsRequestKey((current) => current + 1);
      setAdminOverviewRequestKey((current) => current + 1);
    },
  });

  return (
    <InternalDashboardLayout
      currentUser={currentUser}
      navigation={navigation}
      onNotificationsToggle={handleNotificationsToggle}
    >
      <AdminDashboardHeader />
      <AdminDashboardMetrics
        error={adminMetricsError}
        loading={adminMetricsLoading}
        metrics={adminMetrics}
        onRetry={() =>
          setAdminMetricsRequestKey((current) => current + 1)
        }
      />
      <AdminDashboardOperations
        deliveries={upcomingDeliveries}
        deliveriesError={projectsError}
        deliveriesLoading={projectsLoading}
        events={empty ? [] : undefined}
        onProjectSelect={(project) => navigate(getProjectPath(project))}
        onViewProjects={() => navigate("/proyectos")}
      />
      <AdminDashboardOverview
        assignees={adminAssignees}
        assigneesLoading={adminAssigneesLoading}
        error={adminOverviewError}
        loading={adminOverviewLoading}
        newRequests={adminOverview?.newRequests}
        recentActivity={(adminOverview?.recentActivity || []).slice(0, 3)}
        onActivitySelect={(activity) => {
          const project = projectRows.find(
            (currentProject) =>
              currentProject.id === Number(activity.projectId),
          );

          if (project) {
            navigate(getProjectPath(project));
          }
        }}
        onRequestAssigneesChange={assignment.updateAssignees}
        onRequestOpen={requestDetails.open}
        onRetry={() =>
          setAdminOverviewRequestKey((current) => current + 1)
        }
      />
      <AdminActiveProjects
        assignees={adminAssignees}
        assigneesLoading={adminAssigneesLoading}
        error={projectsError}
        loading={projectsLoading}
        projects={projectRows}
        onBulkAction={applyProjectBulkAction}
        onOpenProject={(project) => navigate(getProjectPath(project))}
        onProjectAssigneesChange={updateProjectAssignees}
        onRetry={() => setProjectsRequestKey((current) => current + 1)}
      />
      <NotificationsDrawer
        open={isNotificationsDrawerOpen}
        onClose={() => setIsNotificationsDrawerOpen(false)}
        onActivitySelect={handleActivitySelect}
      />
      <AdminRequestDetailsDrawer
        open={requestDetails.isOpen}
        status={requestDetails.status}
        details={requestDetails.details}
        client={requestDetails.client}
        queueError={requestDetails.queueError}
        onClose={requestDetails.close}
        onOpenWorkflow={requestDetails.openWorkflow}
        onRetryQueue={requestDetails.retryQueue}
      />
      <ProjectRequestWorkflowModal
        key={
          workflow.selectedRequest
            ? `${workflow.selectedRequest.id}-${workflow.initialAction || "default"}`
            : "closed-request-workflow"
        }
        error={workflow.error}
        initialAction={workflow.initialAction}
        mode="decision"
        open={Boolean(workflow.selectedRequest)}
        projectRequest={workflow.selectedRequest}
        submitting={workflow.submitting}
        onClose={workflow.close}
        onSubmit={workflow.submit}
      />
      <AdminRequestAssignmentModal
        open={Boolean(assignment.request)}
        assignees={adminAssignees}
        assigneesLoading={adminAssigneesLoading}
        selectedAssignees={assignment.draft}
        submitting={assignment.submitting}
        onSelectionChange={assignment.setDraft}
        onCancel={assignment.close}
        onConfirm={assignment.confirm}
      />
      <AdminRequestLoginAlert
        trigger={loginEventId || null}
        onAssign={loginActions.assign}
        onView={loginActions.view}
      />
      {assignment.feedback ? (
        <AlertToast
          trigger={assignment.feedback.id}
          theme={assignment.feedback.type === "error" ? "Danger" : "Success"}
          title={assignment.feedback.title}
          description={assignment.feedback.message}
          onDismiss={assignment.dismissFeedback}
          aria-label={assignment.feedback.title}
        />
      ) : null}
    </InternalDashboardLayout>
  );
}

export default AdminDashboard;
