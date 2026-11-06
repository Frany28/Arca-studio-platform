import ProgressBarLabel from "../ui/ProgressBarLabel/ProgressBarLabel.jsx";

/**
 * Presenta el porcentaje financiero de la API con la misma barra en detalle y resumen.
 * Conserva las animaciones y, cuando se solicitan, los motivos; sin datos no inventa un 0 %.
 * @param {Object} props - Métrica normalizada, clases de composición y visibilidad de motivos.
 * @returns {import("react").ReactElement} Indicador financiero o estado sin evaluación.
 */
function ProjectRequestFinancialMetric({ className = "", metric, showReasons = false, unavailableText = "Información no disponible" }) {
  return (
    <div className={`flex min-w-0 flex-col gap-[8px] ${className}`} data-metric="financial-viability" data-status={metric?.status}>
      {metric?.score != null ? (
        <ProgressBarLabel
          className="min-w-full"
          position="side"
          title="Viabilidad financiera"
          value={metric.score}
          max={100}
          showTitle
          showSublabel={false}
          fillClassName={metric.fillClassName}
          animated
          aria-label={`Viabilidad financiera: ${metric.score}%`}
        />
      ) : (
        <dl className="m-0 flex flex-col gap-[4px]">
          <dt className="text-heading-8 text-[var(--color-text-300)]">Viabilidad financiera</dt>
          <dd className="text-heading-8 m-0 text-[var(--color-text-100)]">{unavailableText}</dd>
        </dl>
      )}
      {showReasons && metric?.reasons?.length ? (
        <ul className="text-body-3 m-0 flex list-disc flex-col gap-[4px] pl-[20px] text-[var(--color-text-200)]" aria-label="Motivos de la evaluación financiera">
          {metric.reasons.map((reason) => (
            <li key={reason.code} data-outcome={reason.outcome}>{reason.explanation}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default ProjectRequestFinancialMetric;
