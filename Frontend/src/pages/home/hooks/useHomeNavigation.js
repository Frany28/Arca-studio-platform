import { useEffect, useMemo, useState } from "react";

import { getProjectPath } from "../../../utils/projectRoutes.js";
import { createUserSideNavigationItems } from "../../../utils/sideNavigationItems.js";

const TABLET_BREAKPOINT_PX = 768;

/**
 * Construye los destinos del cliente y coordina navegaci?n lateral y m?vil.
 * Sincroniza la expansi?n con matchMedia bajo 768 px y retira el listener al desmontar.
 *
 * @param {Object} params - Dependencias de navegaci?n.
 * @param {Function} params.logout - Acci?n de cierre de sesi?n; el handler no espera su promesa.
 * @param {Function} params.navigate - Navegaci?n del router.
 * @param {Array} params.ownedProjectRows - Proyectos propios usados para destinos din?micos.
 * @returns {Object} Items, expansi?n, apertura m?vil y handlers de selecci?n, creaci?n y logout.
 */
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

  /**
   * Prioriza el destino to del item y resuelve los identificadores de navegaci?n restantes.
   * Para proyectos usa su ruta de presentaci?n o una ruta por id si no encuentra la fila.
   *
   * @param {Object} item - Elemento seleccionado con to o id.
   * @returns {void} Solicita la navegaci?n cuando reconoce un destino.
   */
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
