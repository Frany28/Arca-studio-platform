/**
 * Mapeo de presentación del enum PostgreSQL project_request_meeting_recommendation.
 * El backend valida los códigos; aquí solo se definen etiquetas y temas del contrato.
 */
const MEETING_RECOMMENDATION_PRESENTATION = Object.freeze({
  SCHEDULE_MEETING: Object.freeze({ label: "Agendar reunión", theme: "Info" }),
  DO_NOT_SCHEDULE_MEETING: Object.freeze({ label: "No agendar reunión", theme: "Danger" }),
});

export const MEETING_RECOMMENDATION_OPTIONS = Object.freeze(
  Object.entries(MEETING_RECOMMENDATION_PRESENTATION).map(([value, presentation]) =>
    Object.freeze({ value, ...presentation }),
  ),
);

/**
 * Traduce la decisión estructurada de reunión sin inferirla del workflow ni de la nota.
 * Ausencia histórica y códigos desconocidos usan el estado neutral sin inventar decisiones.
 *
 * @param {string|null|undefined} value - meetingRecommendation recibido del backend.
 * @returns {{value: string, label: string, theme: string}|null} Presentación o ausencia.
 */
export function getMeetingRecommendationPresentation(value) {
  if (!Object.hasOwn(MEETING_RECOMMENDATION_PRESENTATION, value)) return null;
  const presentation = MEETING_RECOMMENDATION_PRESENTATION[value];
  return { value, ...presentation };
}
