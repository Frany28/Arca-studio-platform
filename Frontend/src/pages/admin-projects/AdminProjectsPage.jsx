import { useMemo, useState } from "react";
import { Add, Buildings2, ClipboardTick, Convertshape, MessageNotif } from "iconsax-react";
import { useAuth } from "../../auth/AuthContext.jsx";
import { getUserDisplay } from "../../auth/userDisplay.js";
import AdminPageTitle from "../../components/AdminPageTitle.jsx";
import AdminKpiMetric from "../../components/AdminKpiMetric.jsx";
import NotificationsDrawer from "../../components/EnvironmentNotificationsDrawer.jsx";
import AlertToast from "../../components/ui/AlertToast/AlertToast.jsx";
import Button from "../../components/ui/Button/Button.jsx";
import HintText from "../../components/ui/HintText/HintText.jsx";
import Loader from "../../components/ui/Loader/Loader.jsx";
import { useDashboardNavigation } from "../../hooks/useDashboardNavigation.js";
import { useDashboardProjects } from "../../hooks/useDashboardProjects.js";
import InternalDashboardLayout from "../../layouts/InternalDashboardLayout.jsx";
import AdminActiveProjects from "../admin-dashboard/components/admin-active-projects/index.js";
import { isArchivedProject } from "../admin-dashboard/components/admin-active-projects/utils/adminProjectBulkActions.js";
import { useAdminDashboardData } from "../admin-dashboard/hooks/useAdminDashboardData.js";
import { useAdminProjectMutations } from "../admin-dashboard/hooks/useAdminProjectMutations.js";
import { getProjectPath } from "../../utils/projectRoutes.js";
import ProjectArchiveModal from "./components/ProjectArchiveModal.jsx";
import ProjectSettingsModal from "./components/ProjectSettingsModal.jsx";
import { useProjectRowActions } from "./hooks/useProjectRowActions.js";
import { getAdminProjectMetrics } from "./utils/adminProjectMetrics.js";
import { getProjectRowActions } from "./utils/projectRowActions.js";

const NUMBER_FORMATTER = new Intl.NumberFormat("es-VE");

/**
 * Compone Gestión de Proyectos con las lecturas, la tabla y las mutaciones del dashboard.
 * Asignación de responsables y acciones de fila (visibilidad, archivo) reutilizan los
 * contratos HTTP existentes mediante `useAdminProjectMutations`; la tabla solo cambia
 * tras la respuesta del servidor. Edición y acciones masivas permanecen fuera de esta fase.
 * @returns {import("react").ReactElement} Página administrativa responsive con datos reales.
 */
export default function AdminProjectsPage() {
  const { user } = useAuth();
  const currentUser = getUserDisplay(user);
  const [requestKey, setRequestKey] = useState(0);
  const { projects, projectRows, projectsLoading, projectsError, setProjects } = useDashboardProjects({
    empty: false, user, projectsRequestKey: requestKey,
  });
  const navigation = useDashboardNavigation({ projectRows, roleCode: currentUser.roleCode });
  const { navigate, isNotificationsDrawerOpen, setIsNotificationsDrawerOpen } = navigation;
  const { adminMetrics, adminMetricsLoading, adminMetricsError, adminAssignees, adminAssigneesLoading } = useAdminDashboardData({
    empty: false, user, roleCode: currentUser.roleCode,
    adminMetricsRequestKey: requestKey, adminOverviewRequestKey: 0,
    loadOverview: false,
  });
  // Los indicadores de proyecto se derivan de la colección local reconciliada; Solicitudes
  // no depende de estas acciones, por eso no se refrescan métricas tras cada operación.
  const { updateProjectAssignees, runProjectAction } = useAdminProjectMutations({ setProjects });
  const rowActions = useProjectRowActions({ runProjectAction });
  const metrics = useMemo(() => getAdminProjectMetrics(projects), [projects]);
  const display = (value) => value === null || value === undefined ? "—" : NUMBER_FORMATTER.format(value);
  const { dialog } = rowActions;
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
            <AdminKpiMetric variant="projects" label="Proyectos finalizados" value={display(projectsError ? null : metrics.finished)} iconType="Success" icon={<ClipboardTick size="24" color="currentColor" />} />
            <AdminKpiMetric variant="projects" label="Solicitudes" value={display(adminMetrics?.requests?.total)} iconType="Warning" icon={<MessageNotif size="24" color="currentColor" />} />
          </div>
        )}
        {adminMetricsError ? <HintText state="Error" hintText={adminMetricsError} /> : null}
      </section>
      <AdminActiveProjects
        variant="management" projects={projectRows} loading={projectsLoading} error={projectsError}
        assignees={adminAssignees} assigneesLoading={adminAssigneesLoading}
        onProjectAssigneesChange={updateProjectAssignees}
        getProjectActions={getProjectRowActions} onProjectAction={rowActions.handleRowAction}
        onOpenProject={(project) => navigate(getProjectPath(project))}
        onRetry={() => setRequestKey((key) => key + 1)}
      />
      <ProjectSettingsModal
        open={dialog?.type === "settings" && dialog.open}
        project={dialog?.type === "settings" ? dialog.project : null}
        draft={rowActions.draft} error={rowActions.error} submitting={rowActions.submitting}
        hasPendingChanges={rowActions.hasPendingChanges}
        onSettingChange={rowActions.changeSetting} onCancel={rowActions.close} onConfirm={rowActions.confirm}
      />
      <ProjectArchiveModal
        open={dialog?.type === "archive" && dialog.open}
        project={dialog?.type === "archive" ? dialog.project : null}
        archived={dialog?.type === "archive" && isArchivedProject(dialog.project)}
        submitting={rowActions.submitting}
        onCancel={rowActions.close} onConfirm={rowActions.confirm}
      />
      {rowActions.feedback ? (
        <AlertToast
          trigger={rowActions.feedback.id} theme={rowActions.feedback.theme}
          title={rowActions.feedback.title} description={rowActions.feedback.description}
          onDismiss={rowActions.dismissFeedback} aria-label={rowActions.feedback.title}
        />
      ) : null}
      <NotificationsDrawer open={isNotificationsDrawerOpen} onClose={() => setIsNotificationsDrawerOpen(false)} />
    </InternalDashboardLayout>
  );
}
