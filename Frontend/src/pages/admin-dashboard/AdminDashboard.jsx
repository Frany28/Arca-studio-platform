import { useMemo, useState } from "react";

import { api } from "../../api/http.js";
import { useAuth } from "../../auth/AuthContext.jsx";
import { getUserDisplay } from "../../auth/userDisplay.js";
import AlertToast from "../../components/ui/AlertToast/AlertToast.jsx";
import NotificationsDrawer from "../../components/EnvironmentNotificationsDrawer.jsx";
import { useDashboardNavigation } from "../../hooks/useDashboardNavigation.js";
import { useProjectRequestWorkflow } from "../../hooks/useProjectRequestWorkflow.js";
import InternalDashboardLayout from "../../layouts/InternalDashboardLayout.jsx";
import { getProjectPath } from "../../utils/projectRoutes.js";
import AdminDashboardHeader from "./components/AdminDashboardHeader.jsx";
import AdminDashboardMetrics from "./components/AdminDashboardMetrics.jsx";
import AdminDashboardOperations from "./components/AdminDashboardOperations.jsx";
import AdminDashboardOverview from "./components/AdminDashboardOverview.jsx";
import AdminActiveProjects from "./components/admin-active-projects/index.js";
import AdminRequestLoginAlert from "./components/AdminRequestLoginAlert.jsx";
import AdminRequestAssignmentModal from "./components/AdminRequestAssignmentModal.jsx";
import { useAdminDashboardData } from "./hooks/useAdminDashboardData.js";
import { useAdminRequestAssignments } from "./hooks/useAdminRequestAssignments.js";
import { submitAdminRequestDecision } from "./utils/adminRequestDecision.js";
import { useDashboardProjects } from "../architect-dashboard/hooks/useDashboardProjects.js";
import ProjectRequestWorkflowModal from "../architect-dashboard/components/ProjectRequestWorkflowModal.jsx";

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
  const upcomingDeliveries = useMemo(
    () =>
      [...projectRows]
        .filter(
          (project) =>
            !["archived", "completed", "cancelled"].includes(project.status),
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

  /**
   * Guarda responsables del proyecto y reconcilia todos los campos de asignación.
   * Los errores se propagan a los controles existentes para publicar su feedback.
   * @param {Object} project - Proyecto que se actualiza.
   * @param {Array} assignees - Responsables seleccionados.
   * @returns {Promise<void>} Completa el guardado y su actualización local.
   * @throws {Error} Propaga fallos de la API administrativa.
   */
  const handleProjectAssigneesChange = async (project, assignees) => {
    const data = await api.admin.updateProjectAssignees({
      assigneeIds: assignees.map((assignee) => Number(assignee.id)),
      projectId: project.id,
    });

    setProjects((currentProjects) =>
      currentProjects.map((currentProject) =>
        currentProject.id === project.id
          ? {
              ...currentProject,
              assignees: data.assignees || [],
              assignedArchitect: data.assignees?.[0] || null,
              assignedArchitects: data.assignees || [],
            }
          : currentProject,
      ),
    );
  };

  /**
   * Aplica una acción masiva sobre los IDs del snapshot de proyectos seleccionados.
   * Reconcilia los resultados locales y conserva el refresco de métricas y overview.
   * @param {Object} params - Acción y proyectos originales seleccionados por la tabla.
   * @returns {Promise<Object>} Resultado devuelto por la API administrativa.
   * @throws {Error} Propaga fallos al feedback de la tabla.
   */
  const handleProjectBulkAction = async ({ action, projects: selectedProjects }) => {
    const isPublic = action === "change_visibility"
      ? !selectedProjects.every((project) => project.isPublic)
      : undefined;
    const data = await api.admin.updateProjects({
      action,
      isPublic,
      projectIds: selectedProjects.map((project) => Number(project.id)),
    });
    const updatedProjects = new Map(
      (data.projects || []).map((project) => [Number(project.id), project]),
    );

    setProjects((currentProjects) =>
      currentProjects.map((project) => {
        const updatedProject = updatedProjects.get(Number(project.id));
        return updatedProject ? { ...project, ...updatedProject } : project;
      }),
    );
    setAdminMetricsRequestKey((current) => current + 1);
    setAdminOverviewRequestKey((current) => current + 1);

    return data;
  };

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
        onRequestOpen={workflow.open}
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
        onBulkAction={handleProjectBulkAction}
        onOpenProject={(project) => navigate(getProjectPath(project))}
        onProjectAssigneesChange={handleProjectAssigneesChange}
        onRetry={() => setProjectsRequestKey((current) => current + 1)}
      />
      <NotificationsDrawer
        open={isNotificationsDrawerOpen}
        onClose={() => setIsNotificationsDrawerOpen(false)}
        onActivitySelect={handleActivitySelect}
      />
      <ProjectRequestWorkflowModal
        key={workflow.selectedRequest?.id || "closed-request-workflow"}
        error={workflow.error}
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
