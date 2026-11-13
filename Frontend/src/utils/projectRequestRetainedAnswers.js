import { EMPTY_PROPERTY_DETAIL_FIELDS, normalizeConditionalFormFields } from "./projectRequestApplicability.js";
import { EMPTY_STAND_FORM_FIELDS } from "./projectRequestStand.js";

/*
 * Respuestas condicionales retenidas durante la edición de una solicitud existente.
 *
 * El formulario limpia en el mismo cambio las respuestas que dejan de aplicar
 * (normalizeConditionalFormFields): así no se muestran, validan ni envían. En la creación, volver
 * a un tipo o respuesta las deja vacías. En la edición de una solicitud ya enviada eso borraría
 * datos reales por un cambio accidental (por ejemplo, elegir otro tipo y volver al original), así
 * que se retienen en memoria y se restauran si su sección vuelve a aplicar. Nunca se envían
 * mientras están ocultas: el formulario visible sigue normalizado.
 */

// Valor vacío de cada respuesta condicional (lo que deja la normalización al ocultarla).
const EMPTY_CONDITIONAL_ANSWERS = Object.freeze({
  ...EMPTY_PROPERTY_DETAIL_FIELDS,
  ...EMPTY_STAND_FORM_FIELDS,
  landStatus: "",
});
const CONDITIONAL_FIELDS = Object.freeze(Object.keys(EMPTY_CONDITIONAL_ANSWERS));

/**
 * Compara dos valores del formulario por contenido (incluye los arreglos de documentos).
 *
 * @param {unknown} left - Primer valor.
 * @param {unknown} right - Segundo valor.
 * @returns {boolean} true si son equivalentes.
 */
function sameValue(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/**
 * Normaliza un cambio del formulario reteniendo las respuestas condicionales que la normalización
 * vacía y restaurando las retenidas cuya sección vuelve a aplicar. Un campo que el usuario edita
 * directamente deja de retenerse: su valor explícito prevalece.
 *
 * @param {Object} candidate - Formulario con el cambio aplicado, sin normalizar.
 * @param {Object} retained - Respuestas retenidas hasta ahora (campo → valor).
 * @param {string|null} [editedField=null] - Campo que el usuario acaba de editar.
 * @returns {{form: Object, retained: Object}} Formulario normalizado y nuevas respuestas retenidas.
 */
export function normalizeWithRetainedAnswers(candidate, retained, editedField = null) {
  const nextRetained = { ...retained };
  if (editedField) delete nextRetained[editedField];
  const normalized = normalizeConditionalFormFields(candidate);

  for (const field of CONDITIONAL_FIELDS) {
    const cleared = !sameValue(candidate[field], EMPTY_CONDITIONAL_ANSWERS[field])
      && sameValue(normalized[field], EMPTY_CONDITIONAL_ANSWERS[field]);
    if (cleared) nextRetained[field] = candidate[field];
  }

  const restoredCandidate = { ...normalized };
  for (const [field, value] of Object.entries(nextRetained)) {
    if (sameValue(normalized[field], EMPTY_CONDITIONAL_ANSWERS[field])) restoredCandidate[field] = value;
  }
  const form = normalizeConditionalFormFields(restoredCandidate);
  // Lo que sobrevive a la normalización ya está visible y deja de retenerse.
  for (const field of Object.keys(nextRetained)) {
    if (sameValue(form[field], nextRetained[field])) delete nextRetained[field];
  }
  return { form, retained: nextRetained };
}
