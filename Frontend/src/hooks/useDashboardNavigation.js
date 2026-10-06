import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getProjectPath } from "../utils/projectRoutes.js";
import { createUserSideNavigationItems } from "../utils/sideNavigationItems.js";

const WEB_BREAKPOINT_PX = 1280;

/**
 * Conserva la navegación, expansión responsive y estado del drawer de los dashboards.
 * Comparte los callbacks existentes sin cargar datos ni conocer acciones de cada rol.
 *
 * @param {Object} params - Proyectos disponibles y rol de la sesión.
 * @param {Array} params.projectRows - Filas usadas para items y destinos de proyectos.
 * @param {string} params.roleCode - Selecciona los items mediante la política compartida.
 * @returns {Object} Navegación, estado del sidebar y apertura del drawer.
 */
export function useDashboardNavigation({ projectRows, roleCode }) {
  const navigate = useNavigate();
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth >= WEB_BREAKPOINT_PX,
  );
  const [isNotificationsDrawerOpen, setIsNotificationsDrawerOpen] =
    useState(false);
  const navigationItems = useMemo(
    () => createUserSideNavigationItems(projectRows, roleCode),
    [roleCode, projectRows],
  );
  useEffect(() => {
    const mediaQuery = window.matchMedia(
      `(max-width: ${WEB_BREAKPOINT_PX - 1}px)`,
    );

    /**
     * Restablece la expansión al entrar o salir del rango web, además del montaje.
     * Dentro del mismo rango conserva los cambios manuales solicitados por el usuario.
     *
     * @param {MediaQueryList|MediaQueryListEvent} event Coincidencia del rango menor a 1280 px.
     * @returns {void} Actualiza la expansión controlada por la página.
     */
    function syncSidebarForViewport(event) {
      setIsSidebarExpanded(!event.matches);
    }

    syncSidebarForViewport(mediaQuery);
    mediaQuery.addEventListener("change", syncSidebarForViewport);

    return () => {
      mediaQuery.removeEventListener("change", syncSidebarForViewport);
    };
  }, []);

  /**
   * Resuelve los destinos existentes del sidebar respetando to e IDs de proyectos.
   * Mantiene los fallbacks de dashboard, proyectos y configuraciones.
   * @param {Object} item - Item seleccionado en la navegación compartida.
   * @returns {void} Navega si el item dispone de un destino reconocido.
   */
  const handleSideNavigationSelect = (item) => {
    if (item?.to) {
      navigate(item.to);
      return;
    }

    if (item?.id === "dashboard") {
      navigate("/dashboard-arquitecto");
      return;
    }

    if (item?.id?.startsWith("project-")) {
      const projectId = Number(item.id.replace("project-", ""));

      if (Number.isInteger(projectId)) {
        const selectedProject = projectRows.find(
          (project) => project.id === projectId,
        );

        navigate(
          selectedProject ? getProjectPath(selectedProject) : `/proyectos/${projectId}`,
        );
      }
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

  /**
   * Resuelve el destino de actividad por ruta explícita o proyecto disponible.
   * Cierra el drawer únicamente cuando la actividad permite navegar.
   * @param {Object} activity - Actividad recibida por el drawer compartido.
   * @returns {void} Programa cierre y navegación cuando existe destino.
   */
  const handleActivitySelect = (activity) => {
    const targetProject = activity?.projectId
      ? projectRows.find(
          (project) => Number(project.id) === Number(activity.projectId),
        )
      : null;
    const targetPath = activity?.to ||
      (targetProject ? getProjectPath(targetProject) : null);

    if (!targetPath) return;

    setIsNotificationsDrawerOpen(false);
    navigate(targetPath);
  };

  return {
    navigate,
    navigationItems,
    isSidebarExpanded,
    setIsSidebarExpanded,
    isNotificationsDrawerOpen,
    setIsNotificationsDrawerOpen,
    handleSideNavigationSelect,
    handleActivitySelect,
  };
}
