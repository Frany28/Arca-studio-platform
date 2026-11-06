import CircleProgressBarLabel from "../../../components/ui/CircleProgressBarLabel/CircleProgressBarLabel.jsx";
import useMobileLayout from "../../../hooks/useMobileLayout.js";
import { getVisibleProjectStages } from "../../../utils/projectOverviewStages.js";

// Etapas visibles en móvil (<768 px); el resto se oculta para conservar el ancho legible.
const MOBILE_VISIBLE_STAGES = 2;
// Variante de solicitud en tablet (768–1023 px): Figma 3727:687575 muestra cuatro etapas.
const REQUEST_TABLET_VISIBLE_STAGES = 4;

/**
 * Tipografía y separaciones de cada variante. `project` conserva el detalle de proyecto; `request`
 * aplica la consulta administrativa de solicitudes (Figma 3727:687197 escritorio y 3727:687692
 * móvil): en móvil título h4 (24/30), categoría b1 (18/21) y etapas b2/b3 con separación de 24.
 */
const HEADER_VARIANTS = Object.freeze({
  project: Object.freeze({
    category: "text-[14px] leading-[17px] min-[768px]:text-[18px] min-[768px]:leading-[21px]",
    stageGap: "gap-[12px] min-[480px]:gap-[24px]",
    stageStatus: "text-[12px] leading-[15px] min-[768px]:text-[14px] min-[768px]:leading-[17px]",
    stageTitle: "mt-[8px] text-[12px] leading-[15px] min-[480px]:mt-[12px] min-[480px]:text-[14px] min-[480px]:leading-[17px] min-[768px]:text-[16px] min-[768px]:leading-[19px]",
    title: "text-[20px] leading-[24px] tracking-[-0.5px] min-[768px]:text-[48px] min-[768px]:leading-[58px] min-[768px]:tracking-[-1px]",
  }),
  request: Object.freeze({
    category: "text-[18px] leading-[21px]",
    stageGap: "gap-[24px]",
    stageStatus: "text-[14px] leading-[17px]",
    stageTitle: "mt-[12px] text-[16px] leading-[19px]",
    title: "text-[24px] leading-[30px] tracking-[-0.5px] min-[768px]:text-[48px] min-[768px]:leading-[58px] min-[768px]:tracking-[-1px]",
  }),
});

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
 * Primer índice de una ventana de etapas visibles. Por defecto empieza en la primera etapa; con
 * `focusActive` empieza en la etapa en curso (sin pasar del final) para que siempre sea visible.
 *
 * @param {Array<{tone: string}>} stages - Etapas visibles.
 * @param {boolean} focusActive - Si la ventana sigue a la etapa en curso.
 * @param {number} [size=MOBILE_VISIBLE_STAGES] - Etapas que caben en la ventana.
 * @returns {number} Índice inicial de la ventana.
 */
function getStageWindowStart(stages, focusActive, size = MOBILE_VISIBLE_STAGES) {
  if (!focusActive) return 0;
  const activeIndex = getActiveStageIndex(stages);
  if (activeIndex < 0) return 0;
  return Math.max(0, Math.min(activeIndex, stages.length - size));
}

/**
 * Índice de la etapa en curso (`current` o `active`), o -1 si no hay ninguna.
 *
 * @param {Array<{tone: string}>} stages - Etapas visibles.
 * @returns {number} Índice de la etapa en curso.
 */
function getActiveStageIndex(stages) {
  return stages.findIndex((stage) => stage.tone === "current" || stage.tone === "active");
}

/**
 * Primer índice de la ventana de tablet de la variante de solicitud: la ventana más temprana que
 * contiene la etapa en curso (Figma 3727:687575 muestra las cuatro primeras con «Revisión» dentro).
 *
 * @param {Array<{tone: string}>} stages - Etapas visibles.
 * @param {number} size - Etapas que caben en la ventana.
 * @returns {number} Índice inicial de la ventana de tablet.
 */
