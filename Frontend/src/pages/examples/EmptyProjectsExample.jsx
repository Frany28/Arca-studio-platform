import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/AuthContext.jsx";
import { getUserDisplay } from "../../auth/userDisplay.js";
import EmptyState from "../../components/ui/EmptyState.jsx";
import NavigationBar from "../../components/EnvironmentNavigationBar.jsx";
import NotificationsDrawer from "../../components/EnvironmentNotificationsDrawer.jsx";
import ResponsiveSideNavigation from "../../components/ui/SideNavigation/ResponsiveSideNavigation.jsx";
import useMobileNavigationDrawer from "../../components/ui/SideNavigation/hooks/useMobileNavigationDrawer.js";
import Tooltip from "../../components/ui/Tooltip/Tooltip.jsx";

const EXPANDED_SIDEBAR_WIDTH = 312;
const COLLAPSED_SIDEBAR_WIDTH = 76;
const TABLET_BREAKPOINT_PX = 768;

function ChevronLeftIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M12.5 15L7.5 10L12.5 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRightIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M7.5 15L12.5 10L7.5 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EmptyProjectsCarouselSection() {
  return (
    <section className="flex w-full min-w-0 flex-col items-start gap-[16px] self-stretch">
      <div className="flex w-full items-center justify-between gap-[12px]">
        <h2 className="text-[24px] font-bold leading-[30px] tracking-[-0.5px] text-[var(--color-text-100)]">
          Ver más proyectos
        </h2>

        <div className="flex items-center gap-[6px]">
          <Tooltip asChild portal showTip text="Proyecto anterior" tipPosition="Top center">
            <button
              type="button"
              aria-label="Proyecto anterior"
              disabled
              className=" cursor-not-allowed flex h-[28px] w-[28px] items-center justify-center rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] text-[var(--color-text-200)] opacity-40"
            >
              <ChevronLeftIcon className="size-4" />
            </button>
          </Tooltip>

          <Tooltip asChild portal showTip text="Proyecto siguiente" tipPosition="Top center">
            <button
              type="button"
              aria-label="Proyecto siguiente"
              disabled
              className=" cursor-not-allowed flex h-[28px] w-[28px] items-center justify-center rounded-[8px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] text-[var(--color-text-200)] opacity-40"
            >
              <ChevronRightIcon className="size-4" />
            </button>
          </Tooltip>
        </div>
      </div>

      <EmptyState
        title="No se encontraron proyectos"
        description="Aquí podrás visualizar otros proyectos que pueden interesarte."
        size="M"
        showFeaturedIcon
        showActions
        showSecondaryAction={false}
        primaryActionLabel="Actualizar"
        className="min-h-[520px]"
      />
    </section>
  );
}

function EmptyProjectsExample() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const currentUser = getUserDisplay(user);
  const mobileNavigation = useMobileNavigationDrawer();
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const [isNotificationsDrawerOpen, setIsNotificationsDrawerOpen] = useState(false);
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

    if (item?.id === "settings") {
      navigate("/configuraciones");
    }
  };

  return (
    <main className="min-h-screen bg-[var(--color-neutral-bg)] transition-colors duration-200">
      <div className="flex min-h-screen w-full">
        <ResponsiveSideNavigation
          mobileOpen={mobileNavigation.isOpen}
          onMobileClose={mobileNavigation.close}
          activeItemId="dashboard"
          expanded={isSidebarExpanded}
          userName={currentUser.name}
          userEmail={currentUser.email}
          userAvatarSrc={currentUser.profilePhotoUrl}
          onExpandedChange={setIsSidebarExpanded}
          onItemSelect={handleSideNavigationSelect}
          onLogoutClick={() => {
            logout();
            navigate("/");
          }}
          className="h-screen min-h-screen max-h-screen"
        />

        <div
          className="relative min-w-0 self-stretch overflow-y-auto transition-[width] duration-300 ease-out"
          style={{
            height: "100vh",
            width: `calc(100% - ${
              isSidebarExpanded
                ? EXPANDED_SIDEBAR_WIDTH
                : COLLAPSED_SIDEBAR_WIDTH
            }px)`,
          }}
        >
          <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between self-stretch border-b border-[var(--color-neutral-200)]">
            <NavigationBar
              onMenuClick={mobileNavigation.open}
              mobileMenuExpanded={mobileNavigation.isOpen}
              utilityActionActive={isNotificationsDrawerOpen}
              onUtilityActionClick={() => setIsNotificationsDrawerOpen((current) => !current)}
            />
          </div>

          <div className="mx-auto flex w-full max-w-[1200px] px-[48px] py-[16px]">
            <p className="w-full text-heading-6 text-[var(--color-text-300)]">
              Bienvenido, {currentUser.shortName}
            </p>
          </div>

          <div className="mx-auto flex w-full max-w-[1200px] px-[48px] pb-[16px]">
            <EmptyState
              title="Tu espacio de proyectos está listo"
              description="Aquí podrás visualizar y dar seguimiento a tus proyectos."
              size="M"
              showFeaturedIcon
              showActions
              showSecondaryAction={false}
              primaryActionLabel="Actualizar"
              className="min-h-[300px]"
            />
          </div>

          <div className="mx-auto flex w-full max-w-[1200px] px-[48px] pb-[24px]">
            <EmptyProjectsCarouselSection />
          </div>

          <NotificationsDrawer
            open={isNotificationsDrawerOpen}
            onClose={() => setIsNotificationsDrawerOpen(false)}
            comments={[]}
            commentsLoading={false}
            recentActivity={[]}
            recentActivityLoading={false}
          />
        </div>
      </div>
    </main>
  );
}

export default EmptyProjectsExample;
