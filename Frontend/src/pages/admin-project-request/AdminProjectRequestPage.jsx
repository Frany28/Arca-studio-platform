import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";

import { loadAdminProjectRequest } from "../../api/adminProjectRequestDetail.js";
import { useAuth } from "../../auth/AuthContext.jsx";
import { getUserDisplay } from "../../auth/userDisplay.js";
import NotificationsDrawer from "../../components/EnvironmentNotificationsDrawer.jsx";
import ProjectRequestWorkflowModal from "../../components/project-requests/ProjectRequestWorkflowModal.jsx";
import AlertToast from "../../components/ui/AlertToast/AlertToast.jsx";
import Breadcrumb from "../../components/ui/Breadcrumb/Breadcrumb.jsx";
import EmptyState from "../../components/ui/EmptyState/EmptyState.jsx";
import Loader from "../../components/ui/Loader/Loader.jsx";
import { useDashboardNavigation } from "../../hooks/useDashboardNavigation.js";
import InternalDashboardLayout from "../../layouts/InternalDashboardLayout.jsx";
import { getAdminProjectRequestActions } from "../../utils/projectRequestAdminActions.js";
import { parseProjectRequestId } from "../../utils/projectRequestRoutes.js";
import { getProjectPath } from "../../utils/projectRoutes.js";
import AdminRequestDetailsDrawer from "../admin-dashboard/components/admin-request-details/index.js";
import { useAdminRequestClient } from "../admin-dashboard/hooks/useAdminRequestClient.js";
import { buildAdminRequestDetails } from "../admin-dashboard/utils/adminRequestDetails.js";
import { getQuoteCreatePathForProject } from "../admin-services-quotes/utils/servicesQuotesTabs.js";
import ProjectRequestSummaryContent from "../project-request/components/ProjectRequestSummaryContent.jsx";
import useProjectRequestDetail from "../project-request/hooks/useProjectRequestDetail.js";
import ProjectOverviewHeader from "../projects/components/ProjectOverviewHeader.jsx";
import AdminProjectRequestActionBar from "./components/AdminProjectRequestActionBar.jsx";
import AdminProjectRequestMetrics from "./components/AdminProjectRequestMetrics.jsx";
import AdminProjectRequestTeam from "./components/AdminProjectRequestTeam.jsx";
import { useAdminProjectRequestDecision } from "./hooks/useAdminProjectRequestDecision.js";
import { useAdminProjectRequestSync } from "./hooks/useAdminProjectRequestSync.js";
import {
  buildAdminProjectRequestHeader,
  buildAdminProjectRequestMetrics,
  buildAdminRequestTeam,
  getAdminProjectRequestFailure,
  getRequestReturnTarget,
} from "./utils/adminProjectRequestView.js";

// La consulta no ofrece accesos a proyectos recientes en la navegación lateral.
const NO_PROJECT_SHORTCUTS = [];

/**
 * Consulta administrativa de una solicitud de proyecto (Figma 3727:687188, variantes de
 * escritorio, tablet y móvil). Lee la solicitud por ID del backend con su estado vigente,
 * indicadores del algoritmo 3.3, adjuntos, responsables y revisiones; el drawer «Detalles de
 * Solicitud» del dashboard se reutiliza como resumen y recomendación, y solo entonces se
 * consultan los datos del cliente. Admite enlaces directos y vuelve al contexto de origen.
 * Cada visita lee el estado vigente; al volver a la pestaña o recuperar la conexión se
 * revalida en segundo plano y se avisa de los cambios hechos por otras personas.
 *
 * La barra inferior ofrece las acciones que permite el estado (`getAdminProjectRequestActions`):
 * las decisiones abren el modal de decisión compartido con el dashboard, que exige el motivo y
 * la confirmación antes de llamar a la API; una solicitud convertida ofrece su proyecto y
 * «Crear cotización», que abre el editor de cotizaciones existente con el proyecto y su cliente.
 *
 * Al volver de «Editar solicitud» tras guardar (`location.state.projectRequestSaved`) confirma los
 * cambios con un aviso; el estado de navegación se limpia para que recargar no lo repita.
 *
 * @returns {import("react").ReactElement} Página de la solicitud.
 */