function getTabletWindowStart(stages, size) {
  const activeIndex = getActiveStageIndex(stages);
  return Math.max(0, Math.min(activeIndex - size + 1, stages.length - size));
}

/**
 * Clases de visibilidad de una etapa por rango. En la variante de solicitud, tablet muestra una
 * ventana de cuatro etapas; en el resto, desde 768 px se muestran todas.
 *
 * @param {boolean} onMobile - Si la etapa está en la ventana móvil.
 * @param {boolean|null} onTablet - Si está en la ventana de tablet; null si la variante no la usa.
 * @returns {string} Clases de display.
 */
function getStageVisibilityClassName(onMobile, onTablet) {
  const mobile = onMobile ? "flex" : "hidden";
  if (onTablet === null) return onMobile ? "flex" : "hidden min-[768px]:flex";
  return `${mobile} ${onTablet ? "min-[768px]:flex" : "min-[768px]:hidden"} min-[1024px]:flex`;
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
 * @param {"project"|"request"} [props.variant="project"] - `request` aplica la consulta
 *   administrativa de solicitudes: tipografía móvil de Figma, indicador de 64 px en móvil y
 *   cuatro etapas en tablet (la ventana más temprana que contiene la etapa en curso).
 * @returns {import("react").ReactElement} Cabecera de la vista.
 */
export default function ProjectOverviewHeader({
  focusActiveStageOnMobile = false,
  indicator,
  maxStages,
  project,
  variant = "project",
}) {
  const isRequest = variant === "request";
  const styles = HEADER_VARIANTS[variant] || HEADER_VARIANTS.project;
  // El tamaño del indicador es una prop del componente, no una clase: se elige por rango.
  const isMobileLayout = useMobileLayout();
  const visibleStages = maxStages == null
    ? getVisibleProjectStages(project.stages)
    : (Array.isArray(project.stages) ? project.stages : []).slice(0, maxStages);
  const mobileStart = getStageWindowStart(visibleStages, focusActiveStageOnMobile);
  const tabletStart = isRequest ? getTabletWindowStart(visibleStages, REQUEST_TABLET_VISIBLE_STAGES) : null;
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
          <h1 className={`break-words font-bold text-[var(--color-text-50)] ${styles.title}`}>
            {project.title}
          </h1>
          <p className={`break-words tracking-[-0.5px] text-[var(--color-text-200)] ${styles.category}`}>
            {project.category}
          </p>
        </div>

        {resolvedIndicator ? (
          <CircleProgressBarLabel
            size={isRequest && isMobileLayout ? "S" : "M"}
            value={resolvedIndicator.value}
            max={100}
            showText={false}
            theme={resolvedIndicator.theme}
            aria-label={resolvedIndicator.ariaLabel}
            className="shrink-0"
          />
        ) : null}
      </div>

      <div className={`flex w-full ${styles.stageGap}`}>
        {visibleStages.map((stage, index) => {
          const toneClasses = getStageToneClasses(stage.tone);
          const visibleOnMobile = index >= mobileStart && index < mobileStart + MOBILE_VISIBLE_STAGES;
          const visibleOnTablet = tabletStart === null
            ? null
            : index >= tabletStart && index < tabletStart + REQUEST_TABLET_VISIBLE_STAGES;

          return (
            <div
              key={stage.id}
              aria-current={stage.tone === "current" ? "step" : undefined}
              className={`${getStageVisibilityClassName(visibleOnMobile, visibleOnTablet)} min-w-0 flex-1 flex-col gap-[4px]`}
            >
              <div
                className={`project-stage-progress-line h-[4px] w-full ${toneClasses.bar}`}
                style={{ animationDelay: `${120 + index * 100}ms` }}
                aria-hidden="true"
              />
              <p className={`break-words tracking-[-0.5px] ${styles.stageTitle} ${toneClasses.title}`}>
                {stage.title}
              </p>
              <p className={`break-words tracking-[-0.5px] ${styles.stageStatus} ${toneClasses.status}`}>
                {stage.status}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
