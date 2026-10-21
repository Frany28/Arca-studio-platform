import { useAuth } from "../../auth/AuthContext.jsx";
import { getUserDisplay } from "../../auth/userDisplay.js";
import AdminPageTitle from "../../components/AdminPageTitle.jsx";
import NotificationsDrawer from "../../components/EnvironmentNotificationsDrawer.jsx";
import EmptyState from "../../components/ui/EmptyState/EmptyState.jsx";
import { useDashboardNavigation } from "../../hooks/useDashboardNavigation.js";
import InternalDashboardLayout from "../../layouts/InternalDashboardLayout.jsx";

// El módulo administrativo no ofrece accesos a proyectos recientes en la navegación.
const NO_PROJECT_SHORTCUTS = [];

/**
 * Vista provisional del módulo "Servicios y cotizaciones" dentro del shell interno compartido.
 * Solo identifica el módulo como en desarrollo: no consulta la API ni muestra datos simulados;
 * el tabulador, las unidades y las cotizaciones se incorporarán en tareas posteriores.
 *
 * @returns {import("react").ReactElement} Vista administrativa provisional con el riel activo.
 */
function AdminServicesQuotesPage() {
  const { user } = useAuth();
  const currentUser = getUserDisplay(user);
  const navigation = useDashboardNavigation({ projectRows: NO_PROJECT_SHORTCUTS, roleCode: "admin" });
  const { isNotificationsDrawerOpen, setIsNotificationsDrawerOpen } = navigation;

  return (
    <InternalDashboardLayout
      currentUser={currentUser}
      navigation={navigation}
      activeItemId="services-quotes"
      showGreeting={false}
      onNotificationsToggle={() => setIsNotificationsDrawerOpen((open) => !open)}
    >
      <section className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-[24px] px-[16px] pb-[48px] sm:px-[24px] lg:px-[48px]" aria-labelledby="admin-services-quotes-title">
        <header className="border-b border-[var(--color-neutral-200)] pb-[24px]">
          <AdminPageTitle id="admin-services-quotes-title">Servicios y cotizaciones</AdminPageTitle>
        </header>

        <EmptyState
          title="Módulo en desarrollo"
          description="Aquí se gestionarán el tabulador de servicios, las unidades de medida y las cotizaciones."
          size="S"
          showActions={false}
          className="min-h-[240px] w-full"
        />
      </section>

      <NotificationsDrawer
        open={isNotificationsDrawerOpen}
        onClose={() => setIsNotificationsDrawerOpen(false)}
        recentActivity={[]}
      />
    </InternalDashboardLayout>
  );
}

export default AdminServicesQuotesPage;
