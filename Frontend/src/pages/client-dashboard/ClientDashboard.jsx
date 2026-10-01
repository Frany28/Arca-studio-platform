import { useSidebarViewportSync } from "../../hooks/useSidebarViewportSync.js";
import { useClientNotifications } from "./hooks/useClientNotifications.js";
import { useClientRequests } from "./hooks/useClientRequests.js";
import { useClientProjects } from "./hooks/useClientProjects.js";
import { TABLET_BREAKPOINT_PX, REQUEST_SKELETON_COUNT } from "./clientDashboardConfig.js";
import { useSyncedScrollBar } from "./hooks/useSyncedScrollBar.js";
import { ProjectStatusGroup } from "./components/ProjectStatusGroup.jsx";
import { ProjectRequestRow } from "./components/ProjectRequestRow.jsx";
import NavigationBar from "../../components/EnvironmentNavigationBar.jsx";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext.jsx";
import { getUserDisplay } from "../../auth/userDisplay.js";
import Badge from "../../components/ui/Badge/Badge.jsx";
import AuthToast, { AuthToastLockIcon } from "../../components/ui/AuthToast/AuthToast.jsx";
import Button from "../../components/ui/Button/Button.jsx";
import EmptyState from "../../components/ui/EmptyState.jsx";
import Loader from "../../components/ui/Loader/Loader.jsx";
import NotificationsDrawer from "../../components/EnvironmentNotificationsDrawer.jsx";
import ProjectsShowcaseCarousel from "../../components/ui/ProjectsShowcaseCarousel.jsx";
import ScrollBar from "../../components/ui/ScrollBar/ScrollBar.jsx";
import SideNavigation from "../../components/ui/SideNavigation/SideNavigation.jsx";
import SideOverlayDrawer from "../../components/ui/SideOverlayDrawer.jsx";
import { getProjectPath } from "../../utils/projectRoutes.js";
import { getCommentNavigationParams } from "../../utils/commentSelection.js";
import { createUserSideNavigationItems } from "../../utils/sideNavigationItems.js";
import { CLIENT_DRAWER_RECENT_ACTIVITY } from "../clientDrawerData.js";

