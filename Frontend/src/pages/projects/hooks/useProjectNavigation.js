import { useCallback, useEffect, useState } from "react";
import { getProjectPath } from "../../../utils/projectRoutes.js";
import { getCommentNavigationParams } from "../../../utils/commentSelection.js";
import { getDashboardPath } from "../../../utils/sideNavigationItems.js";

export function useProjectNavigation({
  initialActiveProjectTabIndex,
  navigate,
  searchParams,
  setSearchParams,
  currentUser,
  setIsNotificationsDrawerOpen,
  project,
  resolvedProjectId,
}) {
  const [activeProjectTabIndex, setActiveProjectTabIndex] = useState(() => {
    const requestedTab = searchParams.get("tab");
    if (requestedTab === "renders") return 1;
    if (requestedTab === "documents") return 2;
    return initialActiveProjectTabIndex;
  });

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    if (requestedTab === "renders") setActiveProjectTabIndex(1);
    if (requestedTab === "documents") setActiveProjectTabIndex(2);
  }, [searchParams]);

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

  const clearFocusedRenderComment = useCallback(() => {
    if (!searchParams.has("imageId") && !searchParams.has("commentId")) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("imageId");
    nextParams.delete("commentId");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  return {
    activeProjectTabIndex,
    setActiveProjectTabIndex,
    handleSideNavigationSelect,
    handleActivitySelect,
    openImageComment,
    clearFocusedRenderComment,
  };
}
