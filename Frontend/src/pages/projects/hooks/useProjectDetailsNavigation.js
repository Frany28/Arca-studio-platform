import { useEffect, useState } from "react";

import { getProjectPath } from "../../../utils/projectRoutes.js";
import { getDashboardPath } from "../../../utils/sideNavigationItems.js";

const TABLET_BREAKPOINT_PX = 768;

/**
 * Coordina destinos y apertura del sidebar desde el detalle del proyecto.
 * El estado inicial usa 1024 px; el efecto lo sincroniza despu?s con matchMedia a 768 px
 * y retira su listener al desmontar. Logout navega sin esperar la promesa de cierre.
 *
 * @param {Object} params - Identidad presentada y acciones externas.
 * @param {Object} params.currentUser - Usuario de presentaci?n con roleCode para destinos por rol.
 * @param {Function} params.logout - Acci?n externa de cierre de sesi?n.
 * @param {Function} params.navigate - Navegaci?n del router.
 * @param {Object|null} params.project - Proyecto actual para resolver su ruta de presentaci?n.
 * @returns {Object} Expansi?n, setter y acciones de sidebar, selecci?n, nueva oportunidad y logout.
 */
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

  /**
   * Prioriza to y resuelve los ids del men?; dashboard depende del rol presentado.
   * Solo el proyecto actual usa su ruta de presentaci?n; otros proyectos usan la ruta por id.
   *
   * @param {Object} item - Elemento con to o id de navegaci?n.
   * @returns {void} Navega cuando reconoce un destino.
   */
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

  /**
   * Env?a al cliente a crear una solicitud y a los dem?s roles al flujo de nuevo proyecto.
   *
   * @returns {void} Solicita la navegaci?n correspondiente al rol.
   */
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
