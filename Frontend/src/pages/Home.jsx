import NavigationBar from "../components/EnvironmentNavigationBar.jsx";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";

import { useAuth } from "../auth/AuthContext.jsx";
import { getUserDisplay } from "../auth/userDisplay.js";
import AuthToast, { AuthToastLockIcon } from "../components/ui/AuthToast/AuthToast.jsx";
import Button from "../components/ui/Button/Button.jsx";
import NotificationsDrawer from "../components/EnvironmentNotificationsDrawer.jsx";
import SideNavigation from "../components/ui/SideNavigation/SideNavigation.jsx";
import SideOverlayDrawer from "../components/ui/SideOverlayDrawer.jsx";
import { CLIENT_DRAWER_RECENT_ACTIVITY } from "./clientDrawerData.js";
import useHomeProjectRequests from "./home/hooks/useHomeProjectRequests.js";
import useHomeProjects from "./home/hooks/useHomeProjects.js";
import useHomeNotifications from "./home/hooks/useHomeNotifications.js";
import useHomeNavigation from "./home/hooks/useHomeNavigation.js";
import useSyncedScrollBar from "./home/hooks/useSyncedScrollBar.js";
import {
  HomeProjectsSection,
  HomePublicProjectsSection,
  HomeRequestsSection,
} from "./home/components/HomeContentSections.jsx";

const EXPANDED_SIDEBAR_WIDTH = 312;
const COLLAPSED_SIDEBAR_WIDTH = 76;

function Home({ view = "dashboard" }) {
  const isRequestsView = view === "requests";
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const currentUser = getUserDisplay(user);
  const {
    loadMoreProjectRequests,
    projectRequests,
    projectRequestsError,
    projectRequestsLoading,
    projectRequestsLoadingMore,
    projectRequestsNextCursor,
    retryProjectRequests,
  } = useHomeProjectRequests({ user });
  const {
    commentProjectRows,
    loadProjects,
    ownedProjectRows,
    projectGroups,
    projectsError,
    projectsLoading,
    publicProjectRows,
  } = useHomeProjects({ user });
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
  const {
    closeMobileNavigation,
    handleLogout,
    handleMobileExpandedChange,
    handleMobileNavigationSelect,
    handleMobileNewOpportunity,
    handleNewOpportunity,
    handleSideNavigationSelect,
    isMobileNavigationOpen,
    isSidebarExpanded,
    navigationItems,
    openMobileNavigation,
    setIsSidebarExpanded,
  } = useHomeNavigation({
    logout,
    navigate,
    ownedProjectRows,
  });
  const {
    close: closeNotifications,
    comments: notificationComments,
    commentsProjectId,
    error: drawerCommentsError,
    isOpen: isNotificationsDrawerOpen,
    loading: drawerCommentsLoading,
    openActivity: handleActivitySelect,
    openComment: openImageComment,
    submitComment,
    toggle: toggleNotifications,
  } = useHomeNotifications({
    commentProjectRows,
    navigate,
    ownedProjectRows,
    user,
  });
  const handleReviewRequest = (request) => {
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
  };

  const handleNewRequest = () => {
    navigate("/solicitudes/nueva");
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
          onNewOpportunityClick={handleNewOpportunity}
          onLogoutClick={handleLogout}
          className={clsx(
            "min-h-screen shrink-0 self-stretch max-[767px]:hidden min-[768px]:max-[1023px]:!px-[12px]",
            isSidebarExpanded && "min-[768px]:max-[1023px]:!w-[234px]",
          )}
        />

        <div className="relative flex min-h-screen min-w-0 flex-1 flex-col self-stretch overflow-y-auto transition-[width] duration-300 ease-out">
          <NavigationBar
            onMenuClick={openMobileNavigation}
            utilityActionActive={isNotificationsDrawerOpen}
            onUtilityActionClick={toggleNotifications}
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
            <HomeProjectsSection
              projectGroups={projectGroups}
              projectsContainerRef={projectsContainerRef}
              projectsError={projectsError}
              projectsLoading={projectsLoading}
              handleProjectScroll={handleProjectScroll}
              projectScrollLength={projectScrollLength}
              projectScrollPosition={projectScrollPosition}
              setProjectScrollPosition={setProjectScrollPosition}
            />
          ) : null}

          <HomeRequestsSection
            handleRequestScroll={handleRequestScroll}
            loadMoreProjectRequests={loadMoreProjectRequests}
            onNewOpportunity={handleNewRequest}
            onReviewRequest={handleReviewRequest}
            projectRequests={projectRequests}
            projectRequestsError={projectRequestsError}
            projectRequestsLoading={projectRequestsLoading}
            projectRequestsLoadingMore={projectRequestsLoadingMore}
            projectRequestsNextCursor={projectRequestsNextCursor}
            requestScrollLength={requestScrollLength}
            requestScrollPosition={requestScrollPosition}
            requestsContainerRef={requestsContainerRef}
            retryProjectRequests={retryProjectRequests}
            setRequestScrollPosition={setRequestScrollPosition}
          />

          <HomePublicProjectsSection
            loadProjects={loadProjects}
            projectsError={projectsError}
            projectsLoading={projectsLoading}
            publicProjectRows={publicProjectRows}
          />

          <NotificationsDrawer
            open={isNotificationsDrawerOpen}
            onClose={closeNotifications}
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
        onClose={closeMobileNavigation}
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
          onItemSelect={handleMobileNavigationSelect}
          onNewOpportunityClick={handleMobileNewOpportunity}
          onLogoutClick={handleLogout}
          onExpandedChange={handleMobileExpandedChange}
          className="!h-full !min-h-full !w-full border-r-0 shadow-none"
        />
      </SideOverlayDrawer>
    </main>
  );
}

export default Home;
