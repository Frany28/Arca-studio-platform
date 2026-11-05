import ProgressBarLabel from "../../../components/ui/ProgressBarLabel/ProgressBarLabel.jsx";

const UNAVAILABLE_TEXT = "Información no disponible";
const METRIC_CLASS_NAME = "flex min-w-[200px] flex-1 flex-col gap-[4px]";

/**
 * Fila de indicadores bajo la cabecera (Figma 3727:687210: dos «Progress bar label» de
 * 850 px máx. con gap 24). La primera posición conserva la jerarquía del diseño pero muestra
 * la viabilidad financiera como estado de coherencia del algoritmo 3.3: cualitativo, nunca una barra ni un
 * porcentaje. La segunda es la información completada como porcentaje entero real.
 *
 * @param {Object} props - Métricas normalizadas por `buildAdminProjectRequestMetrics`.
 * @param {Object|null} props.completeness - Completitud de la API o null si falta.
 * @param {Object|null} props.financialViability - Coherencia financiera o null si falta.
 * @returns {import("react").ReactElement} Indicadores de evaluación.
 */
function AdminProjectRequestMetrics({ completeness, financialViability }) {
  return (
    <section aria-label="Indicadores de la solicitud" className="flex w-full max-w-[850px] flex-wrap items-start gap-[24px]">
      <dl className={`${METRIC_CLASS_NAME} m-0`} data-metric="financial-coherence" data-status={financialViability?.status}>
        <dt className="text-heading-8 text-[var(--color-text-300)]">Viabilidad financiera</dt>
        <dd className="m-0 flex flex-col gap-[4px]">
          <span className={`text-heading-8 ${financialViability?.toneClassName || "text-[var(--color-text-200)]"}`}>
            {financialViability ? financialViability.text : UNAVAILABLE_TEXT}
          </span>
          {financialViability?.hint ? (
            <span className="text-body-4 text-[var(--color-text-100)] dark:text-[var(--color-text-200)]">{financialViability.hint}</span>
          ) : null}
        </dd>
      </dl>

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
