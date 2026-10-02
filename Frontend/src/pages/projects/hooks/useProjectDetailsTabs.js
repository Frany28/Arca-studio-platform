import { useCallback, useEffect, useState } from "react";

export default function useProjectDetailsTabs({
  initialActiveProjectTabIndex,
  searchParams,
  setSearchParams,
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
    clearFocusedRenderComment,
    setActiveProjectTabIndex,
  };
}
