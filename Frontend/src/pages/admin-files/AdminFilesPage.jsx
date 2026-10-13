import { useEffect, useState } from "react";
import { CloudConnection, DocumentText, DocumentUpload } from "iconsax-react";

import { api } from "../../api/http.js";
import { useAuth } from "../../auth/AuthContext.jsx";
import { getUserDisplay } from "../../auth/userDisplay.js";
import AdminKpiMetric from "../../components/AdminKpiMetric.jsx";
import AdminPageTitle from "../../components/AdminPageTitle.jsx";
import NotificationsDrawer from "../../components/EnvironmentNotificationsDrawer.jsx";
import EmptyState from "../../components/ui/EmptyState/EmptyState.jsx";
import Loader from "../../components/ui/Loader/Loader.jsx";
import { useDashboardNavigation } from "../../hooks/useDashboardNavigation.js";
import InternalDashboardLayout from "../../layouts/InternalDashboardLayout.jsx";
import { formatFileUploadDate, formatStorage } from "../../utils/fileMetrics.js";

// La gestión de archivos no ofrece accesos a proyectos recientes en la navegación.
const NO_PROJECT_SHORTCUTS = [];
const NUMBER_FORMATTER = new Intl.NumberFormat("es-VE");

/**
 * Presenta las métricas de archivos dentro del shell interno compartido.
 * La expansión responsive del riel pertenece a useDashboardNavigation.
 *
 * @returns {import("react").ReactElement} Vista administrativa de archivos.
 */
function AdminFilesPage() {
  const { user } = useAuth();
  const currentUser = getUserDisplay(user);
  const navigation = useDashboardNavigation({ projectRows: NO_PROJECT_SHORTCUTS, roleCode: "admin" });
  const { isNotificationsDrawerOpen, setIsNotificationsDrawerOpen } = navigation;
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [requestKey, setRequestKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setLoading(true);
        setError("");
      }
    });

    api.admin.getDashboardMetrics({ signal: controller.signal })
      .then((response) => setMetrics(response?.metrics?.files || null))
      .catch((requestError) => {
        if (requestError?.name !== "AbortError") {
          setError(requestError?.message || "No se pudieron cargar las métricas de archivos.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [requestKey]);

  return (
    <InternalDashboardLayout
      currentUser={currentUser}
      navigation={navigation}
      activeItemId="files"
      showGreeting={false}
      onNotificationsToggle={() => setIsNotificationsDrawerOpen((open) => !open)}
    >
      <section className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col px-[16px] pb-[48px] sm:px-[24px] lg:px-[48px]" aria-labelledby="admin-files-title">
        <header className="pb-[24px]">
          <AdminPageTitle id="admin-files-title">Gestión de archivos</AdminPageTitle>
        </header>

        <div className="flex min-h-[98px] w-full flex-wrap content-center items-center gap-y-[16px] border-y border-[var(--color-neutral-200)] py-[24px]" aria-label="Métricas de archivos">
          {loading ? (
            <Loader preset="adminUserMetrics" label="Cargando métricas de archivos" />
          ) : error ? (
            <EmptyState
              title="No se pudieron cargar las métricas"
              description={error}
              size="S"
              showFeaturedIcon={false}
              showActions
              showSecondaryAction={false}
              primaryActionLabel="Reintentar"
              onPrimaryAction={() => setRequestKey((key) => key + 1)}
              className="min-h-[160px] w-full"
            />
          ) : (
            <>
              <AdminKpiMetric
                label="Archivos totales"
                value={NUMBER_FORMATTER.format(metrics?.total || 0)}
                iconType="Accent"
                icon={<DocumentText size="24" variant="Linear" color="currentColor" />}
              />
              <AdminKpiMetric
                label="Espacio Usado"
                value={formatStorage(metrics?.totalBytes, { maximumFractionDigits: 2 })}
                iconType="Info"
                icon={<CloudConnection size="24" variant="Linear" color="currentColor" />}
              />
              <AdminKpiMetric
                label="Última carga"
                value={formatFileUploadDate(metrics?.latestUploadAt)}
                iconType="Warning"
                icon={<DocumentUpload size="24" variant="Linear" color="currentColor" />}
              />
            </>
          )}
        </div>
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
