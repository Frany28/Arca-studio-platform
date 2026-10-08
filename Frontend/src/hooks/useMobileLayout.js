import { useSyncExternalStore } from "react";

import { MOBILE_LAYOUT_MEDIA_QUERY } from "../utils/layoutBreakpoints.js";

/**
 * Suscribe React a los cambios del rango móvil y retira el listener al dejar de usarse.
 *
 * @param {Function} onChange Notificación de React para volver a leer la coincidencia.
 * @returns {Function} Limpieza del listener de matchMedia.
 */
function subscribeToMobileLayout(onChange) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};

  const mediaQuery = window.matchMedia(MOBILE_LAYOUT_MEDIA_QUERY);
  mediaQuery.addEventListener("change", onChange);
  return () => mediaQuery.removeEventListener("change", onChange);
}

/**
 * Lee si el viewport está en el rango móvil; fuera del navegador se asume escritorio.
 *
 * @returns {boolean} Coincidencia actual de la media query móvil.
 */
function getMobileLayoutSnapshot() {
  return typeof window !== "undefined" && Boolean(window.matchMedia)
    && window.matchMedia(MOBILE_LAYOUT_MEDIA_QUERY).matches;
}

/**
 * Indica si se debe aplicar el diseño MOBILE de Figma (por debajo de 768 px).
 * Solo debe usarse para elegir props de presentación que no admiten clases responsive,
 * como el tamaño de Button, IconContainer o Tag; el layout se resuelve con CSS.
 * useSyncExternalStore lee el valor antes del primer pintado, sin parpadeo entre diseños.
 *
 * @returns {boolean} `true` en móvil; `false` en tablet y escritorio.
 */
export default function useMobileLayout() {
  return useSyncExternalStore(
    subscribeToMobileLayout,
    getMobileLayoutSnapshot,
    () => false,
  );
}
