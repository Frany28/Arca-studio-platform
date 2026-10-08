import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/AuthContext.jsx";
import { getUserDisplay } from "../../auth/userDisplay.js";
import { useImageCommentNotifications } from "../../components/ui/Gallery/useImageComments.js";
import NavigationBar from "../../components/EnvironmentNavigationBar.jsx";
import NotificationsDrawer from "../../components/EnvironmentNotificationsDrawer.jsx";
import ResponsiveSideNavigation from "../../components/ui/SideNavigation/ResponsiveSideNavigation.jsx";
import useMobileNavigationDrawer from "../../components/ui/SideNavigation/hooks/useMobileNavigationDrawer.js";
import { CLIENT_DRAWER_RECENT_ACTIVITY } from "../../data/clientDrawerData.js";
import ProjectDetailTabMenu from "../projects/components/ProjectDetailTabMenu.jsx";
import TabPanel from "../../components/ui/TabPanel.jsx";
import ProjectOverviewHeader from "../projects/components/ProjectOverviewHeader.jsx";
import ProjectInfoPanel from "../projects/panels/ProjectInfoPanel.jsx";
import ProjectRendersPanel from "../projects/panels/ProjectRendersPanel.jsx";
import { PROJECT_DETAIL_DATA } from "../projects/projectDetailsData.js";

const TABLET_BREAKPOINT_PX = 768;

export default function EmptyProjectRendersExample() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const currentUser = getUserDisplay(user);
  const mobileNavigation = useMobileNavigationDrawer();
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const [isNotificationsDrawerOpen, setIsNotificationsDrawerOpen] =
    useState(false);
  const [activeProjectTabIndex, setActiveProjectTabIndex] = useState(1);
  const imageCommentNotifications = useImageCommentNotifications({
    projectIds: ["quinta-bella-vista"],
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia(
      `(max-width: ${TABLET_BREAKPOINT_PX - 1}px)`,
    );

    function syncSidebarForViewport(event) {
      setIsSidebarExpanded(!event.matches);
    }

    syncSidebarForViewport(mediaQuery);
    mediaQuery.addEventListener("change", syncSidebarForViewport);

    return () => {
      mediaQuery.removeEventListener("change", syncSidebarForViewport);
    };
  }, []);

  const handleSideNavigationSelect = (item) => {
    if (item?.to) {
      navigate(item.to);
      return;
    }

    if (item?.id === "dashboard") {
      navigate("/dashboard-clientes");
      return;
    }

    if (item?.id === "project-1" || item?.id === "project-2") {
      navigate("/proyectos/quinta-bella-vista");
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
    const params = new URLSearchParams({ tab: "renders" });

    if (comment?.imageId) {
      params.set("imageId", comment.imageId);
    }

    if (comment?.id) {
      params.set("commentId", comment.id);
    }

    setIsNotificationsDrawerOpen(false);
    navigate(`/proyectos/quinta-bella-vista?${params.toString()}`);
  };

  const activeProjectPanel =
    activeProjectTabIndex === 1 ? (
      <ProjectRendersPanel renderGallery={[]} videoGallery={[]} />
    ) : (
      <ProjectInfoPanel />
    );

  return (
    <main className="min-h-screen bg-[var(--color-neutral-bg)] transition-colors duration-200">
      <div className="flex min-h-screen w-full items-stretch">
        <ResponsiveSideNavigation
          mobileOpen={mobileNavigation.isOpen}
          onMobileClose={mobileNavigation.close}
          activeItemId="project-1"
          expanded={isSidebarExpanded}
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
          className="min-h-screen shrink-0 self-stretch"
        />

        <div className="relative flex min-h-screen min-w-0 flex-1 flex-col self-stretch overflow-y-auto transition-[width] duration-300 ease-out">
          <NavigationBar
            onMenuClick={mobileNavigation.open}
            mobileMenuExpanded={mobileNavigation.isOpen}
            utilityActionActive={isNotificationsDrawerOpen}
            onUtilityActionClick={() =>
              setIsNotificationsDrawerOpen((current) => !current)
            }
          />

          <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-[48px] px-[48px] pb-[24px] pt-0">
            <ProjectOverviewHeader project={PROJECT_DETAIL_DATA} />
            <ProjectDetailTabMenu
              activeIndex={activeProjectTabIndex}
              onChange={setActiveProjectTabIndex}
            />
            <TabPanel transitionKey={activeProjectTabIndex} className="w-full">
              {activeProjectPanel}
            </TabPanel>
          </div>

          <NotificationsDrawer
            open={isNotificationsDrawerOpen}
            onClose={() => setIsNotificationsDrawerOpen(false)}
            comments={imageCommentNotifications}
            commentsError=""
            commentsLoading={false}
            recentActivity={CLIENT_DRAWER_RECENT_ACTIVITY}
            onActivitySelect={handleActivitySelect}
            onCommentSelect={openImageComment}
          />
        </div>
      </div>
    </main>
  );
}
