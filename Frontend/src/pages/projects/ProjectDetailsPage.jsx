import { useCallback, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { useAuth } from "../../auth/AuthContext.jsx";
import { getUserDisplay } from "../../auth/userDisplay.js";
import NavigationBar from "../../components/EnvironmentNavigationBar.jsx";
import { useImageCommentNotifications } from "../../components/ui/Gallery/useImageComments.js";
import NotificationsDrawer from "../../components/EnvironmentNotificationsDrawer.jsx";
import Loader from "../../components/ui/Loader/Loader.jsx";
import TabPanel from "../../components/ui/TabPanel.jsx";
import ResponsiveSideNavigation from "../../components/ui/SideNavigation/ResponsiveSideNavigation.jsx";
import useMobileNavigationDrawer from "../../components/ui/SideNavigation/hooks/useMobileNavigationDrawer.js";
import { CLIENT_DRAWER_RECENT_ACTIVITY } from "../../data/clientDrawerData.js";
import ProjectDetailTabMenu from "./components/ProjectDetailTabMenu.jsx";
import ProjectOverviewHeader from "./components/ProjectOverviewHeader.jsx";
import ProjectActivePanel from "./components/ProjectActivePanel.jsx";
import { ProjectDocumentViewerModal } from "./components/ProjectDocumentPreview.jsx";
import { PROJECT_DETAIL_DATA } from "./projectDetailsData.js";
import useProjectDetailsData from "./hooks/useProjectDetailsData.js";
import useProjectDetailsComments from "./hooks/useProjectDetailsComments.js";
import useProjectDetailsNavigation from "./hooks/useProjectDetailsNavigation.js";
import useProjectDetailsTabs from "./hooks/useProjectDetailsTabs.js";
import {
  mergeNotificationComments,
  toDrawerComment,
  toProjectPresentation,
} from "./utils/projectDetailsPresentation.js";
import { getProjectPath } from "../../utils/projectRoutes.js";
import { getCommentNavigationParams } from "../../utils/commentSelection.js";
import {
  getProjectReadOnlyMessage,
  isProjectFinalized,
  isProjectOperationallyReadOnly,
} from "../../utils/projectReadOnly.js";
import Alert from "../../components/ui/Alert/Alert.jsx";
import { ProjectReadOnlyProvider } from "../../contexts/ProjectReadOnlyContext.jsx";
import { createUserSideNavigationItems } from "../../utils/sideNavigationItems.js";

const PROJECT_DETAIL_LOADER_SECTIONS = [
  "info",
  "renders",
  "documents",
  "tracking",
  "warranties",
  "upload",
];
export default function ProjectDetailsPage({
  project: providedProject = null,
  initialActiveProjectTabIndex = 0,
  infoProps,
  trackingProps,
  warrantiesProps,
}) {
  const navigate = useNavigate();
  const { projectId: routeProjectSlug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { logout, user } = useAuth();
  const currentUser = getUserDisplay(user);
  const mobileNavigation = useMobileNavigationDrawer();
  const [isNotificationsDrawerOpen, setIsNotificationsDrawerOpen] =
    useState(false);
  const [recentDocumentModal, setRecentDocumentModal] = useState(null);
  const recentDocumentTriggerRef = useRef(null);
  const {
    filesSynchronizedAt,
    project,
    projectError,
    projectLoading,
    refreshProjectFiles,
    resolvedProjectId,
  } = useProjectDetailsData({
    navigate,
    providedProject,
    routeProjectSlug,
    searchParams,
  });
  const {
    handleLogout,
    handleNewOpportunity,
    handleSideNavigationSelect,
    isSidebarExpanded,
    setIsSidebarExpanded,
  } = useProjectDetailsNavigation({
    currentUser,
    logout,
    navigate,
    project,
  });
  const {
    comments: projectComments,
    readError: projectCommentsError,
    loading: projectCommentsLoading,
    submitComment: handleSubmitComment,
  } = useProjectDetailsComments({
    isNotificationsDrawerOpen,
    project,
    resolvedProjectId,
  });
  const {
    activeProjectTabIndex,
    clearFocusedRenderComment,
    setActiveProjectTabIndex,
  } = useProjectDetailsTabs({
    initialActiveProjectTabIndex,
    searchParams,
    setSearchParams,
  });
  const imageCommentNotifications = useImageCommentNotifications({
    projectIds: resolvedProjectId ? [resolvedProjectId] : [],
    refreshIntervalMs: isNotificationsDrawerOpen ? 5000 : 15000,
  });
  const notificationComments = mergeNotificationComments([
    ...projectComments.map((comment) => toDrawerComment(comment, user, project?.files)),
    ...imageCommentNotifications,
  ]);

  const handleActivitySelect = (activity) => {
    if (!activity?.to) {
      return;
    }

    setIsNotificationsDrawerOpen(false);
    navigate(activity.to);
  };

  const openImageComment = (comment) => {
    const params = getCommentNavigationParams(comment);

    setIsNotificationsDrawerOpen(false);
    navigate(
      project
        ? getProjectPath(project, params.toString())
        : `/proyectos/${resolvedProjectId}?${params.toString()}`,
    );
  };

  const openRecentDocument = useCallback(
    (document, triggerElement) => {
      recentDocumentTriggerRef.current = triggerElement || null;
      setRecentDocumentModal(document);
    },
    [setRecentDocumentModal],
  );

  const presentedProject = project
    ? toProjectPresentation(project)
    : PROJECT_DETAIL_DATA;
  const projectIsFinalized = isProjectFinalized(presentedProject);
  const projectIsReadOnly = isProjectOperationallyReadOnly(presentedProject);
  const projectReadOnlyMessage = getProjectReadOnlyMessage(presentedProject);
  const activeProjectPanel = (
    <ProjectActivePanel
      activeProjectTabIndex={activeProjectTabIndex}
      clearFocusedRenderComment={clearFocusedRenderComment}
      filesSynchronizedAt={filesSynchronizedAt}
      infoProps={infoProps}
      openRecentDocument={openRecentDocument}
      presentedProject={presentedProject}
      refreshProjectFiles={refreshProjectFiles}
      resolvedProjectId={resolvedProjectId}
      searchParams={searchParams}
      trackingProps={trackingProps}
      warrantiesProps={warrantiesProps}
    />
  );

  return (
    <ProjectReadOnlyProvider
      readOnly={projectIsReadOnly}
      message={projectReadOnlyMessage}
    >
    <main className="min-h-screen bg-[var(--color-neutral-bg)] transition-colors duration-200">
      <div className="flex min-h-screen w-full items-stretch">
        <ResponsiveSideNavigation
          mobileOpen={mobileNavigation.isOpen}
          onMobileClose={mobileNavigation.close}
          activeItemId={
            currentUser.roleCode === "admin"
              ? "projects"
              : resolvedProjectId
                ? `project-${resolvedProjectId}`
                : undefined
          }
          expanded={isSidebarExpanded}
          items={createUserSideNavigationItems(
            project ? [project] : [],
            currentUser.roleCode,
          )}
          newOpportunityLabel={
            currentUser.roleCode === "client"
              ? "Nueva oportunidad"
              : "Nuevo proyecto"
          }
          userName={currentUser.name}
          userEmail={currentUser.email}
          userAvatarSrc={currentUser.profilePhotoUrl}
          onExpandedChange={setIsSidebarExpanded}
          onItemSelect={handleSideNavigationSelect}
          onNewOpportunityClick={handleNewOpportunity}
          onLogoutClick={handleLogout}
          className="min-h-screen shrink-0 self-stretch"
        />

        <div className="relative flex min-h-screen min-w-0 flex-1 flex-col self-stretch overflow-y-auto transition-[width] duration-300 ease-out">
          <NavigationBar
            utilityActionActive={isNotificationsDrawerOpen}
            onMenuClick={mobileNavigation.open}
            mobileMenuExpanded={mobileNavigation.isOpen}
            onUtilityActionClick={() =>
              setIsNotificationsDrawerOpen((current) => !current)
            }
          />

          <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-[24px] px-[8px] pb-[24px] pt-0 min-[480px]:px-[16px] min-[768px]:gap-[32px] min-[768px]:px-[24px] min-[1024px]:px-[32px] min-[1280px]:gap-[48px] min-[1280px]:px-[48px]">
            {projectLoading ? (
              <Loader
                preset="projectDetail"
                section={PROJECT_DETAIL_LOADER_SECTIONS[activeProjectTabIndex] || "info"}
                label="Cargando proyecto"
              />
            ) : projectError ? (
              <p className="py-[48px] text-body-3 text-[var(--color-danger-100)]">
                {projectError}
              </p>
            ) : (
              <>
                <ProjectOverviewHeader project={presentedProject} />
                {projectIsReadOnly ? (
                  <Alert
                    visible
                    theme="Warning"
                    layout="Box"
                    title={projectIsFinalized ? "Proyecto finalizado" : "Proyecto archivado"}
                    description={projectIsFinalized
                      ? "Puedes consultar, descargar, publicar o archivar su contenido, pero las operaciones del proyecto están cerradas."
                      : "Puedes consultar y descargar su contenido, pero debes desarchivarlo para realizar cambios."}
                    showActions={false}
                    showCloseButton={false}
                    aria-label={`Este proyecto está ${projectIsFinalized ? "finalizado" : "archivado"} y es de solo lectura`}
                  />
                ) : null}
                <ProjectDetailTabMenu
                  activeIndex={activeProjectTabIndex}
                  onChange={setActiveProjectTabIndex}
                />
                <TabPanel
                  transitionKey={`${presentedProject.id}-${activeProjectTabIndex}`}
                  className="w-full"
                >
                  {activeProjectPanel}
                </TabPanel>
              </>
            )}
          </div>

          <NotificationsDrawer
            open={isNotificationsDrawerOpen}
            onClose={() => setIsNotificationsDrawerOpen(false)}
            comments={notificationComments}
            commentsError={projectCommentsError}
            commentsLoading={projectCommentsLoading}
            recentActivity={CLIENT_DRAWER_RECENT_ACTIVITY}
            onActivitySelect={handleActivitySelect}
            onCommentSelect={openImageComment}
            onSubmitComment={projectIsReadOnly ? undefined : handleSubmitComment}
          />
          <ProjectDocumentViewerModal
            document={recentDocumentModal}
            onClose={() => setRecentDocumentModal(null)}
            open={Boolean(recentDocumentModal)}
            projectId={resolvedProjectId}
            triggerRef={recentDocumentTriggerRef}
          />
        </div>
      </div>
    </main>
    </ProjectReadOnlyProvider>
  );
}