function AdminProjectRequestPage() {
  const { user } = useAuth();
  const currentUser = getUserDisplay(user);
  const navigation = useDashboardNavigation({ projectRows: NO_PROJECT_SHORTCUTS, roleCode: "admin" });
  const { isNotificationsDrawerOpen, navigate, setIsNotificationsDrawerOpen } = navigation;
  const location = useLocation();
  const params = useParams();
  const projectRequestId = parseProjectRequestId(params.projectRequestId);
  const returnTarget = getRequestReturnTarget(location.state);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [savedNotice, setSavedNotice] = useState(() => location.state?.projectRequestSaved || null);
  const hasSavedNoticeState = Boolean(location.state?.projectRequestSaved);
  // El aviso ya se copió al estado local: se retira del historial para que una recarga no lo muestre.
  useEffect(() => {
    if (!hasSavedNoticeState) return;
    const { projectRequestSaved: _saved, ...state } = location.state;
    navigate(location.pathname, { replace: true, state });
  }, [hasSavedNoticeState, location.pathname, location.state, navigate]);
  const sessionScope = user?.id ?? user?.email ?? null;
  // Lector deduplicado del endpoint administrativo (nunca el del propietario), estable mientras
  // no cambie la sesión: un cambio de usuario vuelve a leer en lugar de reutilizar la lectura.
  const fetchProjectRequest = useCallback(
    (id, options) => loadAdminProjectRequest(id, { ...options, scopeKey: sessionScope }),
    [sessionScope],
  );
  const detail = useProjectRequestDetail({
    enabled: projectRequestId !== null,
    fetchProjectRequest,
    projectRequestId,
  });
  const projectRequest = detail.projectRequest;
  const sync = useAdminProjectRequestSync({ hasProjectRequest: Boolean(projectRequest), revalidate: detail.revalidate });
  const decision = useAdminProjectRequestDecision({
    applyConfirmedChange: detail.applyConfirmedChange,
    revalidate: detail.revalidate,
    revalidateWithFeedback: sync.revalidate,
  });
  const drawerDetails = useMemo(
    () => (projectRequest ? buildAdminRequestDetails({ queueRequest: projectRequest, summary: projectRequest }) : null),
    [projectRequest],
  );
  const client = useAdminRequestClient({ enabled: summaryOpen, userId: projectRequest?.requestedBy ?? null });

  let content;
  let actionBar = null;
  if (detail.loading) {
    content = <Loader preset="adminProjectRequest" label="Cargando solicitud" />;
  } else if (!projectRequest) {
    // Sin ID válido no se consulta la API: el enlace se trata como una solicitud inexistente.
    const failure = getAdminProjectRequestFailure(
      projectRequestId === null ? { errorStatus: 404 } : { error: detail.error, errorStatus: detail.errorStatus },
    );
    content = (
      <EmptyState
        className="min-h-[320px] w-full max-w-[850px]"
        data-state={failure.kind}
        title={failure.title}
        description={failure.description}
        size="M"
        showFeaturedIcon
        showActions
        showSecondaryAction={failure.canRetry}
        primaryActionLabel={failure.canRetry ? "Reintentar" : `Volver a ${returnTarget.label}`}
        secondaryActionLabel={`Volver a ${returnTarget.label}`}
        onPrimaryAction={failure.canRetry ? detail.reload : () => navigate(returnTarget.to)}
        onSecondaryAction={() => navigate(returnTarget.to)}
      />
    );
  } else {
    const header = buildAdminProjectRequestHeader(projectRequest);
    const team = buildAdminRequestTeam(projectRequest);
    const actions = getAdminProjectRequestActions(projectRequest);
    const { convertedProject } = actions;

    content = (
      <>
        <ProjectOverviewHeader
          project={header.project}
          indicator={header.indicator}
          maxStages={5}
          focusActiveStageOnMobile
          variant="request"
        />
        <AdminProjectRequestMetrics {...buildAdminProjectRequestMetrics(projectRequest)} />
        {/* Bloque de Figma (3727:687225) y, separada, la gestión administrativa con datos reales. */}
        <ProjectRequestSummaryContent projectRequest={projectRequest} variant="admin" />
        <AdminProjectRequestTeam assignees={team.assignees} outdatedNotice={team.outdatedNotice} reviews={team.reviews} status={team.status} />
      </>
    );
    actionBar = (
      <AdminProjectRequestActionBar
        decisions={actions.decisions}
        onDecision={(action) => decision.open(projectRequest, { initialAction: action })}
        onOpenSummary={() => setSummaryOpen(true)}
        onOpenProject={convertedProject ? () => navigate(getProjectPath(convertedProject)) : null}
        onCreateQuote={actions.canCreateQuote ? () => navigate(getQuoteCreatePathForProject(convertedProject.id)) : null}
      />
    );
  }

  return (
    <InternalDashboardLayout
      currentUser={currentUser}
      navigation={navigation}
      activeItemId="projects"
      showGreeting={false}
      onNotificationsToggle={() => setIsNotificationsDrawerOpen((open) => !open)}
    >
      {/* Figma: breadcrumb con 12 px inferiores y contenido con separación de 48 px. */}
      <section
        aria-label="Solicitud de proyecto"
        className="content-reveal mx-auto flex w-full max-w-[1200px] flex-1 flex-col px-[16px] min-[768px]:px-[24px] min-[1024px]:px-[48px]"
      >
        <Breadcrumb
          className="w-full pb-[12px]"
          items={[{ label: returnTarget.label, to: returnTarget.to }, { label: "Solicitud" }]}
        />
        <div className="flex w-full flex-1 flex-col items-center gap-[48px]">{content}</div>
      </section>
      {/* Hija directa del contenedor de scroll del layout: la barra ocupa todo su ancho, como la
          superficie de Figma (3727:687292), y queda fija al pie mientras se desplaza el contenido. */}
      {actionBar}

      <AdminRequestDetailsDrawer
        open={summaryOpen && Boolean(drawerDetails)}
        status="ready"
        details={drawerDetails}
        client={client}
        showActions={false}
        onClose={() => setSummaryOpen(false)}
        onRetryQueue={detail.reload}
      />
      <ProjectRequestWorkflowModal
        // Cada apertura reinicia la acción preseleccionada y el borrador del modal.
        key={decision.selectedRequest ? `${decision.selectedRequest.id}-${decision.initialAction}` : "closed-request-decision"}
        completedAction={decision.completedAction}
        error={decision.error}
        initialAction={decision.initialAction}
        mode="decision"
        open={Boolean(decision.selectedRequest)}
        projectRequest={decision.selectedRequest}
        submitting={decision.submitting}
        onClose={decision.close}
        onSubmit={decision.submit}
      />
      <NotificationsDrawer
        open={isNotificationsDrawerOpen}
        onClose={() => setIsNotificationsDrawerOpen(false)}
        recentActivity={[]}
      />
      {sync.feedback ? (
        <AlertToast
          trigger={sync.feedback.id}
          theme={sync.feedback.theme}
          title={sync.feedback.title}
          content={sync.feedback.content}
          description={sync.feedback.description}
          showActions={Boolean(sync.feedback.canRetry)}
          secondaryActionLabel="Ahora no"
          primaryActionLabel="Reintentar"
          onPrimaryAction={sync.revalidate}
          onDismiss={() => sync.dismissFeedback(sync.feedback.id)}
          aria-label={sync.feedback.title}
        />
      ) : null}
      {savedNotice ? (
        <AlertToast
          trigger={savedNotice.id}
          theme="Success"
          title="Solicitud actualizada"
          description={savedNotice.changedFields?.length
            ? "Se guardaron los cambios. El estado de la solicitud no cambió."
            : "No había cambios que guardar. La solicitud no se modificó."}
          onDismiss={() => setSavedNotice(null)}
          aria-label="Solicitud actualizada"
        />
      ) : null}
      {decision.feedback ? (
        <AlertToast
          trigger={decision.feedback.id}
          theme={decision.feedback.theme}
          title={decision.feedback.title}
          content={decision.feedback.content}
          description={decision.feedback.description}
          onDismiss={() => decision.dismissFeedback(decision.feedback.id)}
          aria-label={decision.feedback.title}
        />
      ) : null}
    </InternalDashboardLayout>
  );
}

export default AdminProjectRequestPage;
