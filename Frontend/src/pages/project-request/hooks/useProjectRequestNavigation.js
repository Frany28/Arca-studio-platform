import { useState } from "react";

import { getDashboardPath } from "../../../utils/sideNavigationItems.js";

/**
 * Coordina la expansión de escritorio; el drawer móvil pertenece a useMobileNavigationDrawer.
 * Difiere navegación, logout o reset hasta confirmarlos; cancelar no ejecuta la acción.
 *
 * @param {Object} params - Dependencias del flujo de navegaci?n.
 * @param {Function} params.logout - Cierra sesi?n; no se espera su resultado antes de navegar.
 * @param {Function} params.navigate - Navegaci?n del router.
 * @param {Function} params.onReset - Reinicia el flujo al confirmar clear.
 * @param {string} params.roleCode - Rol usado para resolver el dashboard.
 * @param {Function} params.setShowRequiredAlert - Controla el aviso de validaci?n.
 * @param {Function} params.setNotificationsOpen - Controla la apertura del drawer externo.
 * @returns {Object} Expansión, modal, acci?n pendiente y handlers para solicitar, cancelar o confirmar acciones.
 */
export default function useProjectRequestNavigation({
  logout,
  navigate,
  onReset,
  roleCode,
  setShowRequiredAlert,
  setNotificationsOpen,
}) {
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
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
    setPendingRequestAction({ type: "navigate", item });
    setIsRequestActionModalOpen(true);
  };

  const requestLogout = () => {
    setShowRequiredAlert(false);
    setNotificationsOpen(false);
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

  /**
   * Cierra el modal y ejecuta la acci?n pendiente: reset, logout o navegaci?n.
   * El logout solicita cierre de sesi?n y navega de inmediato, sin esperar su promesa.
   *
   * @returns {void} Ejecuta los callbacks correspondientes a la acci?n guardada.
   */
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

  const collapseSidebar = () => {
    setIsSidebarExpanded(false);
  };

  const expandSidebar = () => {
    setIsSidebarExpanded(true);
  };

  return {
    cancelRequestAction,
    collapseSidebar,
    confirmRequestAction,
    expandSidebar,
    isRequestActionModalOpen,
    isSidebarExpanded,
    pendingRequestAction,
    requestLogout,
    requestNavigation,
    requestReset,
    setIsSidebarExpanded,
  };
}
