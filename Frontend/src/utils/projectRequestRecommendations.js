// Recomendaciones técnicas del arquitecto sobre una solicitud (Figma: Dashboard ARQ, modales
// 3727:618383 aprobación, 3727:618488 rechazo y 3727:618593 / 3727:618261 más información).
// Datos puros: cada recomendación se guarda con `PUT /project-requests/:id/review` y nunca cambia
// el estado de la solicitud; la decisión final es del administrador.

export const RECOMMENDATION_NOTE_LIMITS = Object.freeze({ max: 2000, min: 10 });

export const PROJECT_REQUEST_RECOMMENDATIONS = Object.freeze({
  approve: Object.freeze({
    buttonLabel: "Recomendar aprobación",
    buttonTheme: "Primary",
    buttonType: "Solid",
    description: "Esta será suministrada al administrador para una evaluación final en base a tu respuesta.",
    hint: "Escribe un resumen detallado de la solicitud y por qué recomiendas su aprobación.",
    icon: "approve",
    iconType: "SuccessSolid",
    placeholder: "Ej. \"El cliente posee terreno, presupuesto adecuado y los requerimientos son viables.\"",
    title: "¿Deseas recomendar aprobación?",
  }),
  changes_requested: Object.freeze({
    buttonLabel: "Recomendar solicitar más información",
    buttonTheme: "Info",
    buttonType: "Outline",
    description: "Esta recomendación será suministrada al administrador para una evaluación final en base a tu respuesta.",
    hint: "Escribe un resumen detallado de la solicitud y por qué recomiendas solicitar más información.",
    icon: "info",
    iconType: "InfoSolid",
    placeholder: "Ej. \"El cliente posee terreno y presupuesto adecuado pero su visión del proyecto es inconclusa.\"",
    title: "¿Deseas solicitar más información?",
  }),
  reject: Object.freeze({
    buttonLabel: "Recomendar rechazo",
    buttonTheme: "Danger",
    buttonType: "Outline",
    description: "Esta será suministrada al administrador para una evaluación final en base a tu respuesta.",
    hint: "Escribe un resumen detallado de la solicitud y por qué recomiendas rechazar la solicitud.",
    icon: "reject",
    iconType: "DangerSolid",
    placeholder: "Ej. \"El cliente no posee terreno, presupuesto adecuado ni requerimientos viables.\"",
    title: "¿Deseas recomendar rechazo?",
  }),
});

// Orden de los botones del detalle (Figma 3727:618270): rechazo, más información y aprobación.
export const PROJECT_REQUEST_RECOMMENDATION_ORDER = Object.freeze(["reject", "changes_requested", "approve"]);

/**
 * Valida la justificación de una recomendación con los límites del backend.
 *
 * @param {unknown} note - Texto escrito por el arquitecto.
 * @returns {string} Mensaje de error, o cadena vacía si es válida.
 */
export function describeRecommendationNoteError(note) {
  const text = String(note ?? "").trim();
  if (text.length < RECOMMENDATION_NOTE_LIMITS.min) {
    return `Escribe al menos ${RECOMMENDATION_NOTE_LIMITS.min} caracteres para justificar tu recomendación.`;
  }
  if (text.length > RECOMMENDATION_NOTE_LIMITS.max) {
    return `La justificación admite como máximo ${RECOMMENDATION_NOTE_LIMITS.max} caracteres.`;
  }
  return "";
}
