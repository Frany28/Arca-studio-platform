import {
  hasAvailableLegalDocumentation,
  hasAvailableProperty,
  PROJECT_REQUEST_TEXT_LIMITS,
  PROJECT_REQUEST_VALUES,
} from "./projectRequest.js";

/*
 * Información completada = preguntas aplicables respondidas / preguntas aplicables × 100.
 *
 * Mide si se contestó lo que corresponde, no si las respuestas son favorables: "No todavía",
 * "Busca financiamiento", "No lo sé aún" o "Por definir" cuentan como respondidas.
 * Las preguntas condicionales que no aplican salen del numerador y del denominador.
 *
 * Participan todas las preguntas del formulario, obligatorias y opcionales. No participan
 * los archivos ni el enlace de referencia (material complementario, no preguntas) ni los
 * metadatos de ubicación (coordenadas, place id), que dependen del proveedor y no del cliente.
 */

/**
 * Comprueba que un texto recortado respete los límites del contrato.
 * Reutiliza los mismos límites que la validación Zod de la solicitud.
 *
 * @param {{max: number, min: number}} limits - Longitudes permitidas.
 * @returns {(value: unknown) => boolean} Validador del texto.
 */
function isTextWithin({ max, min }) {
  /**
   * Valida la longitud de un texto declarado por el cliente.
   * Los valores vacíos o no textuales cuentan como no respondidos.
   *
   * @param {unknown} value - Texto guardado.
   * @returns {boolean} true cuando la respuesta es válida.
   */
  return function validateText(value) {
    const length = typeof value === "string" ? value.trim().length : 0;
    return length >= min && length <= max;
  };
}

/**
 * Crea un validador que acepta únicamente opciones del catálogo del formulario.
 * Una opción válida cuenta como respondida aunque exprese indefinición.
 *
 * @param {Array<string>} values - Opciones permitidas.
 * @returns {(value: unknown) => boolean} Validador de la opción.
 */
function isCatalogOption(values) {
  /**
   * Valida que la respuesta pertenezca al catálogo permitido.
   * Las respuestas ausentes o desconocidas cuentan como no respondidas.
   *
   * @param {unknown} value - Opción guardada.
   * @returns {boolean} true cuando la opción es válida.
   */
  return function validateOption(value) {
    return values.includes(value);
  };
}

/**
 * Valida una respuesta Sí/No almacenada como booleano; null significa sin responder.
 * Se usa para propietarios y planos, que tienen estado "sin responder".
 *
 * @param {unknown} value - Respuesta guardada.
 * @returns {boolean} true cuando existe una respuesta explícita.
 */
function isExplicitBoolean(value) {
  return typeof value === "boolean";
}

/**
 * Valida la lista de documentos disponibles: al menos uno, del catálogo y sin repetir.
 * Replica la regla del contrato para no depender solo de la validación previa.
 *
 * @param {unknown} value - Lista guardada.
 * @returns {boolean} true cuando la lista es una respuesta válida.
 */
function isLegalDocumentList(value) {
  return Array.isArray(value)
    && value.length > 0
    && new Set(value).size === value.length
    && value.every((type) => PROJECT_REQUEST_VALUES.legalDocumentTypes.includes(type));
}

/**
 * Indica que una pregunta aplica siempre, independientemente de otras respuestas.
 * Se declara como función para que el catálogo sea homogéneo.
 *
 * @returns {boolean} Siempre true.
 */
function alwaysApplicable() {
  return true;
}

/**
 * Indica si aplican las preguntas que dependen de un inmueble disponible.
 * Sin inmueble disponible son N/A y no forman parte del cálculo.
 *
 * @param {object} answers - Respuestas de la solicitud.
 * @returns {boolean} true cuando hay inmueble disponible.
 */
function appliesWithProperty(answers) {
  return hasAvailableProperty(answers.landStatus);
}

// Catálogo de preguntas: campo del registro, condición de aplicabilidad y validez de respuesta.
export const COMPLETENESS_QUESTIONS = Object.freeze([
  { field: "projectName", isAnswered: isTextWithin(PROJECT_REQUEST_TEXT_LIMITS.projectName), isApplicable: alwaysApplicable },
  { field: "projectType", isAnswered: isCatalogOption(PROJECT_REQUEST_VALUES.projectType), isApplicable: alwaysApplicable },
  { field: "location", isAnswered: isTextWithin(PROJECT_REQUEST_TEXT_LIMITS.projectLocation), isApplicable: alwaysApplicable },
  { field: "description", isAnswered: isTextWithin(PROJECT_REQUEST_TEXT_LIMITS.description), isApplicable: alwaysApplicable },
  { field: "projectSize", isAnswered: isCatalogOption(PROJECT_REQUEST_VALUES.projectSize), isApplicable: alwaysApplicable },
  { field: "developmentMode", isAnswered: isCatalogOption(PROJECT_REQUEST_VALUES.developmentMode), isApplicable: alwaysApplicable },
  { field: "landStatus", isAnswered: isCatalogOption(PROJECT_REQUEST_VALUES.landStatus), isApplicable: alwaysApplicable },
  { field: "legalDocumentationStatus", isAnswered: isCatalogOption(PROJECT_REQUEST_VALUES.legalDocumentationStatus), isApplicable: appliesWithProperty },
  { field: "legalDocumentTypes", isAnswered: isLegalDocumentList, isApplicable: hasAvailableLegalDocumentation },
  { field: "hasMultipleOwners", isAnswered: isExplicitBoolean, isApplicable: appliesWithProperty },
  { field: "hasPlans", isAnswered: isExplicitBoolean, isApplicable: appliesWithProperty },
  { field: "investmentRange", isAnswered: isCatalogOption(PROJECT_REQUEST_VALUES.investmentRange), isApplicable: alwaysApplicable },
  { field: "capitalAvailability", isAnswered: isCatalogOption(PROJECT_REQUEST_VALUES.capitalAvailability), isApplicable: alwaysApplicable },
  { field: "startTime", isAnswered: isCatalogOption(PROJECT_REQUEST_VALUES.startTime), isApplicable: alwaysApplicable },
  { field: "decisionMaker", isAnswered: isCatalogOption(PROJECT_REQUEST_VALUES.decisionMaker), isApplicable: alwaysApplicable },
  { field: "quality", isAnswered: isCatalogOption(PROJECT_REQUEST_VALUES.quality), isApplicable: alwaysApplicable },
  { field: "experience", isAnswered: isCatalogOption(PROJECT_REQUEST_VALUES.experience), isApplicable: alwaysApplicable },
].map(Object.freeze));

/**
 * Calcula el porcentaje de preguntas aplicables respondidas válidamente en una solicitud.
 * Las preguntas N/A no entran en el numerador ni en el denominador; no evalúa coherencia
 * ni premia respuestas favorables. Es una función pura sobre las respuestas guardadas.
 *
 * @param {object} answers - Registro de la solicitud con los nombres de campo del dominio.
 * @returns {{answered: number, applicable: number, missingFields: Array<string>, score: number}} Completitud.
 */
export function evaluateProjectRequestCompleteness(answers) {
  const source = answers || {};
  const applicableQuestions = COMPLETENESS_QUESTIONS.filter((question) => question.isApplicable(source));
  const missingFields = applicableQuestions
    .filter((question) => !question.isAnswered(source[question.field]))
    .map(({ field }) => field);
  const applicable = applicableQuestions.length;
  const answered = applicable - missingFields.length;

  return {
    answered,
    applicable,
    missingFields,
    score: applicable === 0 ? 0 : Math.round((answered / applicable) * 100),
  };
}
