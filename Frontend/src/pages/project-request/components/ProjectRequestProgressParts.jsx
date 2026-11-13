import receivedDivider from "../../../assets/project-requests/received-divider.svg";
import ProgressStepBase from "../../../components/ui/ProgressStepBase/ProgressStepBase.jsx";
import { buildProjectRequestStages } from "../../../utils/projectRequestStages.js";

const STEP_STATE_BY_TONE = { completed: "Completed", current: "Active", upcoming: "Incomplete" };

/**
 * Divisor de las vistas de seguimiento (Figma 3727:543692 y 3727:543790). Conserva el SVG del
 * diseño como máscara para adaptar el trazo al ancho y al token neutral del tema.
 *
 * @returns {import("react").ReactElement} Divisor decorativo de 1 px.
 */
export function ProjectRequestSectionDivider() {
  return (
    <div
      aria-hidden="true"
      className="relative h-0 w-full"
    >
      <span
        className="absolute inset-x-0 -top-px h-px bg-[var(--color-neutral-200)] [mask-repeat:no-repeat] [mask-size:100%_100%]"
        style={{ maskImage: `url("${receivedDivider}")` }}
      />
    </div>
  );
}

/** Presenta una etapa con el revelado original y las variantes del componente compartido. */
function AnimatedRequestStep({ animationDelay, state, subtext, title }) {
  const lineColorClassName = state === "Completed"
    ? "bg-[var(--color-accent-300)]"
    : state === "Active"
      ? "bg-[var(--color-text-300)]"
      : "bg-[var(--color-neutral-200)]";

  return (
    <div className="relative min-w-[150px] flex-1">
      <span
        aria-hidden="true"
        className={`progress-line-reveal absolute inset-x-0 top-0 h-[4px] ${lineColorClassName}`}
        style={{ animationDelay: `${animationDelay}ms` }}
      />
      <ProgressStepBase
        type="Line text"
        size="L"
        state={state}
        title={title}
        subtext={subtext}
        className="!w-full !border-transparent [&>span]:font-sans min-[1024px]:[&>span]:whitespace-nowrap"
      />
    </div>
  );
}

/**
 * Sección «Estado actual» con las cinco etapas del proceso, compartida por «Solicitud recibida»
 * y «Estado de la solicitud». Las etapas salen de `buildProjectRequestStages` con el estado real
 * (el mismo modelo de la consulta administrativa) y conservan el revelado escalonado.
 *
 * @param {Object} props - Estado de la solicitud.
 * @param {string|null|undefined} props.status - Estado vigente de la solicitud.
 * @param {string|null} [props.firstContactAt] - Registro real del primer contacto (completa esa etapa).
 * @returns {import("react").ReactElement} Sección de progreso.
 */
export function ProjectRequestCurrentStages({ firstContactAt = null, status }) {
  const requestSteps = buildProjectRequestStages(status, { firstContactAt });
  return (
    <section className="flex w-full max-w-[850px] flex-col gap-[16px]">
      <h2 className="text-heading-7 text-[var(--color-text-200)]">
        Estado actual
      </h2>

      <div
        className="flex w-full flex-wrap items-start gap-[24px]"
        aria-label="Progreso de la solicitud"
      >
        {requestSteps.map((step, index) => (
          <AnimatedRequestStep
            key={step.id}
            title={step.title}
            subtext={step.status}
            state={STEP_STATE_BY_TONE[step.tone]}
            animationDelay={180 + index * 110}
          />
        ))}
      </div>
    </section>
  );
}
