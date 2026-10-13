import { useEffect, useState } from "react";

import { WEB_LAYOUT_MEDIA_QUERY } from "../utils/layoutBreakpoints.js";

/**
 * Lee si el viewport está en el rango web; fuera del navegador se asume escritorio.
 *
 * @returns {boolean} `true` desde 1280 px o sin `window`.
 */
function matchesWebLayout() {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  return window.matchMedia(WEB_LAYOUT_MEDIA_QUERY).matches;
}

/**
 * Administra la expansión del riel lateral persistente de las vistas internas.
 * Inicia expandido en web (desde 1280 px) y contraído en tablet, como en Figma.
 * Solo restablece el valor al cruzar el breakpoint web: dentro del mismo rango se
 * conserva la elección manual del usuario. Es independiente del drawer móvil
 * (useMobileNavigationDrawer), de modo que ambos estados no se contradicen.
 * El listener de matchMedia se retira al desmontar.
 *
 * @returns {[boolean, Function]} Expansión actual y su setter, compatible con useState.
 */
export default function useResponsiveSidebarExpansion() {
  const [isExpanded, setIsExpanded] = useState(matchesWebLayout);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;

    const webQuery = window.matchMedia(WEB_LAYOUT_MEDIA_QUERY);

    /**
     * Sincroniza la expansión con el rango web cuando el viewport cruza 1280 px.
     *
     * @param {MediaQueryListEvent} event Cambio de coincidencia del rango web.
     * @returns {void}
     */
    function syncWithWebLayout(event) {
      setIsExpanded(event.matches);
    }

    webQuery.addEventListener("change", syncWithWebLayout);
    return () => webQuery.removeEventListener("change", syncWithWebLayout);
  }, []);

  return [isExpanded, setIsExpanded];
}