function ClientDashboard({ view = "dashboard" }) {
  const isRequestsView = view === "requests";
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const currentUser = getUserDisplay(user);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false);
  const [isNotificationsDrawerOpen, setIsNotificationsDrawerOpen] =
    useState(false);
  const {
    projectRequests,
    projectRequestsError,
    projectRequestsLoading,
    projectRequestsLoadingMore,
    projectRequestsNextCursor,
    setProjectRequestsRevision,
    loadMoreProjectRequests,
  } = useClientRequests({ user });

  const {
    projectsError,
    projectsLoading,
    ownedProjectRows,
    commentProjectRows,
    publicProjectRows,
    projectGroups,
    loadProjects,
  } = useClientProjects({ user });

  const [registrationToast] = useState(() => {
    try {
      if (window.sessionStorage.getItem("arca_registration_complete") === "true") {
        window.sessionStorage.removeItem("arca_registration_complete");
        return Date.now();
      }
    } catch {
      // The dashboard remains usable when session storage is unavailable.
    }
    return null;
  });

  const {
    containerRef: projectsContainerRef,
    length: projectScrollLength,
    onScroll: handleProjectScroll,
    position: projectScrollPosition,
    setPosition: setProjectScrollPosition,
  } = useSyncedScrollBar(
    projectGroups.map((group) => `${group.id}:${group.projects.length}`).join("|"),
  );
  const {
    containerRef: requestsContainerRef,
    length: requestScrollLength,
    onScroll: handleRequestScroll,
    position: requestScrollPosition,
    setPosition: setRequestScrollPosition,
  } = useSyncedScrollBar(
    `${view}:${projectRequests.map((request) => request.id).join("|")}`,
  );
  const navigationItems = useMemo(
    () => createUserSideNavigationItems(ownedProjectRows, "client"),
    [ownedProjectRows],
  );
  const {
    commentsProjectId,
    submitComment,
    drawerCommentsError,
    drawerCommentsLoading,
    notificationComments,
  } = useClientNotifications({ user, isNotificationsDrawerOpen, commentProjectRows });

  useSidebarViewportSync({ breakpoint: TABLET_BREAKPOINT_PX, setIsSidebarExpanded });

  const handleSideNavigationSelect = (item) => {
    if (item?.to) {
      navigate(item.to);
      return;
    }

    if (item?.id === "dashboard") {
      navigate("/dashboard-clientes");
      return;
    }

    if (item?.id?.startsWith("project-")) {
      const projectId = Number(item.id.replace("project-", ""));

      if (Number.isInteger(projectId)) {
        const selectedProject = ownedProjectRows.find(
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

    if (item?.id === "requests") {
      navigate("/solicitudes");
      return;
    }

    if (item?.id === "settings") {
      navigate("/configuraciones");
    }
  };

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
    const targetProjectId = comment?.projectId || commentsProjectId;

    if (targetProjectId) {
      const targetProject = ownedProjectRows.find(
        (project) => project.id === Number(targetProjectId),
      );

      navigate(
        targetProject
          ? getProjectPath(targetProject, params.toString())
          : `/proyectos/${targetProjectId}?${params.toString()}`,
      );
    }
  };

  return (
    <main className="min-h-screen bg-[var(--color-neutral-bg)] transition-colors duration-200">
      <AuthToast
        trigger={registrationToast}
        title="Cuenta creada"
        description="Tu correo fue verificado y tu cuenta está lista."
        leading={<AuthToastLockIcon />}
      />
      <div className="flex min-h-screen w-full items-stretch">
        <SideNavigation
          activeItemId={isRequestsView ? "requests" : "dashboard"}
          expanded={isSidebarExpanded}
          items={navigationItems}
          userName={currentUser.name}
          userEmail={currentUser.email}
          userAvatarSrc={currentUser.profilePhotoUrl}
          onExpandedChange={setIsSidebarExpanded}
          onItemSelect={handleSideNavigationSelect}
          onNewOpportunityClick={() => navigate("/solicitudes/nueva")}
          onLogoutClick={() => {
            logout();
            navigate("/");
          }}
          className="min-h-screen shrink-0 self-stretch max-[767px]:hidden min-[768px]:max-[1023px]:!w-[234px] min-[768px]:max-[1023px]:!px-[12px]"
        />

        <div className="relative flex min-h-screen min-w-0 flex-1 flex-col self-stretch overflow-y-auto transition-[width] duration-300 ease-out">
          <NavigationBar
            onMenuClick={() => setIsMobileNavigationOpen(true)}
            utilityActionActive={isNotificationsDrawerOpen}
            onUtilityActionClick={() =>
              setIsNotificationsDrawerOpen((current) => !current)
            }
          />

          <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-[12px] px-[16px] py-[16px] min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between sm:px-[24px] lg:px-[48px]">
            <p className="text-heading-6 w-full text-[var(--color-text-300)]">
              Bienvenido, {currentUser.shortName}
            </p>
            {isRequestsView ? (
              <Button
                theme="Primary"
                type="Solid"
                size="M"
                fitContent
                showLeftIcon={false}
                showRightIcon={false}
                className="w-full shrink-0 min-[480px]:w-auto"
                onClick={() => navigate("/solicitudes/nueva")}
              >
                Nueva oportunidad
              </Button>
            ) : null}
          </div>

          {!isRequestsView ? (
          <div className="mx-auto flex w-full max-w-[1200px] items-start gap-[4px] px-[16px] pb-[48px] sm:px-[24px] lg:px-[48px]">
            <div
              ref={projectsContainerRef}
              className="max-h-none flex-1 overflow-y-visible pr-[2px] [scrollbar-width:none] [-ms-overflow-style:none] lg:max-h-[232px] lg:overflow-y-auto [&::-webkit-scrollbar]:hidden"
              onScroll={handleProjectScroll}
            >
              {projectsLoading ? (
                <Loader
                  preset="projectRow"
                  count={3}
                  label="Cargando proyectos"
                  className="min-h-[232px] py-[24px]"
                />
              ) : projectsError ? (
                <p className="text-body-3 py-[24px] text-[var(--color-danger-100)]">
                  {projectsError}
                </p>
              ) : projectGroups.length ? (
                <div className="content-reveal flex flex-col gap-[24px]">
                  {projectGroups.map((group) => (
                    <ProjectStatusGroup key={group.id} group={group} />
                  ))}
                </div>
              ) : (
                <p className="text-body-3 py-[24px] text-[var(--color-text-200)]">
                  No tienes proyectos asignados.
                </p>
              )}
            </div>

            {!projectsLoading ? (
              <ScrollBar
                height={232}
                length={projectScrollLength}
                position={projectScrollPosition}
                interactive
                onPositionChange={setProjectScrollPosition}
                className="hidden shrink-0 lg:block"
              />
            ) : null}
          </div>
          ) : null}

          <section className="mx-auto flex w-full max-w-[1200px] flex-col px-[16px] pb-[48px] sm:px-[24px] lg:px-[48px]">
            <div className="flex items-center pb-[4px]">
              <Badge
                label="Solicitudes"
                theme="Brand 1"
                variation="Simple"
                size="S"
              />
            </div>

            <div className="flex w-full items-start gap-[4px]">
              <div
                ref={requestsContainerRef}
                onScroll={handleRequestScroll}
                className="min-w-0 flex-1 overflow-y-visible pr-[2px] [scrollbar-width:none] [-ms-overflow-style:none] lg:max-h-[232px] lg:overflow-y-auto [&::-webkit-scrollbar]:hidden"
              >
                {projectRequestsLoading ? (
                    <Loader
                      preset="requestRow"
                      count={REQUEST_SKELETON_COUNT}
                      label="Cargando solicitudes"
                    />
                  ) : projectRequestsError && !projectRequests.length ? (
                    <EmptyState
                      className="min-h-[320px]"
                      title="No pudimos cargar tus solicitudes"
                      description={projectRequestsError}
                      size="M"
                      showFeaturedIcon
                      showActions
                      showSecondaryAction={false}
                      primaryActionLabel="Actualizar"
                      onPrimaryAction={() =>
                        setProjectRequestsRevision((current) => current + 1)
                      }
                    />
                  ) : projectRequests.length ? (
                    <div className="content-reveal flex flex-col">
                      <div>
                        {projectRequests.map((projectRequest) => (
                          <ProjectRequestRow
                            key={projectRequest.id}
                            projectRequest={projectRequest}
                            onReview={(request) => {
                              if (request.status === "converted" && request.convertedProjectId) {
                                navigate(`/proyectos/${request.convertedProjectId}`);
                                return;
                              }
                              if (["changes_requested", "rejected"].includes(request.status)) {
                                navigate("/solicitudes/nueva", {
                                  state: { initialRequest: request },
                                });
                                return;
                              }
                              navigate("/solicitudes/nueva", {
                                state: { viewRequest: request },
                              });
                            }}
                          />
                        ))}
                      </div>
                      {projectRequestsNextCursor ? (
                        <Button
                          theme="Primary"
                          type="Outline"
                          size="M"
                          fitContent
                          showLeftIcon={false}
                          showRightIcon={false}
                          disabled={projectRequestsLoadingMore}
                          className="mt-[16px] self-center"
                          onClick={loadMoreProjectRequests}
                        >
                          {projectRequestsLoadingMore
                            ? "Cargando..."
                            : "Cargar más"}
                        </Button>
                      ) : null}
                      {projectRequestsError ? (
                        <p className="text-body-3 mt-[12px] text-center text-[var(--color-danger-100)]">
                          {projectRequestsError}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <EmptyState
                      className="min-h-[320px]"
                      title="Tu espacio de proyectos está listo"
                      description="Aquí podrás visualizar y dar seguimiento a tus proyectos."
                      size="M"
                      showFeaturedIcon
                      showActions
                      showSecondaryAction={false}
                      primaryActionLabel="Nueva oportunidad"
                      onPrimaryAction={() => navigate("/solicitudes/nueva")}
                    />
                )}
              </div>
              {!projectRequestsLoading && projectRequests.length ? (
                <ScrollBar
                  height={232}
                  length={requestScrollLength}
                  position={requestScrollPosition}
                  interactive
                  onPositionChange={setRequestScrollPosition}
                  className="hidden shrink-0 lg:block"
                />
              ) : null}
            </div>
          </section>

          <div className="mx-auto flex w-full max-w-[1200px] px-[16px] pb-[24px] sm:px-[24px] lg:px-[48px]">
            {projectsLoading ? (
              <section className="flex w-full min-w-0 flex-col gap-[16px]">
                <h2 className="text-heading-4 text-[var(--color-text-100)]">
                  Ver más proyectos
                </h2>
                <Loader
                  preset="projectShowcase"
                  label="Cargando más proyectos"
                />
              </section>
            ) : projectsError ? (
              <section className="flex w-full min-w-0 flex-col gap-[16px]">
                <h2 className="text-heading-4 text-[var(--color-text-100)]">
                  Ver más proyectos
                </h2>
                <EmptyState
                  title="No pudimos cargar los proyectos"
                  description={projectsError}
                  size="M"
                  showFeaturedIcon
                  showActions
                  showSecondaryAction={false}
                  primaryActionLabel="Actualizar"
                  onPrimaryAction={loadProjects}
                />
              </section>
            ) : publicProjectRows.length ? (
              <ProjectsShowcaseCarousel
                title="Ver más proyectos"
                items={publicProjectRows}
              />
            ) : (
              <section className="flex w-full min-w-0 flex-col gap-[16px]">
                <h2 className="text-heading-4 text-[var(--color-text-100)]">
                  Ver más proyectos
                </h2>
                <EmptyState
                  title="No se encontraron proyectos"
                  description="Aquí podrás visualizar otros proyectos que pueden interesarte."
                  size="M"
                  showFeaturedIcon
                  showActions
                  showSecondaryAction={false}
                  primaryActionLabel="Actualizar"
                  onPrimaryAction={loadProjects}
                />
              </section>
            )}
          </div>

          <NotificationsDrawer
            open={isNotificationsDrawerOpen}
            onClose={() => setIsNotificationsDrawerOpen(false)}
            comments={notificationComments}
            commentsError={drawerCommentsError}
            commentsLoading={drawerCommentsLoading}
            recentActivity={CLIENT_DRAWER_RECENT_ACTIVITY}
            onActivitySelect={handleActivitySelect}
            onCommentSelect={openImageComment}
            onSubmitComment={commentsProjectId ? submitComment : undefined}
          />
        </div>
      </div>

      <SideOverlayDrawer
        open={isMobileNavigationOpen}
        onClose={() => setIsMobileNavigationOpen(false)}
        side="left"
        widthClassName="w-[min(312px,calc(100vw-32px))]"
        className="z-[80] min-[768px]:hidden"
        panelClassName="rounded-none"
      >
        <SideNavigation
          activeItemId={isRequestsView ? "requests" : "dashboard"}
          expanded
          items={navigationItems}
          userName={currentUser.name}
          userEmail={currentUser.email}
          userAvatarSrc={currentUser.profilePhotoUrl}
          onItemSelect={(item) => {
            setIsMobileNavigationOpen(false);
            handleSideNavigationSelect(item);
          }}
          onNewOpportunityClick={() => {
            setIsMobileNavigationOpen(false);
            navigate("/solicitudes/nueva");
          }}
          onLogoutClick={() => {
            logout();
            navigate("/");
          }}
          onExpandedChange={(expanded) => {
            if (!expanded) setIsMobileNavigationOpen(false);
          }}
          className="!h-full !min-h-full !w-full border-r-0 shadow-none"
        />
      </SideOverlayDrawer>
    </main>
  );
}

export default ClientDashboard;