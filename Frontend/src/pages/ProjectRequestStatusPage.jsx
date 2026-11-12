import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";

import { useAuth } from "../auth/AuthContext.jsx";
import { getUserDisplay } from "../auth/userDisplay.js";
import EmptyState from "../components/ui/EmptyState.jsx";
import Loader from "../components/ui/Loader/Loader.jsx";
import useResponsiveSidebarExpansion from "../hooks/useResponsiveSidebarExpansion.js";
import { parseProjectRequestId } from "../utils/projectRequestRoutes.js";
import { isProjectRequestUnderEvaluation } from "../utils/projectRequestStatus.js";
import { getDashboardPath } from "../utils/sideNavigationItems.js";
import ProjectRequestPageShell from "./project-request/components/ProjectRequestPageShell.jsx";
import ProjectRequestReceivedView from "./project-request/components/ProjectRequestReceivedView.jsx";
import ProjectRequestStatusView from "./project-request/components/ProjectRequestStatusView.jsx";
import ProjectRequestSummaryView from "./project-request/components/ProjectRequestSummaryView.jsx";
import useProjectRequestDetail from "./project-request/hooks/useProjectRequestDetail.js";
import { navigateToSideNavigationItem } from "./project-request/hooks/useProjectRequestNavigation.js";
import useProjectRequestNotifications from "./project-request/hooks/useProjectRequestNotifications.js";
import { getClientProjectRequestFailure } from "./project-request/utils/projectRequestFailure.js";

// Contenedor común de las vistas de seguimiento para la carga y los errores.
const STATUS_CONTAINER_CLASS_NAME = "content-reveal mx-auto flex w-full max-w-[1200px] flex-col items-center gap-[48px] px-[16px] pb-[48px] min-[768px]:px-[24px] min-[1024px]:px-[48px]";

/**
 * Consulta persistente de una solicitud del cliente (`/solicitudes/:projectRequestId`).
 *
 * Identifica la solicitud por el id de la URL y la lee del backend (`GET /project-requests/:id`,
 * que solo la entrega a su propietario), sin depender del estado de navegación: sigue disponible
 * al recargar, volver del dashboard o iniciar sesión de nuevo. Elige la pantalla por el estado real:
 * - `pending_verification` y `pending_review` → «Solicitud recibida» (seguimiento, Figma 3727:543692);
 * - `converted`, `rejected` y `changes_requested` → «Estado de la solicitud» (decisión, 3727:543790);
 * - `draft` → el formulario, donde el borrador se sigue editando.
 * «Ver solicitud» abre la consulta de solo lectura con la misma lectura (sin otra petición).
 *
 * Una solicitud rechazada se conserva como historial: «Crear nueva solicitud» abre el formulario
 * precargado con sus datos, que crea un borrador nuevo sin modificar la rechazada. «Corregir
 * solicitud» reabre la misma solicitud devuelta. La navegación no pide confirmación: la vista es
 * de solo lectura y no hay datos que perder.
 *
 * @returns {import("react").ReactElement} Página de consulta de la solicitud.
 */
export default function ProjectRequestStatusPage() {
  const navigate = useNavigate();
  const { projectRequestId: rawProjectRequestId } = useParams();
  const projectRequestId = parseProjectRequestId(rawProjectRequestId);
  const { logout, user } = useAuth();
  const currentUser = getUserDisplay(user);
  const notifications = useProjectRequestNotifications({ navigate, user });
  const [isSidebarExpanded, setIsSidebarExpanded] = useResponsiveSidebarExpansion();
  const detail = useProjectRequestDetail({ enabled: projectRequestId !== null, projectRequestId });
  // Id de la solicitud cuya consulta de solo lectura está abierta. Se compara con el de la URL, de
  // modo que navegar a otra solicitud vuelve a su estado sin sincronizar con un efecto.
  const [summaryRequestId, setSummaryRequestId] = useState(null);
  const projectRequest = detail.projectRequest;
  const isSummaryOpen = summaryRequestId !== null && summaryRequestId === projectRequestId;

  const navigateToDashboard = () => navigate(getDashboardPath(currentUser.roleCode));
  // Las acciones están al pie: cada cambio de vista lleva al inicio de la nueva vista.
  const showSummary = (open) => {
    setSummaryRequestId(open ? projectRequestId : null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const handlePrimaryAction = (kind) => {
    if (kind === "viewProject") {
      navigate(`/proyectos/${projectRequest.convertedProjectId}`);
      return;
    }
    // createNew: la solicitud rechazada solo aporta datos; el formulario crea un borrador nuevo.
    // correct: la solicitud devuelta se edita y reenvía sobre su mismo id.
    navigate("/solicitudes/nueva", { state: { initialRequest: projectRequest } });
  };

  let content;
  const failure = projectRequestId === null
    ? getClientProjectRequestFailure({ errorStatus: 404 })
    : !detail.loading && (detail.error || !projectRequest)
      ? getClientProjectRequestFailure({ error: detail.error, errorStatus: detail.errorStatus })
      : null;

  if (failure) {
    content = (
      <div className={STATUS_CONTAINER_CLASS_NAME}>
        <EmptyState
          className="min-h-[320px] w-full max-w-[850px]"
          title={failure.title}
          description={failure.description}
          size="M"
          showFeaturedIcon
          showActions
          showSecondaryAction={failure.canRetry}
          primaryActionLabel={failure.canRetry ? "Reintentar" : "Volver al Dashboard"}
          onPrimaryAction={failure.canRetry ? detail.reload : navigateToDashboard}
          secondaryActionLabel="Volver al Dashboard"
          onSecondaryAction={navigateToDashboard}
          data-failure-kind={failure.kind}
        />
      </div>
    );
  } else if (detail.loading) {
    content = (
      <div className={STATUS_CONTAINER_CLASS_NAME}>
        <Loader preset="projectRequestStatus" label="Cargando solicitud" />
      </div>
    );
  } else if (projectRequest.status === "draft") {
    return <Navigate to="/solicitudes/nueva" replace state={{ initialRequest: projectRequest }} />;
  } else if (isSummaryOpen) {
    content = (
      <ProjectRequestSummaryView
        error=""
        loading={false}
        projectRequest={projectRequest}
        onRetry={detail.reload}
        onViewStatus={() => showSummary(false)}
        onBackToDashboard={navigateToDashboard}
      />
    );
  } else if (isProjectRequestUnderEvaluation(projectRequest.status)) {
    content = (
      <ProjectRequestReceivedView
        compatibility={projectRequest.compatibility}
        projectRequest={projectRequest}
        onViewRequest={() => showSummary(true)}
        onBackToDashboard={navigateToDashboard}
      />
    );
  } else {
    content = (
      <ProjectRequestStatusView
        projectRequest={projectRequest}
        onViewRequest={() => showSummary(true)}
        onBackToDashboard={navigateToDashboard}
        onPrimaryAction={handlePrimaryAction}
      />
    );
  }

  return (
    <ProjectRequestPageShell
      currentUser={currentUser}
      isSidebarExpanded={isSidebarExpanded}
      notifications={notifications}
      onItemSelect={(item) => {
        notifications.setOpen(false);
        navigateToSideNavigationItem(item, { navigate, roleCode: currentUser.roleCode });
      }}
      onLogoutClick={() => {
        logout();
        navigate("/");
      }}
      onNewOpportunityClick={() => navigate("/solicitudes/nueva")}
      onSidebarExpandedChange={setIsSidebarExpanded}
    >
      {content}
    </ProjectRequestPageShell>
  );
}
