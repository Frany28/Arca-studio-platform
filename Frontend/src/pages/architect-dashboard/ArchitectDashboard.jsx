import { useSidebarViewportSync } from "../../hooks/useSidebarViewportSync.js";
import { useAdminProjectBulkActions } from "./hooks/useAdminProjectBulkActions.js";
import { useProjectRequestWorkflow } from "./hooks/useProjectRequestWorkflow.js";
import { useArchitectNotifications } from "./hooks/useArchitectNotifications.js";
import { useProjectReviewQueue } from "./hooks/useProjectReviewQueue.js";
import { useAdminAssignees } from "./hooks/useAdminAssignees.js";
import { useAdminDashboardOverview } from "./hooks/useAdminDashboardOverview.js";
import { useAdminDashboardMetrics } from "./hooks/useAdminDashboardMetrics.js";
import { useArchitectProjects } from "./hooks/useArchitectProjects.js";
import { WEB_BREAKPOINT_PX } from "./architectDashboardConfig.js";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext.jsx";
import { getUserDisplay } from "../../auth/userDisplay.js";
import NavigationBar from "../../components/EnvironmentNavigationBar.jsx";
import EmptyState from "../../components/ui/EmptyState/EmptyState.jsx";
import AlertToast from "../../components/ui/AlertToast/AlertToast.jsx";
import Loader from "../../components/ui/Loader/Loader.jsx";
import NotificationsDrawer from "../../components/EnvironmentNotificationsDrawer.jsx";
import SideNavigation from "../../components/ui/SideNavigation/SideNavigation.jsx";
import { getProjectPath } from "../../utils/projectRoutes.js";
import { getCommentNavigationParams } from "../../utils/commentSelection.js";
import { createUserSideNavigationItems } from "../../utils/sideNavigationItems.js";
import { ARCHITECT_DRAWER_RECENT_ACTIVITY } from "./architectDashboardData.js";
import AdminDashboardHeader from "./components/AdminDashboardHeader.jsx";
import AdminDashboardMetrics from "./components/AdminDashboardMetrics.jsx";
import AdminDashboardOperations from "./components/AdminDashboardOperations.jsx";
import AdminDashboardOverview from "./components/AdminDashboardOverview.jsx";
import AdminActiveProjects from "./components/AdminActiveProjects.jsx";
import AdminRequestLoginAlert from "./components/AdminRequestLoginAlert.jsx";
import AdminRequestAssignmentModal from "./components/AdminRequestAssignmentModal.jsx";
import ArchitectProjectGroup from "./components/ArchitectProjectGroup.jsx";
import ProjectRequestReviewQueue from "./components/ProjectRequestReviewQueue.jsx";
import ProjectRequestWorkflowModal from "./components/ProjectRequestWorkflowModal.jsx";

