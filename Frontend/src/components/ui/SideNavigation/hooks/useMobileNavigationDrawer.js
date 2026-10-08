import { useCallback, useEffect, useState } from "react";

import { SIDE_NAVIGATION_PERSISTENT_MIN_WIDTH_PX } from "../sideNavigationConfig.js";

/**
 * Administra la apertura del drawer de navegación móvil, independiente de la expansión
 * del riel persistente para que ambos estados nunca se contradigan.
 * Cierra el drawer al alcanzar el ancho del riel persistente: el drawer se oculta por CSS
 * en ese rango, y mantenerlo abierto dejaría un diálogo modal invisible con el scroll
 * bloqueado. El listener de matchMedia se retira al desmontar.
 *
 * @returns {{isOpen: boolean, open: Function, close: Function}} Estado y acciones estables.
 */
export default function useMobileNavigationDrawer() {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;

    const persistentQuery = window.matchMedia(
      `(min-width: ${SIDE_NAVIGATION_PERSISTENT_MIN_WIDTH_PX}px)`,
    );

    /**
     * Cierra el drawer cuando el viewport entra en el rango del riel persistente.
     *
     * @param {MediaQueryListEvent} event Cambio de coincidencia del rango tablet/escritorio.
     * @returns {void}
     */
    function closeOnPersistentViewport(event) {
      if (event.matches) setIsOpen(false);
    }

    persistentQuery.addEventListener("change", closeOnPersistentViewport);

    return () => {
      persistentQuery.removeEventListener("change", closeOnPersistentViewport);
    };
  }, []);

  return { isOpen, open, close };
}
