import { useMemo, useState } from "react";
import { Add, Buildings2, ClipboardTick, Convertshape, MessageNotif } from "iconsax-react";
import { useAuth } from "../../auth/AuthContext.jsx";
import { getUserDisplay } from "../../auth/userDisplay.js";
import AdminPageTitle from "../../components/AdminPageTitle.jsx";
import AdminKpiMetric from "../../components/AdminKpiMetric.jsx";
import NotificationsDrawer from "../../components/EnvironmentNotificationsDrawer.jsx";
import Button from "../../components/ui/Button/Button.jsx";
import HintText from "../../components/ui/HintText/HintText.jsx";
import Loader from "../../components/ui/Loader/Loader.jsx";
import { useDashboardNavigation } from "../../hooks/useDashboardNavigation.js";
import { useDashboardProjects } from "../../hooks/useDashboardProjects.js";
import InternalDashboardLayout from "../../layouts/InternalDashboardLayout.jsx";
import AdminActiveProjects from "../admin-dashboard/components/admin-active-projects/index.js";
import { useAdminDashboardData } from "../admin-dashboard/hooks/useAdminDashboardData.js";
import { getProjectPath } from "../../utils/projectRoutes.js";
import { getAdminProjectMetrics } from "./utils/adminProjectMetrics.js";

const NUMBER_FORMATTER = new Intl.NumberFormat("es-VE");

/**
 * Compone Gestión de Proyectos con lecturas y tabla existentes, sin nuevas operaciones HTTP.
 * La fase inicial habilita filtros locales, selección, paginación y navegación; conserva
 * deshabilitadas las mutaciones en esta vista y deja intacto el dashboard operativo.
 * @returns {import("react").ReactElement} Página administrativa responsive con datos reales.
 */
export default function AdminProjectsPage() {
  const { user } = useAuth();
  const currentUser = getUserDisplay(user);
  const [requestKey, setRequestKey] = useState(0);
  const { projects, projectRows, projectsLoading, projectsError } = useDashboardProjects({
    empty: false, user, projectsRequestKey: requestKey,
  });
  const navigation = useDashboardNavigation({ projectRows, roleCode: currentUser.roleCode });
  const { navigate, isNotificationsDrawerOpen, setIsNotificationsDrawerOpen } = navigation;
  const { adminMetrics, adminMetricsLoading, adminMetricsError } = useAdminDashboardData({
    empty: false, user, roleCode: currentUser.roleCode,
    adminMetricsRequestKey: requestKey, adminOverviewRequestKey: 0,
    loadOverview: false, loadAssignees: false,
  });
  const metrics = useMemo(() => getAdminProjectMetrics(projects), [projects]);
  const display = (value) => value === null || value === undefined ? "—" : NUMBER_FORMATTER.format(value);
  return (
    <InternalDashboardLayout
      currentUser={currentUser} navigation={navigation} activeItemId="projects" showGreeting={false}
      onNotificationsToggle={() => setIsNotificationsDrawerOpen((open) => !open)}
    >
      <section className="@container mx-auto flex w-full max-w-[1200px] flex-col gap-[16px] px-[16px] sm:px-[24px] lg:px-[48px]" aria-labelledby="admin-projects-title">
        <div className="flex flex-wrap items-center justify-between gap-[12px] max-[767px]:flex-col max-[767px]:items-start">
          <AdminPageTitle id="admin-projects-title">Gestión de proyectos</AdminPageTitle>
          <Button theme="Primary" type="Solid" size="M" fitContent showLeftIcon iconLeft={<Add size="20" color="currentColor" />} showRightIcon={false} onClick={() => navigate("/dashboard-arquitecto/nuevo-proyecto")}>Nuevo</Button>
        </div>
        {projectsLoading || adminMetricsLoading ? (
          <Loader preset="adminUserMetrics" variant="projects" label="Cargando indicadores de proyectos" />
        ) : (
          <div className="flex w-full flex-wrap items-center gap-x-[16px] gap-y-[16px] border-y border-[var(--color-neutral-200)] py-[24px] @min-[940px]:gap-x-0 max-[767px]:flex-col max-[767px]:items-start" aria-label="Indicadores de proyectos">
            <AdminKpiMetric variant="projects" label="Proyectos totales" value={display(projectsError ? null : metrics.total)} iconType="Accent" icon={<Buildings2 size="24" color="currentColor" />} />
            <AdminKpiMetric variant="projects" label="Proyectos en progreso" value={display(projectsError ? null : metrics.inProgress)} iconType="Info" icon={<Convertshape size="24" color="currentColor" />} />
            <AdminKpiMetric variant="projects" label="Proyectos finalizados" value={display(projectsError ? null : metrics.completed)} iconType="Success" icon={<ClipboardTick size="24" color="currentColor" />} />
            <AdminKpiMetric variant="projects" label="Solicitudes" value={display(adminMetrics?.requests?.total)} iconType="Warning" icon={<MessageNotif size="24" color="currentColor" />} />
          </div>
        )}
        {adminMetricsError ? <HintText state="Error" hintText={adminMetricsError} /> : null}
      </section>
      <AdminActiveProjects
        variant="management" projects={projectRows} loading={projectsLoading} error={projectsError}
        onOpenProject={(project) => navigate(getProjectPath(project))}
        onRetry={() => setRequestKey((key) => key + 1)}
      />
      <NotificationsDrawer open={isNotificationsDrawerOpen} onClose={() => setIsNotificationsDrawerOpen(false)} />
    </InternalDashboardLayout>
  );
}
