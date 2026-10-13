import { useAuth } from "../auth/AuthContext.jsx";
import NavigationBar from "../components/EnvironmentNavigationBar.jsx";
import ResponsiveSideNavigation from "../components/ui/SideNavigation/ResponsiveSideNavigation.jsx";
import useMobileNavigationDrawer from "../components/ui/SideNavigation/hooks/useMobileNavigationDrawer.js";

/**
 * Shell de las vistas internas (dashboards, usuarios y archivos): riel lateral responsive,
 * drawer móvil, navbar del entorno y contenedor de scroll del contenido.
 * Es la única composición de este shell; las páginas solo aportan navegación y contenido,
 * de modo que expansión, drawer y scroll se comportan igual en todas las vistas.
 * En móvil la navegación se presenta como drawer abierto desde el botón de menú del navbar.
 *
 * @param {Object} props - Identidad, navegación compartida, toggle y contenido de la página.
 * @param {Object} props.currentUser - Usuario presentado por getUserDisplay.
 * @param {Object} props.navigation - Resultado de useDashboardNavigation.
 * @param {string} [props.activeItemId="dashboard"] - Destino activo del riel lateral.
 * @param {boolean} [props.showGreeting=true] - Muestra el saludo de los dashboards.
 * @param {Function} props.onNotificationsToggle - Abre o cierra el panel de notificaciones.
 * @param {import("react").ReactNode} props.children - Contenido de la página.
 * @returns {import("react").ReactElement} Sidebar, navbar y contenido dentro del layout actual.
 */
function InternalDashboardLayout({
  currentUser,
  navigation,
  activeItemId = "dashboard",
  showGreeting = true,
  onNotificationsToggle,
  children,
}) {
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
          activeItemId={activeItemId}
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

        {/* Sin overflow-x-hidden: el contenido debe adaptarse al ancho y no recortarse en
            silencio; las tablas anchas desplazan dentro de su propio contenedor. */}
        <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col self-stretch overflow-y-auto transition-[width] duration-300 ease-out">
          <NavigationBar
            onMenuClick={mobileNavigation.open}
            mobileMenuExpanded={mobileNavigation.isOpen}
            utilityActionActive={isNotificationsDrawerOpen}
            onUtilityActionClick={handleNotificationsToggle}
          />

          {showGreeting ? (
            <div className="mx-auto flex w-full max-w-[1200px] px-[16px] pb-[16px] sm:px-[24px] lg:px-[48px]">
              <p className="text-heading-6 w-full text-[var(--color-text-300)]">
                Bienvenido, {currentUser.shortName}
              </p>
            </div>
          ) : null}

          {children}
        </div>
      </div>
    </main>
  );
}

export default InternalDashboardLayout;
