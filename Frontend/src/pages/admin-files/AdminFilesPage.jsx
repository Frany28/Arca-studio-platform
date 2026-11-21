import { useAuth } from "../../auth/AuthContext.jsx";
import { getUserDisplay } from "../../auth/userDisplay.js";
import AdminPageTitle from "../../components/AdminPageTitle.jsx";
import NotificationsDrawer from "../../components/EnvironmentNotificationsDrawer.jsx";
import EmptyState from "../../components/ui/EmptyState/EmptyState.jsx";
import Loader from "../../components/ui/Loader/Loader.jsx";
import { useDashboardNavigation } from "../../hooks/useDashboardNavigation.js";
import InternalDashboardLayout from "../../layouts/InternalDashboardLayout.jsx";
import AdminFilesMetrics from "./components/AdminFilesMetrics.jsx";
import AdminFilesWorkspace from "./components/AdminFilesWorkspace.jsx";
import { useAdminFilesMetrics } from "./hooks/useAdminFilesMetrics.js";

// La gestión de archivos no ofrece accesos a proyectos recientes en la navegación.
const NO_PROJECT_SHORTCUTS = [];

/**
 * Gestión de archivos del administrador (Figma 3727:682730) dentro del shell interno compartido:
 * métricas, pestañas Aprobados / Pendientes / Rechazados, árbol de proyectos y carpetas, búsqueda,
 * tabla con filtros, orden y paginación, y operaciones de carpetas. Con la activación
 * PROJECT_FILE_REVIEW_ENABLED apagada solo se muestran las métricas generales y el resto se
 * presenta como no disponible, sin datos de demostración. La expansión responsive del riel
 * pertenece a useDashboardNavigation.
 *
 * @returns {import("react").ReactElement} Vista administrativa de archivos.
 */
function AdminFilesPage() {
  const { user } = useAuth();
  const currentUser = getUserDisplay(user);
  const navigation = useDashboardNavigation({ projectRows: NO_PROJECT_SHORTCUTS, roleCode: "admin" });
  const { isNotificationsDrawerOpen, setIsNotificationsDrawerOpen } = navigation;
  const metrics = useAdminFilesMetrics();

  let workspace;
  if (metrics.availability === "checking") {
    workspace = <Loader preset="adminFilesTable" count={5} label="Cargando gestión de archivos" />;
  } else if (metrics.availability === "unavailable") {
    workspace = (
      <EmptyState
        title="La gestión de archivos aún no está disponible"
        description="Las pestañas, el árbol de carpetas y la revisión se habilitarán cuando se active la revisión de archivos en este entorno."
        size="M"
        showFeaturedIcon
        showActions={false}
        className="min-h-[320px]"
      />
    );
  } else {
    workspace = <AdminFilesWorkspace onMetricsStale={metrics.reload} />;
  }

  return (
    <InternalDashboardLayout
      currentUser={currentUser}
      navigation={navigation}
      activeItemId="files"
      showGreeting={false}
      onNotificationsToggle={() => setIsNotificationsDrawerOpen((open) => !open)}
    >
      {/* Figma 3727:683873 / 3727:683883: 16 px entre título y KPI y 48 px entre secciones, también en móvil. */}
      <section className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-[48px] px-[16px] pb-[48px] sm:px-[24px] lg:px-[48px]" aria-labelledby="admin-files-title">
        <header className="flex flex-col gap-[16px]">
          <AdminPageTitle id="admin-files-title">Gestión de archivos</AdminPageTitle>
          <AdminFilesMetrics {...metrics} />
        </header>
        {workspace}
      </section>

      <NotificationsDrawer
        open={isNotificationsDrawerOpen}
        onClose={() => setIsNotificationsDrawerOpen(false)}
        recentActivity={[]}
      />
    </InternalDashboardLayout>
  );
}

export default AdminFilesPage;
