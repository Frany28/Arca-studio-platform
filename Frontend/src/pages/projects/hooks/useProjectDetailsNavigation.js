import { useEffect, useState } from "react";

import { getProjectPath } from "../../../utils/projectRoutes.js";
import { getDashboardPath } from "../../../utils/sideNavigationItems.js";

const TABLET_BREAKPOINT_PX = 768;

export default function useProjectDetailsNavigation({
  currentUser,
  logout,
  navigate,
  project,
}) {
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(
    () => typeof window === "undefined" || window.innerWidth >= 1024,
  );

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
      navigate(getDashboardPath(currentUser.roleCode));
      return;
    }

    if (item?.id?.startsWith("project-")) {
      const selectedProjectId = Number(item.id.replace("project-", ""));

      if (Number.isInteger(selectedProjectId)) {
        navigate(
          project && project.id === selectedProjectId
            ? getProjectPath(project)
            : `/proyectos/${selectedProjectId}`,
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

  const handleNewOpportunity = () => {
    if (currentUser.roleCode === "client") {
      navigate("/solicitudes/nueva");
      return;
    }

    navigate("/dashboard-arquitecto/nuevo-proyecto");
  };

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  const openSidebar = () => {
    setIsSidebarExpanded(true);
  };

  const closeSidebar = () => {
    setIsSidebarExpanded(false);
  };

  return {
    closeSidebar,
    handleLogout,
    handleNewOpportunity,
    handleSideNavigationSelect,
    isSidebarExpanded,
    openSidebar,
    setIsSidebarExpanded,
  };
}
