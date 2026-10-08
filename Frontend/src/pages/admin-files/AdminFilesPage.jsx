import { useEffect, useMemo, useState } from "react";
import { CloudConnection, DocumentText, DocumentUpload } from "iconsax-react";
import { useNavigate } from "react-router-dom";

import { api } from "../../api/http.js";
import { useAuth } from "../../auth/AuthContext.jsx";
import { getUserDisplay } from "../../auth/userDisplay.js";
import AdminKpiMetric from "../../components/AdminKpiMetric.jsx";
import NavigationBar from "../../components/EnvironmentNavigationBar.jsx";
import NotificationsDrawer from "../../components/EnvironmentNotificationsDrawer.jsx";
import EmptyState from "../../components/ui/EmptyState/EmptyState.jsx";
import Loader from "../../components/ui/Loader/Loader.jsx";
import ResponsiveSideNavigation from "../../components/ui/SideNavigation/ResponsiveSideNavigation.jsx";
import useMobileNavigationDrawer from "../../components/ui/SideNavigation/hooks/useMobileNavigationDrawer.js";
import { formatFileUploadDate, formatStorage } from "../../utils/fileMetrics.js";
import { createUserSideNavigationItems } from "../../utils/sideNavigationItems.js";

const WEB_BREAKPOINT_PX = 1280;
const NUMBER_FORMATTER = new Intl.NumberFormat("es-VE");

/**
 * Presenta las métricas de archivos con navegación administrativa compartida.
 * El breakpoint define solo la expansión inicial; redimensionar conserva la elección manual.
 *
 * @returns {import("react").ReactElement} Vista administrativa de archivos.
 */
function AdminFilesPage() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const currentUser = getUserDisplay(user);
  const mobileNavigation = useMobileNavigationDrawer();
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth >= WEB_BREAKPOINT_PX,
  );
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [requestKey, setRequestKey] = useState(0);
  const navigationItems = useMemo(() => createUserSideNavigationItems([], "admin"), []);

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
    <main className="h-screen overflow-hidden bg-[var(--color-neutral-bg)] transition-colors duration-200">
      <div className="flex h-full min-h-0 w-full items-stretch">
        <ResponsiveSideNavigation
          mobileOpen={mobileNavigation.isOpen}
          onMobileClose={mobileNavigation.close}
          activeItemId="files"
          expanded={isSidebarExpanded}
          items={navigationItems}
          newOpportunityLabel="Nuevo proyecto"
          userName={currentUser.name}
          userEmail={currentUser.email}
          userAvatarSrc={currentUser.profilePhotoUrl}
          onExpandedChange={setIsSidebarExpanded}
          onItemSelect={(item) => item?.to && navigate(item.to)}
          onNewOpportunityClick={() => navigate("/dashboard-arquitecto/nuevo-proyecto")}
          onLogoutClick={() => { logout(); navigate("/"); }}
          className="h-screen shrink-0 self-stretch"
        />

        <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
          <NavigationBar
            onMenuClick={mobileNavigation.open}
            mobileMenuExpanded={mobileNavigation.isOpen}
            utilityActionActive={isNotificationsOpen}
            onUtilityActionClick={() => setIsNotificationsOpen((open) => !open)}
          />

          <section className="mx-auto flex min-h-0 w-full max-w-[1200px] flex-1 flex-col px-[16px] pb-[48px] sm:px-[24px] lg:px-[48px]" aria-labelledby="admin-files-title">
            <header className="pb-[24px]">
              <h1 id="admin-files-title" className="text-heading-3 m-0 text-[var(--color-text-50)] max-sm:text-[40px] max-sm:leading-[48px]">
                Gestión de archivos
              </h1>
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
            open={isNotificationsOpen}
            onClose={() => setIsNotificationsOpen(false)}
            recentActivity={[]}
          />
        </div>
      </div>
    </main>
  );
}

export default AdminFilesPage;
