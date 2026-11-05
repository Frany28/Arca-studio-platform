import Button from "../../../components/ui/Button/Button.jsx";
import EmptyState from "../../../components/ui/EmptyState.jsx";
import Loader from "../../../components/ui/Loader/Loader.jsx";
import { FormDivider } from "./ProjectRequestFormFields.jsx";
import ProjectRequestSummaryContent from "./ProjectRequestSummaryContent.jsx";
import { PROJECT_REQUEST_FOOTER_CLASS_NAME } from "../utils/projectRequestLayout.js";

/**
 * Consulta de solo lectura de una solicitud enviada (Figma «Solicitud de proyecto», Variant15).
 * Muestra la información registrada, el estado real y los adjuntos persistidos que devuelve
 * el backend; no ofrece controles de edición. «Ver estado» vuelve al progreso de la solicitud.
 *
 * @param {Object} props - Solicitud, estado de carga y acciones de navegación.
 * @param {Object|null} props.projectRequest - Solicitud con `files` leída de la API.
 * @param {boolean} props.loading - Lectura en curso.
 * @param {string} props.error - Error de la lectura.
 * @param {Function} props.onRetry - Reintenta la lectura.
 * @param {Function} props.onViewStatus - Muestra el estado de la solicitud.
 * @param {Function} props.onBackToDashboard - Navega al dashboard del rol.
 * @returns {import("react").ReactElement} Vista de consulta.
 */
function ProjectRequestSummaryView({ error, loading, onBackToDashboard, onRetry, onViewStatus, projectRequest }) {
  let content;
  if (loading) {
    content = <Loader preset="adminRequestDetails" label="Cargando solicitud" className="w-full max-w-[850px]" />;
  } else if (error || !projectRequest) {
    content = (
      <EmptyState
        className="min-h-[320px] w-full max-w-[850px]"
        title="No pudimos cargar la solicitud"
        description={error || "La solicitud no está disponible."}
        size="M"
        showFeaturedIcon
        showActions
        showSecondaryAction={false}
        primaryActionLabel="Reintentar"
        onPrimaryAction={onRetry}
      />
    );
  } else {
    content = <ProjectRequestSummaryContent projectRequest={projectRequest} />;
  }

  return (
    <div className="content-reveal mx-auto flex w-full max-w-[1200px] flex-col items-center gap-[48px] px-[16px] pb-[48px] min-[768px]:px-[24px] min-[1024px]:px-[48px]">
      <header className="flex w-full max-w-[850px] flex-col gap-[4px]">
        <h1 className="text-[32px] font-bold leading-[38px] tracking-[-1px] text-[var(--color-text-50)] min-[768px]:text-[48px] min-[768px]:leading-[58px]">
          Solicitud de proyecto
        </h1>
        <p className="text-[14px] leading-[17px] tracking-[-0.5px] text-[var(--color-text-200)] min-[768px]:text-[18px] min-[768px]:leading-[21px]">
          Cada proyecto merece ser el correcto.
        </p>
      </header>

      <FormDivider />

      {content}

      <FormDivider />

      <footer className={PROJECT_REQUEST_FOOTER_CLASS_NAME}>
        <Button theme="Primary" type="Outline" size="M" fitContent showLeftIcon={false} showRightIcon={false} className="!w-full min-[480px]:!w-auto" onClick={onViewStatus}>
          Ver estado
        </Button>
        <Button theme="Primary" type="Solid" size="M" fitContent showLeftIcon={false} showRightIcon={false} className="!w-full min-[480px]:!w-auto" onClick={onBackToDashboard}>
          Volver al Dashboard
        </Button>
      </footer>
    </div>
  );
}

export default ProjectRequestSummaryView;
