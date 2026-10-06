import Button from "../ui/Button/Button.jsx";
import HintText from "../ui/HintText/HintText.jsx";
import { MEETING_RECOMMENDATION_OPTIONS } from "../../utils/projectRequestMeetingRecommendation.js";

/**
 * Selección explícita de reunión, separada de las acciones del workflow y de la justificación.
 * No preselecciona una decisión; conserva el borrador durante un envío fallido.
 *
 * @param {Object} props - Valor controlado, error y estado de envío del formulario.
 * @returns {import("react").ReactElement} Campo con dos opciones y ayuda accesible.
 */
function MeetingRecommendationField({ disabled, error, onChange, value }) {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0" disabled={disabled}>
      <legend className="text-heading-8 mb-[8px] text-[var(--color-text-300)]">
        Recomendación de reunión
      </legend>
      <div className="grid grid-cols-1 gap-[8px] min-[480px]:grid-cols-2" role="group" aria-label="Recomendación de reunión">
        {MEETING_RECOMMENDATION_OPTIONS.map((option) => (
          <Button
            key={option.value}
            theme={option.theme === "Danger" ? "Danger" : "Info"}
            type={value === option.value ? "Solid" : "Outline"}
            size="S"
            showLeftIcon={false}
            showRightIcon={false}
            disabled={disabled}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      {error ? <HintText className="mt-[8px]" state="Error" hintText={error} role="alert" /> : null}
    </fieldset>
  );
}

export default MeetingRecommendationField;
