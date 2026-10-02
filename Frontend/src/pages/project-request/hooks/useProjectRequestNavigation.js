import { useState } from "react";

import { getDashboardPath } from "../../../utils/sideNavigationItems.js";

export default function useProjectRequestNavigation({
  logout,
  navigate,
  onReset,
  roleCode,
  setShowRequiredAlert,
  setNotificationsOpen,
}) {
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false);
  const [pendingRequestAction, setPendingRequestAction] = useState(null);
  const [isRequestActionModalOpen, setIsRequestActionModalOpen] = useState(false);

  const performSideNavigation = (item) => {
    if (item?.to) {
      navigate(item.to);
      return;
    }

    if (item.id === "dashboard") navigate(getDashboardPath(roleCode));
    if (item.id === "requests") navigate("/solicitudes");
    if (item.id === "more-projects") navigate("/proyectos");
    if (item.id === "settings") navigate("/configuraciones");
  };

  const requestNavigation = (item) => {
    if (!item) return;

    setShowRequiredAlert(false);
    setNotificationsOpen(false);
    setIsMobileNavigationOpen(false);
    setPendingRequestAction({ type: "navigate", item });
    setIsRequestActionModalOpen(true);
  };

  const requestLogout = () => {
    setShowRequiredAlert(false);
    setNotificationsOpen(false);
    setIsMobileNavigationOpen(false);
    setPendingRequestAction({ type: "logout" });
    setIsRequestActionModalOpen(true);
  };

  const requestReset = () => {
    setShowRequiredAlert(false);
    setPendingRequestAction({ type: "clear" });
    setIsRequestActionModalOpen(true);
  };

  const cancelRequestAction = () => {
    setIsRequestActionModalOpen(false);
  };

  const confirmRequestAction = () => {
    const action = pendingRequestAction;
    setIsRequestActionModalOpen(false);

    if (action?.type === "clear") {
      onReset();
      return;
    }

    if (action?.type === "logout") {
      logout();
      navigate("/");
      return;
    }

    if (action?.type === "navigate") {
      performSideNavigation(action.item);
    }
  };

  const openMobileNavigation = () => {
    setIsMobileNavigationOpen(true);
  };

  const closeMobileNavigation = () => {
    setIsMobileNavigationOpen(false);
  };

  const collapseSidebar = () => {
    setIsSidebarExpanded(false);
  };

  const expandSidebar = () => {
    setIsSidebarExpanded(true);
  };

  return {
    cancelRequestAction,
    closeMobileNavigation,
    collapseSidebar,
    confirmRequestAction,
    expandSidebar,
    isMobileNavigationOpen,
    isRequestActionModalOpen,
    isSidebarExpanded,
    openMobileNavigation,
    pendingRequestAction,
    requestLogout,
    requestNavigation,
    requestReset,
    setIsSidebarExpanded,
  };
}
