import meetingDeclinedIcon from "../../../../assets/project-requests/meeting-declined.svg";
import meetingSuggestedIcon from "../../../../assets/project-requests/meeting-suggested.svg";

import Badge from "../../../../components/ui/Badge/Badge.jsx";
import CircleProgressBarLabel from "../../../../components/ui/CircleProgressBarLabel/CircleProgressBarLabel.jsx";
import ProgressBarLabel from "../../../../components/ui/ProgressBarLabel/ProgressBarLabel.jsx";
import RequestDetailField from "./RequestDetailField.jsx";

// Icono de la recomendación; el texto del Badge comunica el valor, no solo el color.
const RECOMMENDATION_ICONS = {
  SCHEDULE_MEETING: meetingSuggestedIcon,
  DO_NOT_SCHEDULE_MEETING: meetingDeclinedIcon,
};

/**
 * Bloque de evaluación del drawer: compatibilidad, información completada y viabilidad
 * financiera como métricas independientes de la API, más la decisión de reunión y la
 * justificación de la última revisión técnica, sin derivarlas del workflow.
 * Sin score, la viabilidad muestra su estado de coherencia, una aclaración y los motivos,
 * nunca una barra ni un porcentaje; "sin incoherencias" no se presenta como aprobación.
 * Las observaciones para la revisión son avisos sin puntos y solo aparecen cuando aplican.
 * `unavailableText` se usa cuando la solicitud no llegó en la cola técnica.
 *
 * @param {Object} props - Modelo de `buildAdminRequestDetails`.
 * @param {Object} props.details - Datos de presentación de la solicitud.
 * @returns {import("react").ReactElement} Sección de evaluación.
 */
function AdminRequestEvaluation({ details }) {
  const { compatibility, completeness, financialViability, isPartial, justification, recommendation, reviewObservations } = details;
  const unavailableText = "Información no disponible";
  const recommendationIcon = RECOMMENDATION_ICONS[recommendation?.value];

  return (
    <section className="flex flex-col gap-[24px]" aria-label="Evaluación de la solicitud">
      <dl className="m-0 flex flex-col gap-[8px]">
        <dt className="text-heading-8 text-[var(--color-text-300)]">Compatibilidad</dt>
        <dd className="m-0">
          {compatibility ? (
            <CircleProgressBarLabel
              className="w-full justify-start"
              size="S"
              theme={compatibility.theme}
              value={compatibility.score}
              title={compatibility.label}
              description={`Score general: ${compatibility.score}/100`}
              aria-label={`Compatibilidad: ${compatibility.score} de 100`}
            />
          ) : (
            <p className="text-heading-8 m-0 text-[var(--color-text-200)]">
              {isPartial ? unavailableText : "Sin evaluación de compatibilidad"}
            </p>
          )}
        </dd>
      </dl>

      {financialViability?.score != null ? (
        <ProgressBarLabel
          className="w-full"
          position="side"
          title="Viabilidad financiera"
          value={financialViability.score}
          max={100}
          showTitle
          animated
          data-metric="financial-viability"
        />
      ) : (
        <dl className="m-0" data-metric="financial-viability" data-status={financialViability?.status}>
          <RequestDetailField label="Viabilidad financiera">
            {financialViability ? (
              <span className="flex flex-col gap-[8px]">
                <span className={financialViability.toneClassName || undefined}>{financialViability.text}</span>
                {financialViability.hint ? (
                  <span className="text-[12px] leading-[14px] tracking-[-0.5px] text-[var(--color-text-100)] dark:text-[var(--color-text-200)]">
                    {financialViability.hint}
                  </span>
                ) : null}
                {financialViability.reasons.length ? (
                  <ul className="text-body-3 m-0 flex list-disc flex-col gap-[4px] pl-[20px]" aria-label="Motivos de la evaluación financiera">
                    {financialViability.reasons.map((reason) => (
                      <li key={reason.code} data-outcome={reason.outcome}>{reason.explanation}</li>
                    ))}
                  </ul>
                ) : null}
              </span>
            ) : unavailableText}
          </RequestDetailField>
        </dl>
      )}

      {completeness ? (
        <ProgressBarLabel
          className="w-full"
          position="side"
          title="Información completada"
          value={completeness.score}
          max={100}
          showTitle
          showSublabel
          sublabel={`${completeness.answered} de ${completeness.applicable} preguntas aplicables respondidas`}
          fillClassName={completeness.fillClassName}
          animated
          data-metric="completeness"
        />
      ) : (
        <dl className="m-0" data-metric="completeness">
          <RequestDetailField label="Información completada">{unavailableText}</RequestDetailField>
        </dl>
      )}

      {/* Avisos sin puntos para aclarar en la revisión inicial; solo se muestran si aplican. */}
      {reviewObservations?.length ? (
        <dl className="m-0" data-metric="review-observations">
          <RequestDetailField label="Observaciones para la revisión">
            <ul className="text-body-3 m-0 flex list-disc flex-col gap-[4px] pl-[20px]" aria-label="Observaciones para la revisión inicial">
              {reviewObservations.map((observation) => (
                <li key={observation.code} data-code={observation.code}>{observation.explanation}</li>
              ))}
            </ul>
          </RequestDetailField>
        </dl>
      ) : null}

      <dl className="m-0 flex flex-col gap-[24px]">
        <RequestDetailField label="Recomendación">
          {recommendation ? (
            <Badge
              label={recommendation.label}
              theme={recommendation.theme}
              size="L"
              iconLeft={Boolean(recommendationIcon)}
              leftIcon={recommendationIcon ? (
                <span
                  className="inline-block size-4 shrink-0 bg-current [mask-repeat:no-repeat] [mask-position:center]"
                  style={{ maskImage: `url("${recommendationIcon}")` }}
                  aria-hidden="true"
                />
              ) : null}
            />
          ) : isPartial ? unavailableText : "Sin recomendación técnica registrada"}
        </RequestDetailField>
        <RequestDetailField label="Justificación" className="w-full">
          {justification || (isPartial ? unavailableText : "Sin justificación registrada")}
        </RequestDetailField>
      </dl>
    </section>
  );
}

export default AdminRequestEvaluation;
