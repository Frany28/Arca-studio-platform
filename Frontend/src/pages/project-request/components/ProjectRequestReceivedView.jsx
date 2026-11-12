import Button from "../../../components/ui/Button/Button.jsx";
import ProgressBarLabel from "../../../components/ui/ProgressBarLabel/ProgressBarLabel.jsx";
import { getCompatibilityPresentation } from "../../../utils/projectRequestCompatibility.js";
import { PROJECT_REQUEST_FOOTER_CLASS_NAME } from "../utils/projectRequestLayout.js";
import { ProjectRequestCurrentStages, ProjectRequestSectionDivider } from "./ProjectRequestProgressParts.jsx";

const COMPATIBILITY_FILL = {
  Success: "bg-[var(--color-success-200)]",
  Warning: "bg-[var(--color-warning-200)]",
  Danger: "bg-[var(--color-danger-200)]",
  Accent: "bg-[var(--color-accent-300)]",
};

/**
 * «Solicitud recibida» (Figma 3727:543692): seguimiento mientras la solicitud está en evaluación
 * (`pending_verification` o `pending_review`). Muestra el porcentaje real de compatibilidad y las
 * etapas compartidas con la consulta administrativa, sin adelantar hitos futuros. No presenta
 * aprobaciones, rechazos ni motivos: la decisión pertenece a «Estado de la solicitud»
 * (`ProjectRequestStatusView`). Las observaciones del algoritmo de compatibilidad son internas de
 * la revisión: el backend no las envía al cliente y esta vista no las muestra aunque una respuesta
 * las incluya.
 * @param {Object} props - Evaluación, solicitud vigente y acciones de consulta y regreso.
 * @returns {import("react").ReactElement} Confirmación responsive de la solicitud.
 */
function ProjectRequestReceivedView({ compatibility, onBackToDashboard, onViewRequest, projectRequest }) {
  const evaluation = getCompatibilityPresentation(compatibility);
  return (
    <div className="content-reveal mx-auto flex w-full max-w-[1200px] flex-col items-center gap-[48px] px-[16px] pb-[48px] min-[768px]:px-[24px] min-[1024px]:px-[48px]">
      <header className="flex w-full max-w-[850px] flex-col gap-[4px]">
        <h1 className="font-sans text-[32px] font-bold leading-[38px] tracking-[-1px] text-[var(--color-text-50)] min-[768px]:text-[48px] min-[768px]:leading-[58px]">
          Solicitud recibida
        </h1>
        <p className="text-body-1 text-[var(--color-text-200)]">
          Hemos completado una evaluación preliminar de tu proyecto.
        </p>
      </header>

      <ProjectRequestSectionDivider />

      <section aria-labelledby="received-compatibility-title" className="flex w-full max-w-[850px] flex-wrap items-start justify-between gap-x-[24px] gap-y-[48px]">
        <h2 id="received-compatibility-title" className="text-heading-7 text-[var(--color-text-200)]">
          Compatibilidad con nuestros servicios
        </h2>

        <div className="flex w-[445px] min-w-[min(100%,343px)] max-w-full flex-col gap-[16px]">
          <div className="w-full max-w-[428px]">
            {evaluation ? (
              <ProgressBarLabel
                animated
                title={evaluation.label}
                value={evaluation.score}
                position="side"
                valueLabel={`${evaluation.score}%`}
                sublabel={evaluation.theme === "Success"
                  ? "La información proporcionada indica una alta compatibilidad con los servicios de ARCAstudio. Nuestro equipo realizará una revisión detallada para preparar los siguientes pasos del proceso."
                  : "Este resultado mide la preparación y coherencia inicial de la solicitud. Nuestro equipo realizará la revisión definitiva."}
                fillClassName={COMPATIBILITY_FILL[evaluation.theme]}
                className="min-w-full"
                aria-label={`Compatibilidad con nuestros servicios: ${evaluation.score}%`}
              />
            ) : (
              <p className="text-body-3 text-[var(--color-text-100)]">Evaluación de compatibilidad pendiente.</p>
            )}
          </div>
        </div>
      </section>

      <ProjectRequestSectionDivider />

      <ProjectRequestCurrentStages status={projectRequest?.status} />

      <ProjectRequestSectionDivider />

      <p className="w-full max-w-[850px] text-body-2 text-[var(--color-text-100)]">
        Nuestro equipo revisará la información y se comunicará contigo en un plazo de 24–48 horas hábiles.
      </p>

      <footer className={PROJECT_REQUEST_FOOTER_CLASS_NAME}>
        <Button
          theme="Primary"
          type="Outline"
          size="M"
          fitContent
          showLeftIcon={false}
          showRightIcon={false}
          className="!w-full min-[480px]:!w-auto"
          onClick={onViewRequest}
        >
          Ver solicitud
        </Button>
        <Button
          theme="Primary"
          type="Solid"
          size="M"
          fitContent
          showLeftIcon={false}
          showRightIcon={false}
          className="!w-full min-[480px]:!w-auto"
          onClick={onBackToDashboard}
        >
          Volver al Dashboard
        </Button>
      </footer>
    </div>
  );
}

export default ProjectRequestReceivedView;
