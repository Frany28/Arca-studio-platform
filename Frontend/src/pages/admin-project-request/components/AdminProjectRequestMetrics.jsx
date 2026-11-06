import ProgressBarLabel from "../../../components/ui/ProgressBarLabel/ProgressBarLabel.jsx";
import ProjectRequestFinancialMetric from "../../../components/project-requests/ProjectRequestFinancialMetric.jsx";

const UNAVAILABLE_TEXT = "Información no disponible";
const METRIC_CLASS_NAME = "flex min-w-[200px] flex-1 flex-col gap-[4px]";

/**
 * Fila de indicadores bajo la cabecera (Figma 3727:687210: dos «Progress bar label» de
 * 850 px máx. con gap 24). Ambas posiciones muestran porcentajes enteros de la API:
 * viabilidad financiera e información completada, sin derivarlas de la compatibilidad.
 *
 * @param {Object} props - Métricas normalizadas por `buildAdminProjectRequestMetrics`.
 * @param {Object|null} props.completeness - Completitud de la API o null si falta.
 * @param {Object|null} props.financialViability - Coherencia financiera o null si falta.
 * @returns {import("react").ReactElement} Indicadores de evaluación.
 */
function AdminProjectRequestMetrics({ completeness, financialViability }) {
  return (
    <section aria-label="Indicadores de la solicitud" className="flex w-full max-w-[850px] flex-wrap items-start gap-[24px]">
      <ProjectRequestFinancialMetric className={METRIC_CLASS_NAME} metric={financialViability} />

      {completeness ? (
        <ProgressBarLabel
          className={METRIC_CLASS_NAME}
          position="side"
          title="Información completada"
          value={completeness.score}
          max={100}
          showTitle
          showSublabel={false}
          fillClassName={completeness.fillClassName}
          animated
          aria-label={`Información completada: ${completeness.score} %, ${completeness.answered} de ${completeness.applicable} preguntas aplicables respondidas`}
          data-metric="completeness"
        />
      ) : (
        <dl className={`${METRIC_CLASS_NAME} m-0`} data-metric="completeness">
          <dt className="text-heading-8 text-[var(--color-text-300)]">Información completada</dt>
          <dd className="text-heading-8 m-0 text-[var(--color-text-200)]">{UNAVAILABLE_TEXT}</dd>
        </dl>
      )}
    </section>
  );
}

export default AdminProjectRequestMetrics;
