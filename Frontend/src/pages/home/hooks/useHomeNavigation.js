import { useEffect, useMemo, useState } from "react";

import { getProjectPath } from "../../../utils/projectRoutes.js";
import { createUserSideNavigationItems } from "../../../utils/sideNavigationItems.js";

const TABLET_BREAKPOINT_PX = 768;

export default function useHomeNavigation({
  logout,
  navigate,
  ownedProjectRows,
}) {
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false);

  const navigationItems = useMemo(
    () => createUserSideNavigationItems(ownedProjectRows, "client"),
    [ownedProjectRows],
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
          selectedProject
            ? getProjectPath(selectedProject)
            : `/proyectos/${projectId}`,
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
    navigate("/solicitudes/nueva");
  };

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  const openMobileNavigation = () => {
    setIsMobileNavigationOpen(true);
  };

  const closeMobileNavigation = () => {
    setIsMobileNavigationOpen(false);
  };

  const handleMobileNavigationSelect = (item) => {
    setIsMobileNavigationOpen(false);
    handleSideNavigationSelect(item);
  };

  const handleMobileNewOpportunity = () => {
    setIsMobileNavigationOpen(false);
    navigate("/solicitudes/nueva");
  };

  const handleMobileExpandedChange = (expanded) => {
    if (!expanded) {
      setIsMobileNavigationOpen(false);
    }
  };

  return {
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
  };
}
