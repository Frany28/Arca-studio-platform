import { useMemo } from "react";

import NavigationBar from "../../../components/EnvironmentNavigationBar.jsx";
import NotificationsDrawer from "../../../components/EnvironmentNotificationsDrawer.jsx";
import ResponsiveSideNavigation from "../../../components/ui/SideNavigation/ResponsiveSideNavigation.jsx";
import useMobileNavigationDrawer from "../../../components/ui/SideNavigation/hooks/useMobileNavigationDrawer.js";
import { createUserSideNavigationItems } from "../../../utils/sideNavigationItems.js";

/**
 * Estructura común de las páginas de solicitudes del cliente (formulario y consulta de estado):
 * riel lateral con «Solicitudes» activo, barra superior, drawer de observaciones recientes y
 * contenido. Solo compone presentación: cada página decide qué ocurre al navegar o cerrar sesión
 * (el formulario pide confirmación; la consulta no tiene datos que perder).
 *
 * @param {Object} props - Usuario, navegación, notificaciones y contenido.
 * @param {{name: string, email: string, profilePhotoUrl?: string, roleCode: string}} props.currentUser - Usuario mostrado.
 * @param {boolean} props.isSidebarExpanded - Expansión del riel de escritorio.
 * @param {Function} props.onSidebarExpandedChange - Cambia la expansión del riel.
 * @param {Function} props.onItemSelect - Navegación de un elemento del riel.
 * @param {Function} props.onLogoutClick - Cierre de sesión.
 * @param {Function} props.onNewOpportunityClick - Acción «Nueva oportunidad».
 * @param {Object} props.notifications - Resultado de `useProjectRequestNotifications`.
 * @param {import("react").ReactNode} props.children - Contenido principal.
 * @param {import("react").ReactNode} [props.overlays] - Modales y avisos fuera del flujo del contenido.
 * @returns {import("react").ReactElement} Página con su navegación.
 */
function ProjectRequestPageShell({
  children,
  currentUser,
  isSidebarExpanded,
  notifications,
  onItemSelect,
  onLogoutClick,
  onNewOpportunityClick,
  onSidebarExpandedChange,
  overlays = null,
}) {
  const mobileNavigation = useMobileNavigationDrawer();
  const navigationItems = useMemo(
    () => createUserSideNavigationItems([], currentUser.roleCode),
    [currentUser.roleCode],
  );

  return (
    <main className="min-h-screen bg-[var(--color-neutral-bg)]">
      <div className="flex min-h-screen items-stretch">
        {/* El drawer móvil se monta en portal: el contenedor oculto en móvil no lo afecta. */}
        <div className="hidden shrink-0 min-[768px]:block">
          <ResponsiveSideNavigation
            mobileOpen={mobileNavigation.isOpen}
            onMobileClose={mobileNavigation.close}
            activeItemId="requests"
            expanded={isSidebarExpanded}
            items={navigationItems}
            userName={currentUser.name}
            userEmail={currentUser.email}
            userAvatarSrc={currentUser.profilePhotoUrl}
            onExpandedChange={onSidebarExpandedChange}
            onItemSelect={onItemSelect}
            onNewOpportunityClick={onNewOpportunityClick}
            onLogoutClick={onLogoutClick}
          />
        </div>
        <div className="min-w-0 flex-1">
          <NavigationBar
            onMenuClick={mobileNavigation.open}
            mobileMenuExpanded={mobileNavigation.isOpen}
            utilityActionActive={notifications.isOpen}
            onUtilityActionClick={notifications.toggle}
          />

          {children}

          <NotificationsDrawer
            open={notifications.isOpen}
            onClose={notifications.close}
            comments={notifications.comments}
            commentsError={notifications.error}
            commentsLoading={notifications.loading}
            recentActivity={[]}
            recentActivityLoading={false}
            onCommentSelect={notifications.openComment}
          />
        </div>
      </div>

      {overlays}
    </main>
  );
}

export default ProjectRequestPageShell;
