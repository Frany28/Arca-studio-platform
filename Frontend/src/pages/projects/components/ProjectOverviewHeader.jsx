import CircleProgressBarLabel from "../../../components/ui/CircleProgressBarLabel/CircleProgressBarLabel.jsx";
import { getVisibleProjectStages } from "../../../utils/projectOverviewStages.js";

// Etapas visibles en móvil (<768 px); el resto se oculta para conservar el ancho legible.
const MOBILE_VISIBLE_STAGES = 2;

/**
 * Clases de barra, título y estado de una etapa según su tono.
 * `active` y `completed` usan el acento del proyecto; `current` es la etapa en curso de una
 * solicitud (Figma «solicitudes vista de ADMIN»: barra y textos `text-300`).
 *
 * @param {"active"|"completed"|"current"|string} tone - Tono de la etapa.
 * @returns {{bar: string, title: string, status: string}} Clases de presentación.
 */
function getStageToneClasses(tone) {
  if (tone === "active") {
    return {
      bar: "bg-[var(--color-accent-300)]",
      title: "text-[var(--color-text-300)]",
      status: "text-[var(--color-text-300)]",
    };
  }

  if (tone === "current") {
    return {
      bar: "bg-[var(--color-text-300)]",
      title: "text-[var(--color-text-300)]",
      status: "text-[var(--color-text-300)]",
    };
  }

  if (tone === "completed") {
    return {
      bar: "bg-[var(--color-accent-300)]",
      title: "text-[var(--color-text-200)]",
      status: "text-[var(--color-text-100)]",
    };
  }

  return {
    bar: "bg-[var(--color-neutral-200)]",
    title: "text-[var(--color-text-100)]",
    status: "text-[var(--color-neutral-400)]",
  };
}

/**
 * Primer índice visible en móvil. Por defecto se muestran las dos primeras etapas; con
 * `focusActive` la ventana empieza en la etapa en curso para que siempre sea visible.
 *
 * @param {Array<{tone: string}>} stages - Etapas visibles.
 * @param {boolean} focusActive - Si la ventana sigue a la etapa en curso.
 * @returns {number} Índice inicial de la ventana móvil.
 */
function getMobileWindowStart(stages, focusActive) {
  if (!focusActive) return 0;
  const activeIndex = stages.findIndex((stage) => stage.tone === "current" || stage.tone === "active");
  if (activeIndex < 0) return 0;
  return Math.max(0, Math.min(activeIndex, stages.length - MOBILE_VISIBLE_STAGES));
}

/**
 * Cabecera de detalle con título, categoría, indicador circular y etapas.
 * Compartida por el detalle de proyecto y la consulta administrativa de solicitudes; los
 * parámetros opcionales conservan el comportamiento original del proyecto si se omiten.
 *
 * @param {Object} props - Datos de la cabecera.
 * @param {{id: number|string, title: string, category: string, progressValue?: number, stages: Array}} props.project - Entidad presentada.
 * @param {{value: number, ariaLabel: string, theme?: string}|null} [props.indicator] - Indicador
 *   circular propio; null lo oculta y omitirlo muestra el progreso del proyecto.
 * @param {number} [props.maxStages] - Máximo de etapas visibles (por defecto, las del proyecto).
 * @param {boolean} [props.focusActiveStageOnMobile=false] - En móvil, muestra la etapa en curso y la siguiente.
 * @returns {import("react").ReactElement} Cabecera de la vista.
 */
export default function ProjectOverviewHeader({
  focusActiveStageOnMobile = false,
  indicator,
  maxStages,
  project,
}) {
  const visibleStages = maxStages == null
    ? getVisibleProjectStages(project.stages)
    : (Array.isArray(project.stages) ? project.stages : []).slice(0, maxStages);
  const mobileStart = getMobileWindowStart(visibleStages, focusActiveStageOnMobile);
  const resolvedIndicator = indicator === undefined
    ? { ariaLabel: `Progreso del proyecto ${project.progressValue}%`, value: project.progressValue }
    : indicator;

  return (
    <section
      key={project.id}
      className="flex w-full flex-col gap-[16px]"
    >
      <div className="flex w-full items-start justify-between gap-[12px] min-[768px]:gap-[24px]">
        <div className="flex min-w-0 flex-col gap-[4px]">
          <h1 className="break-words text-[20px] font-bold leading-[24px] tracking-[-0.5px] text-[var(--color-text-50)] min-[768px]:text-[48px] min-[768px]:leading-[58px] min-[768px]:tracking-[-1px]">
            {project.title}
          </h1>
          <p className="break-words text-[14px] leading-[17px] tracking-[-0.5px] text-[var(--color-text-200)] min-[768px]:text-[18px] min-[768px]:leading-[21px]">
            {project.category}
          </p>
        </div>

        {resolvedIndicator ? (
          <CircleProgressBarLabel
            size="M"
            value={resolvedIndicator.value}
            max={100}
            showText={false}
            theme={resolvedIndicator.theme}
            aria-label={resolvedIndicator.ariaLabel}
            className="shrink-0"
          />
        ) : null}
      </div>

      <div className="flex w-full gap-[12px] min-[480px]:gap-[24px]">
        {visibleStages.map((stage, index) => {
          const toneClasses = getStageToneClasses(stage.tone);
          const visibleOnMobile = index >= mobileStart && index < mobileStart + MOBILE_VISIBLE_STAGES;

          return (
            <div
              key={stage.id}
              aria-current={stage.tone === "current" ? "step" : undefined}
              className={`${visibleOnMobile ? "flex" : "hidden min-[768px]:flex"} min-w-0 flex-1 flex-col gap-[4px]`}
            >
              <div
                className={`project-stage-progress-line h-[4px] w-full ${toneClasses.bar}`}
                style={{ animationDelay: `${120 + index * 100}ms` }}
                aria-hidden="true"
              />
              <p
                className={`mt-[8px] break-words text-[12px] leading-[15px] tracking-[-0.5px] min-[480px]:mt-[12px] min-[480px]:text-[14px] min-[480px]:leading-[17px] min-[768px]:text-[16px] min-[768px]:leading-[19px] ${toneClasses.title}`}
              >
                {stage.title}
              </p>
              <p
                className={`break-words text-[12px] leading-[15px] tracking-[-0.5px] min-[768px]:text-[14px] min-[768px]:leading-[17px] ${toneClasses.status}`}
              >
                {stage.status}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
