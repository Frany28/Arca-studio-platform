import { useCallback } from "react";
import { useLocation, useParams } from "react-router-dom";

import { loadAdminProjectRequestForm } from "../../api/adminProjectRequestDetail.js";
import { useAuth } from "../../auth/AuthContext.jsx";
import { getUserDisplay } from "../../auth/userDisplay.js";
import NotificationsDrawer from "../../components/EnvironmentNotificationsDrawer.jsx";
import Breadcrumb from "../../components/ui/Breadcrumb/Breadcrumb.jsx";
import EmptyState from "../../components/ui/EmptyState/EmptyState.jsx";
import Loader from "../../components/ui/Loader/Loader.jsx";
import { useDashboardNavigation } from "../../hooks/useDashboardNavigation.js";
import InternalDashboardLayout from "../../layouts/InternalDashboardLayout.jsx";
import { getAdminProjectRequestPath, parseProjectRequestId } from "../../utils/projectRequestRoutes.js";
import { getAdminProjectRequestFailure, getRequestReturnTarget } from "../admin-project-request/utils/adminProjectRequestView.js";
import useProjectRequestDetail from "../project-request/hooks/useProjectRequestDetail.js";
import AdminProjectRequestEditForm from "./components/AdminProjectRequestEditForm.jsx";

// La edición no ofrece accesos a proyectos recientes en la navegación lateral.
const NO_PROJECT_SHORTCUTS = [];

/**
 * «Editar solicitud» del administrador (`/solicitudes-proyecto/:id/editar`): el formulario de
 * creación de solicitudes en modo edición, dentro de la navegación administrativa (riel y
 * breadcrumb internos, nunca la navegación del cliente). Lee la solicitud por ID y muestra
 * `Loader preset="projectRequestForm"` hasta recibirla; solo entonces monta el formulario con los
 * datos reales. Un ID inválido o inexistente, la falta de permisos o un fallo de conexión usan
 * los mismos estados que la consulta administrativa; una solicitud cuyo estado ya no admite
 * edición (con decisión o devuelta al cliente) se explica y enlaza a su consulta.
 *
 * Al guardar vuelve a la consulta (con `replace`, para que «Atrás» no regrese al formulario) y
 * le pasa el aviso de cambios guardados; la consulta y los listados leen el estado vigente.
 *
 * @returns {import("react").ReactElement} Página de edición.
 */
function AdminProjectRequestEditPage() {
  const { user } = useAuth();
  const currentUser = getUserDisplay(user);
  const navigation = useDashboardNavigation({ projectRows: NO_PROJECT_SHORTCUTS, roleCode: "admin" });
  const { isNotificationsDrawerOpen, navigate, setIsNotificationsDrawerOpen } = navigation;
  const location = useLocation();
  const params = useParams();
  const projectRequestId = parseProjectRequestId(params.projectRequestId);
  const returnTarget = getRequestReturnTarget(location.state);
  const detailPath = projectRequestId === null ? returnTarget.to : getAdminProjectRequestPath(projectRequestId);
  const sessionScope = user?.id ?? user?.email ?? null;
  // Lector deduplicado del formulario editable, estable mientras no cambie la sesión (como la consulta).
  const fetchProjectRequest = useCallback(
    (id, options) => loadAdminProjectRequestForm(id, { ...options, scopeKey: sessionScope }),
    [sessionScope],
  );
  const detail = useProjectRequestDetail({
    enabled: projectRequestId !== null,
    fetchProjectRequest,
    projectRequestId,
  });
  const projectRequest = detail.projectRequest;

  /**
   * Abre la consulta de la solicitud conservando el contexto de regreso.
   *
   * @param {Object} [options] - Opciones de navegación.
   * @param {boolean} [options.replace=false] - Sustituye la entrada del historial.
   * @param {Object} [options.state] - Estado adicional para la consulta.
   * @returns {void}
   */
  const openDetail = ({ replace = false, state = {} } = {}) => {
    navigate(detailPath, { replace, state: { ...(location.state || {}), ...state } });
  };

  let content;
  if (detail.loading) {
    content = <Loader preset="projectRequestForm" label="Cargando solicitud" />;
  } else if (!projectRequest) {
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
  } else if (!projectRequest.editable) {
    content = (
      <EmptyState
        className="min-h-[320px] w-full max-w-[850px]"
        data-state="not-editable"
        title="Esta solicitud ya no se puede editar"
        description="Solo se editan solicitudes pendientes de evaluación o revisión. Esta ya tiene una decisión o está en manos del cliente."
        size="M"
        showFeaturedIcon
        showActions
        showSecondaryAction={false}
        primaryActionLabel="Ver solicitud"
        onPrimaryAction={() => openDetail({ replace: true })}
      />
    );
  } else {
    content = (
      <AdminProjectRequestEditForm
        // Una versión nueva (recarga tras un conflicto) vuelve a inicializar el formulario.
        key={`${projectRequest.id}-${projectRequest.updatedAt}`}
        projectRequest={projectRequest}
        onCancel={() => openDetail()}
        onReload={detail.reload}
        onSaved={(result) => openDetail({
          replace: true,
          state: { projectRequestSaved: { changedFields: result?.changedFields || [], id: Date.now() } },
        })}
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
      <section
        aria-label="Editar solicitud de proyecto"
        className="content-reveal mx-auto flex w-full max-w-[1200px] flex-1 flex-col px-[16px] pb-[48px] min-[768px]:px-[24px] min-[1024px]:px-[48px]"
      >
        <Breadcrumb
          className="w-full pb-[12px]"
          items={[
            { label: returnTarget.label, to: returnTarget.to },
            ...(projectRequestId === null ? [] : [{ label: "Solicitud", to: detailPath }]),
            { label: "Editar" },
          ]}
        />
        <div className="flex w-full flex-1 flex-col items-center gap-[48px]">{content}</div>
      </section>
      <NotificationsDrawer
        open={isNotificationsDrawerOpen}
        onClose={() => setIsNotificationsDrawerOpen(false)}
        recentActivity={[]}
      />
    </InternalDashboardLayout>
  );
}

export default AdminProjectRequestEditPage;