function ArchitectDashboard({ empty = false }) {
  const navigate = useNavigate();
  const { loginEventId, logout, user } = useAuth();
  const currentUser = getUserDisplay(user);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth >= WEB_BREAKPOINT_PX,
  );
  const [isNotificationsDrawerOpen, setIsNotificationsDrawerOpen] =
    useState(false);
  const {
    setProjects,
    projectsError,
    projectsLoading,
    setProjectsRequestKey,
    projectRows,
    commentProjectRows,
    projectGroups,
    upcomingDeliveries,
    handlePublicationChange,
    handleProjectAssigneesChange,
  } = useArchitectProjects({ empty, user, currentUser });

  const {
    adminMetrics,
    adminMetricsError,
    adminMetricsLoading,
    setAdminMetricsRequestKey,
  } = useAdminDashboardMetrics({ empty, currentUser });

  const {
    adminOverview,
    setAdminOverview,
    adminOverviewError,
    adminOverviewLoading,
    setAdminOverviewRequestKey,
  } = useAdminDashboardOverview({ empty, user, currentUser });

  const { adminAssignees, adminAssigneesLoading } = useAdminAssignees({ empty, currentUser });

  const {
    reviewRequests,
    reviewRequestsError,
    reviewRequestsLoading,
    setReviewRequestsRevision,
  } = useProjectReviewQueue({ empty, currentUser });

  const {
    selectedRequest,
    setSelectedRequest,
    workflowError,
    workflowSubmitting,
    assignmentModalRequest,
    assignmentDraft,
    setAssignmentDraft,
    assignmentSubmitting,
    assignmentFeedback,
    setAssignmentFeedback,
    handleRequestAssigneesChange,
    openRequestWorkflow,
    handleLoginNotificationAssign,
    handleLoginNotificationView,
    closeAssignmentModal,
    confirmRequestAssignment,
    submitRequestWorkflow,
  } = useProjectRequestWorkflow({
    currentUser,
    setProjectsRequestKey,
    setAdminMetricsRequestKey,
    adminOverview,
    setAdminOverview,
    setAdminOverviewRequestKey,
    reviewRequests,
    setReviewRequestsRevision,
  });

  const canManagePublication =
    user?.permissionCodes?.includes("projects.publish");

  const navigationItems = useMemo(
    () => createUserSideNavigationItems(projectRows, currentUser.roleCode),
    [currentUser.roleCode, projectRows],
  );
  const {
    commentsProjectId,
    submitComment,
    drawerCommentsError,
    drawerCommentsLoading,
    notificationComments,
  } = useArchitectNotifications({ user, isNotificationsDrawerOpen, commentProjectRows });

  useSidebarViewportSync({ breakpoint: WEB_BREAKPOINT_PX, setIsSidebarExpanded });

  const handleSideNavigationSelect = (item) => {
    if (item?.to) {
      navigate(item.to);
      return;
    }

    if (item?.id === "dashboard") {
      navigate("/dashboard-arquitecto");
      return;
    }

    if (item?.id?.startsWith("project-")) {
      const projectId = Number(item.id.replace("project-", ""));

      if (Number.isInteger(projectId)) {
        const selectedProject = projectRows.find(
          (project) => project.id === projectId,
        );

        navigate(
          selectedProject ? getProjectPath(selectedProject) : `/proyectos/${projectId}`,
        );
      }
      return;
    }

    if (item?.id === "more-projects") {
      navigate("/proyectos");
      return;
    }

    if (item?.id === "settings") {
      navigate("/configuraciones");
    }
  };

  const handleActivitySelect = (activity) => {
    const targetProject = activity?.projectId
      ? projectRows.find(
          (project) => Number(project.id) === Number(activity.projectId),
        )
      : null;
    const targetPath = activity?.to ||
      (targetProject ? getProjectPath(targetProject) : null);

    if (!targetPath) return;

    setIsNotificationsDrawerOpen(false);
    navigate(targetPath);
  };

  const handleNotificationsToggle = () => {
    const willOpen = !isNotificationsDrawerOpen;

    setIsNotificationsDrawerOpen(willOpen);

    if (willOpen && currentUser.roleCode === "admin") {
      setAdminOverviewRequestKey((current) => current + 1);
    }
  };

  const openImageComment = (comment) => {
    const params = getCommentNavigationParams(comment);

    setIsNotificationsDrawerOpen(false);
    const targetProjectId = comment?.projectId || commentProjectRows[0]?.id;

    if (targetProjectId) {
      const targetProject = projectRows.find(
        (project) => project.id === Number(targetProjectId),
      );

      navigate(
        targetProject
          ? getProjectPath(targetProject, params.toString())
          : `/proyectos/${targetProjectId}?${params.toString()}`,
      );
    }
  };

  const { handleProjectBulkAction } = useAdminProjectBulkActions({ setProjects, setAdminMetricsRequestKey, setAdminOverviewRequestKey });

  return (
    <main className="h-screen overflow-hidden bg-[var(--color-neutral-bg)] transition-colors duration-200">
      <div className="flex h-full min-h-0 w-full items-stretch">
        <SideNavigation
          activeItemId="dashboard"
          expanded={isSidebarExpanded}
          items={navigationItems}
          newOpportunityLabel="Nuevo proyecto"
          userName={currentUser.name}
          userEmail={currentUser.email}
          userAvatarSrc={currentUser.profilePhotoUrl}
          onExpandedChange={(nextExpanded) => {
            if (window.innerWidth >= WEB_BREAKPOINT_PX) {
              setIsSidebarExpanded(nextExpanded);
            }
          }}
          onItemSelect={handleSideNavigationSelect}
          onNewOpportunityClick={() =>
            navigate("/dashboard-arquitecto/nuevo-proyecto")
          }
          onLogoutClick={() => {
            logout();
            navigate("/");
          }}
          className="h-screen shrink-0 self-stretch"
        />

        <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col self-stretch overflow-y-auto overflow-x-hidden transition-[width] duration-300 ease-out">
          <NavigationBar
            utilityActionActive={isNotificationsDrawerOpen}
            onUtilityActionClick={handleNotificationsToggle}
          />

          <div className="mx-auto flex w-full max-w-[1200px] px-[16px] pb-[16px] sm:px-[24px] lg:px-[48px]">
            <p className="text-heading-6 w-full text-[var(--color-text-300)]">
              Bienvenido, {currentUser.shortName}
            </p>
          </div>

          {currentUser.roleCode === "admin" ? (
            <>
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
                onRequestAssigneesChange={handleRequestAssigneesChange}
                onRequestOpen={openRequestWorkflow}
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
            </>
          ) : null}

          {currentUser.roleCode === "architect" ? (
            <ProjectRequestReviewQueue
              error={reviewRequestsError}
              loading={reviewRequestsLoading}
              requests={reviewRequests}
              onOpen={openRequestWorkflow}
              onRetry={() => setReviewRequestsRevision((current) => current + 1)}
            />
          ) : null}

          {currentUser.roleCode !== "admin" && projectsLoading ? (
            <div className="mx-auto flex min-h-[360px] w-full max-w-[1200px] px-[16px] pb-[48px] sm:px-[24px] lg:px-[48px]">
              <Loader
                preset="projectRow"
                count={3}
                label="Cargando proyectos"
              />
            </div>
          ) : currentUser.roleCode !== "admin" && projectsError ? (
            <div className="mx-auto flex w-full max-w-[1200px] px-[16px] pb-[48px] sm:px-[24px] lg:px-[48px]">
              <p className="text-body-3 text-[var(--color-danger-100)]">
                {projectsError}
              </p>
            </div>
          ) : currentUser.roleCode !== "admin" && (empty || !projectRows.length) ? (
            <div className="mx-auto flex w-full max-w-[1200px] flex-1 items-center justify-center px-[16px] pb-[48px] sm:px-[24px] lg:px-[48px]">
              <EmptyState
                title="Tu espacio de proyectos está listo"
                description="Aquí podrás visualizar y dar seguimiento a tus proyectos."
                secondaryActionLabel="Añadir"
                primaryActionLabel="Actualizar"
                size="S"
                showFeaturedIcon
                showActions
                showSecondaryAction
                className="max-w-[360px]"
              />
            </div>
          ) : currentUser.roleCode !== "admin" ? (
            <div className="content-reveal mx-auto flex w-full max-w-[1200px] flex-col gap-[48px] px-[16px] pb-[48px] sm:px-[24px] lg:px-[48px]">
              {projectGroups.map((group) => (
                <ArchitectProjectGroup
                  key={group.id}
                  canManagePublication={canManagePublication}
                  group={group}
                  onPublicationChange={handlePublicationChange}
                />
              ))}
            </div>
          ) : null}

          <NotificationsDrawer
            open={isNotificationsDrawerOpen}
            onClose={() => setIsNotificationsDrawerOpen(false)}
            comments={notificationComments}
            commentsError={drawerCommentsError}
            commentsLoading={drawerCommentsLoading}
            recentActivity={ARCHITECT_DRAWER_RECENT_ACTIVITY}
            onActivitySelect={handleActivitySelect}
            onCommentSelect={openImageComment}
            onSubmitComment={commentsProjectId ? submitComment : undefined}
          />
          <ProjectRequestWorkflowModal
            key={selectedRequest?.id || "closed-request-workflow"}
            error={workflowError}
            mode={currentUser.roleCode === "admin" ? "decision" : "review"}
            open={Boolean(selectedRequest)}
            projectRequest={selectedRequest}
            submitting={workflowSubmitting}
            onClose={() => {
              if (!workflowSubmitting) setSelectedRequest(null);
            }}
            onSubmit={submitRequestWorkflow}
          />
          <AdminRequestAssignmentModal
            open={Boolean(assignmentModalRequest)}
            assignees={adminAssignees}
            assigneesLoading={adminAssigneesLoading}
            selectedAssignees={assignmentDraft}
            submitting={assignmentSubmitting}
            onSelectionChange={setAssignmentDraft}
            onCancel={closeAssignmentModal}
            onConfirm={confirmRequestAssignment}
          />
          {currentUser.roleCode === "admin" ? (
            <AdminRequestLoginAlert
              trigger={loginEventId || null}
              onAssign={handleLoginNotificationAssign}
              onView={handleLoginNotificationView}
            />
          ) : null}
          {assignmentFeedback ? (
            <AlertToast
              trigger={assignmentFeedback.id}
              theme={assignmentFeedback.type === "error" ? "Danger" : "Success"}
              title={assignmentFeedback.title}
              description={assignmentFeedback.message}
              onDismiss={() => setAssignmentFeedback(null)}
              aria-label={assignmentFeedback.title}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}

export default ArchitectDashboard;
