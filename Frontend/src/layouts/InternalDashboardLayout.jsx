import { useAuth } from "../auth/AuthContext.jsx";
import NavigationBar from "../components/EnvironmentNavigationBar.jsx";
import ResponsiveSideNavigation from "../components/ui/SideNavigation/ResponsiveSideNavigation.jsx";
import useMobileNavigationDrawer from "../components/ui/SideNavigation/hooks/useMobileNavigationDrawer.js";

/**
 * Renderiza el layout existente de ambos dashboards, incluido el saludo y logout.
 * Recibe navegación y contenido del rol sin añadir contenedores ni estilos nuevos.
 * En móvil la navegación se presenta como drawer abierto desde el botón de menú del navbar.
 *
 * @param {Object} props - Identidad, navegación compartida, toggle y contenido de la página.
 * @returns {import("react").ReactElement} Sidebar, navbar y contenido dentro del layout actual.
 */
function InternalDashboardLayout({ currentUser, navigation, onNotificationsToggle, children }) {
  const { logout } = useAuth();
  const mobileNavigation = useMobileNavigationDrawer();
  const {
    navigate, navigationItems, isSidebarExpanded, setIsSidebarExpanded,
    isNotificationsDrawerOpen, handleSideNavigationSelect,
  } = navigation;
  const handleNotificationsToggle = onNotificationsToggle;

  return (
    <main className="h-screen overflow-hidden bg-[var(--color-neutral-bg)] transition-colors duration-200">
      <div className="flex h-full min-h-0 w-full items-stretch">
        <ResponsiveSideNavigation
          mobileOpen={mobileNavigation.isOpen}
          onMobileClose={mobileNavigation.close}
          activeItemId="dashboard"
          expanded={isSidebarExpanded}
          items={navigationItems}
          newOpportunityLabel="Nuevo proyecto"
          userName={currentUser.name}
          userEmail={currentUser.email}
          userAvatarSrc={currentUser.profilePhotoUrl}
          onExpandedChange={setIsSidebarExpanded}
          onItemSelect={handleSideNavigationSelect}
          onNewOpportunityClick={() =>
            navigate("/dashboard-arquitecto/nuevo-proyecto")
          }
          onLogoutClick={() => {
            logout();
            navigate("/");
          }}
          className="h-screen shrink-0 self-stretch"
        />

        <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col self-stretch overflow-y-auto overflow-x-hidden transition-[width] duration-300 ease-out">
          <NavigationBar
            onMenuClick={mobileNavigation.open}
            mobileMenuExpanded={mobileNavigation.isOpen}
            utilityActionActive={isNotificationsDrawerOpen}
            onUtilityActionClick={handleNotificationsToggle}
          />

          <div className="mx-auto flex w-full max-w-[1200px] px-[16px] pb-[16px] sm:px-[24px] lg:px-[48px]">
            <p className="text-heading-6 w-full text-[var(--color-text-300)]">
              Bienvenido, {currentUser.shortName}
            </p>
          </div>

          {children}
        </div>
      </div>
    </main>
  );
}

export default InternalDashboardLayout;
