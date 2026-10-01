import { useEffect } from "react";

export function useSidebarViewportSync({ breakpoint, setIsSidebarExpanded }) {
  useEffect(() => {
    const mediaQuery = window.matchMedia(
      `(max-width: ${breakpoint - 1}px)`,
    );

    function syncSidebarForViewport(event) {
      setIsSidebarExpanded(!event.matches);
    }

    syncSidebarForViewport(mediaQuery);
    mediaQuery.addEventListener("change", syncSidebarForViewport);

    return () => {
      mediaQuery.removeEventListener("change", syncSidebarForViewport);
    };
  }, [breakpoint, setIsSidebarExpanded]);
}
