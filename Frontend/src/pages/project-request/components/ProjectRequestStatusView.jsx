import clsx from "clsx";

import Button from "../../../components/ui/Button/Button.jsx";
import { PROJECT_REQUEST_FOOTER_CLASS_NAME } from "../utils/projectRequestLayout.js";
import { getProjectRequestDecisionPresentation } from "../utils/projectRequestDecision.js";
import { ProjectRequestCurrentStages, ProjectRequestSectionDivider } from "./ProjectRequestProgressParts.jsx";

/**
 * «Estado de la solicitud» (Figma 3727:543790): resultado de la decisión administrativa.
 * Conserva la estructura del diseño (encabezado, sección de dos columnas, «Estado actual» y pie)
 * y adapta la sección al estado real con `getProjectRequestDecisionPresentation`: aprobada
 * («Primer contacto» y el siguiente paso), rechazada («Motivo del rechazo» con el texto completo
 * del administrador) o con correcciones pendientes («Información solicitada»). El motivo se
 * muestra completo, sin truncar, conservando sus saltos de línea. Las etapas posteriores a la
 * decisión nunca se dan por realizadas.
 *
 * El pie conserva «Ver solicitud» y «Volver al Dashboard» de Figma. Cuando el estado ofrece una
 * acción propia (ver el proyecto creado, crear una solicitud nueva con los datos de la rechazada o
 * corregir la misma solicitud), esa acción pasa a ser la principal (`Solid`) y en móvil ocupa su
 * propia fila; «Volver al Dashboard» queda como secundaria.
 *
 * @param {Object} props - Solicitud vigente y acciones de navegación.
 * @param {Object} props.projectRequest - Solicitud del cliente leída de la API.
 * @param {Function} props.onViewRequest - Muestra la consulta de solo lectura.
 * @param {Function} props.onBackToDashboard - Navega al dashboard del rol.
 * @param {(kind: "viewProject"|"createNew"|"correct") => void} props.onPrimaryAction - Ejecuta la acción del estado.
 * @returns {import("react").ReactElement} Vista del resultado de la solicitud.
 */
function ProjectRequestStatusView({ onBackToDashboard, onPrimaryAction, onViewRequest, projectRequest }) {
  const decision = getProjectRequestDecisionPresentation(projectRequest);
  const primaryAction = decision?.primaryAction || null;

  return (
    <div className="content-reveal mx-auto flex w-full max-w-[1200px] flex-col items-center gap-[48px] px-[16px] pb-[48px] min-[768px]:px-[24px] min-[1024px]:px-[48px]">
      <header className="flex w-full max-w-[850px] flex-col gap-[4px]">
        <h1 className="font-sans text-[32px] font-bold leading-[38px] tracking-[-1px] text-[var(--color-text-50)] min-[768px]:text-[48px] min-[768px]:leading-[58px]">
          Estado de la solicitud
        </h1>
        <p className="text-body-1 text-[var(--color-text-200)]">
          Verifique el progreso de su solicitud aquí.
        </p>
      </header>

      <ProjectRequestSectionDivider />

      {decision ? (
        <section
          aria-labelledby="request-decision-title"
          className="flex w-full max-w-[850px] flex-wrap items-start justify-between gap-x-[24px] gap-y-[16px] min-[768px]:gap-y-[48px]"
          data-decision-status={projectRequest?.status}
        >
          <h2 id="request-decision-title" className="text-heading-7 text-[var(--color-text-200)]">
            {decision.sectionTitle}
          </h2>
          <div className="flex w-[445px] min-w-[min(100%,300px)] max-w-full flex-col gap-[16px]">
            <p
              className={clsx(
                "text-heading-8 m-0 whitespace-pre-line break-words",
                decision.isReasonMissing ? "text-[var(--color-text-100)]" : "text-[var(--color-text-300)]",
              )}
              data-reason-missing={decision.isReasonMissing ? "true" : undefined}
            >
              {decision.message}
            </p>
          </div>
        </section>
      ) : null}

      <ProjectRequestSectionDivider />

      <ProjectRequestCurrentStages status={projectRequest?.status} firstContactAt={projectRequest?.firstContactAt} />

      <ProjectRequestSectionDivider />

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
          type={primaryAction ? "Outline" : "Solid"}
          size="M"
          fitContent
          showLeftIcon={false}
          showRightIcon={false}
          className="!w-full min-[480px]:!w-auto"
          onClick={onBackToDashboard}
        >
          Volver al Dashboard
        </Button>
        {primaryAction ? (
          <Button
            theme="Primary"
            type="Solid"
            size="M"
            fitContent
            showLeftIcon={false}
            showRightIcon={false}
            className="col-span-2 !w-full min-[480px]:!w-auto"
            onClick={() => onPrimaryAction(primaryAction.kind)}
          >
            {primaryAction.label}
          </Button>
        ) : null}
      </footer>
    </div>
  );
}

export default ProjectRequestStatusView;
