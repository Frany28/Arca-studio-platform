import { CloseCircle, InfoCircle, TickCircle } from "iconsax-react";

import Badge from "../../../../components/ui/Badge/Badge.jsx";
import CircleProgressBarLabel from "../../../../components/ui/CircleProgressBarLabel/CircleProgressBarLabel.jsx";
import ProgressBarLabel from "../../../../components/ui/ProgressBarLabel/ProgressBarLabel.jsx";
import { PROTOTYPE_INDICATOR_HINT } from "../../data/adminRequestDetailsPrototype.js";
import RequestDetailField from "./RequestDetailField.jsx";

// Icono de la recomendación; el texto del Badge comunica el valor, no solo el color.
const RECOMMENDATION_ICONS = {
  approve: TickCircle,
  changes_requested: InfoCircle,
  reject: CloseCircle,
};

/**
 * Bloque de evaluación del drawer: compatibilidad (real), indicadores de prototipo,
 * recomendación y justificación de la última revisión técnica (reales cuando existen).
 * `unavailableText` se usa cuando la solicitud no llegó en la cola técnica.
 *
 * @param {Object} props - Modelo de `buildAdminRequestDetails`.
 * @param {Object} props.details - Datos de presentación de la solicitud.
 * @returns {import("react").ReactElement} Sección de evaluación.
 */
function AdminRequestEvaluation({ details }) {
  const { compatibility, isPartial, justification, prototypeIndicators, recommendation } = details;
  const unavailableText = "Información no disponible";
  const RecommendationIcon = RECOMMENDATION_ICONS[recommendation?.value];

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

      {prototypeIndicators.map((indicator) => (
        <ProgressBarLabel
          key={indicator.id}
          className="w-full"
          position="side"
          title={indicator.title}
          value={indicator.value}
          max={100}
          showTitle
          showSublabel={indicator.isPrototype}
          sublabel={PROTOTYPE_INDICATOR_HINT}
          fillClassName="bg-[var(--color-success-200)]"
          animated
          data-prototype={indicator.isPrototype ? "true" : undefined}
        />
      ))}

      <dl className="m-0 flex flex-col gap-[24px]">
        <RequestDetailField label="Recomendación">
          {recommendation ? (
            <Badge
              label={recommendation.label}
              theme={recommendation.theme}
              size="L"
              iconLeft={Boolean(RecommendationIcon)}
              leftIcon={RecommendationIcon ? <RecommendationIcon size="16" color="currentColor" /> : null}
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
