import { hasApplicableProperty } from "./projectRequest.js";

/*
 * Observaciones para la revisión inicial: avisos informativos para administración y arquitectura.
 *
 * No son hallazgos de compatibilidad: no tienen puntos ni severidad, no se persisten con la
 * evaluación, no se muestran al cliente y no alteran la información completada ni la coherencia
 * financiera. Se derivan al vuelo de las respuestas guardadas, por lo que también aparecen en
 * solicitudes evaluadas con versiones anteriores (cuyos hallazgos guardados no cambian).
 */

export const REVIEW_OBSERVATIONS = Object.freeze({
  propertyBlueprintsUnavailable:
    "El cliente no dispone de planos del inmueble. Durante la revisión inicial se deberá determinar si se requiere un levantamiento arquitectónico o la elaboración de planos.",
  propertyBlueprintsUnconfirmed:
    "No se ha confirmado la disponibilidad de planos del inmueble. Se recomienda aclararlo durante la revisión inicial.",
});

/**
 * Crea una observación pública a partir de su código del catálogo.
 * Mantiene un contrato estable `{code, explanation}` sin pesos ni severidades.
 *
 * @param {keyof typeof REVIEW_OBSERVATIONS} code - Código de la observación.
 * @returns {{code: string, explanation: string}} Observación informativa.
 */
function toObservation(code) {
  return { code, explanation: REVIEW_OBSERVATIONS[code] };
}

/**
 * Indica qué observación corresponde a la disponibilidad de planos del inmueble.
 * Solo aplica con inmueble aplicable y disponible: «No» explícito o sin respuesta generan un
 * aviso distinto; «Sí» no requiere aclaración.
 *
 * @param {object} answers - Respuestas guardadas de la solicitud.
 * @returns {string|null} Código de la observación o null si no corresponde.
 */
function blueprintsObservationCode(answers) {
  if (!hasApplicableProperty(answers)) return null;
  if (answers.hasPlans === false) return "propertyBlueprintsUnavailable";
  if (answers.hasPlans === true) return null;
  return "propertyBlueprintsUnconfirmed";
}

/**
 * Calcula las observaciones informativas que administración debe aclarar en la revisión inicial.
 * Función pura sobre las respuestas guardadas; devuelve una lista vacía si nada aplica.
 *
 * @param {object|null|undefined} answers - Registro de la solicitud con nombres de dominio.
 * @returns {Array<{code: string, explanation: string}>} Observaciones sin puntos.
 */
export function buildProjectRequestReviewObservations(answers) {
  const blueprintsCode = blueprintsObservationCode(answers || {});
  return blueprintsCode ? [toObservation(blueprintsCode)] : [];
}
