import {
  hasApplicableProperty,
  hasAvailableLegalDocumentation,
  PROJECT_REQUEST_TEXT_LIMITS,
  PROJECT_REQUEST_VALUES,
  READABLE_PROJECT_REQUEST_TYPES,
  requiresPropertyAvailability,
} from "./projectRequest.js";
import {
  allowsStandDocumentSelection,
  isAdvertisingStand,
  STAND_REQUIREMENTS_VALUES,
} from "./projectRequestStand.js";

/*
 * Información completada = preguntas aplicables respondidas / preguntas aplicables × 100.
 *
 * Mide si se contestó lo que corresponde, no si las respuestas son favorables: "No todavía",
 * "Busca financiamiento", "No lo sé aún" o "Por definir" cuentan como respondidas.
 * Las preguntas condicionales que no aplican salen del numerador y del denominador.
 *
 * Participan las preguntas del catálogo vigente, obligatorias y opcionales. No participan
 * los archivos ni el enlace de referencia (material complementario, no preguntas) ni los
 * metadatos de ubicación (coordenadas, place id), que dependen del proveedor y no del cliente.
 * El tipo histórico retirado sigue contando como respuesta válida en registros anteriores.
 *
 * Stand publicitario: el terreno o inmueble y su sección legal son N/A; aplican las preguntas
 * de «Requisitos del stand» (la documentación solo si las normas están disponibles). Solo
 * cuentan para completitud: no puntúan en compatibilidad ni en coherencia financiera.
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
 * Se usa para propietarios y planos (del inmueble o del stand), con estado "sin responder".
 *
 * @param {unknown} value - Respuesta guardada.
 * @returns {boolean} true cuando existe una respuesta explícita.
 */
function isExplicitBoolean(value) {
  return typeof value === "boolean";
}

/**
 * Crea un validador de listas de documentos: al menos uno, del catálogo y sin repetir.
 * Replica la regla del contrato para no depender solo de la validación previa; una lista
 * vacía cuenta como sin responder aunque el contrato del stand admita enviarla vacía.
 *
 * @param {ReadonlyArray<string>} values - Tipos de documento permitidos.
 * @returns {(value: unknown) => boolean} Validador de la lista.
 */
function isDocumentList(values) {
  /**
   * Valida que la lista declarada sea una selección efectiva del catálogo.
   * Las listas vacías, repetidas o con tipos desconocidos cuentan como no respondidas.
   *
   * @param {unknown} value - Lista guardada.
   * @returns {boolean} true cuando la lista es una respuesta válida.
   */
  return function validateDocumentList(value) {
    return Array.isArray(value)
      && value.length > 0
      && new Set(value).size === value.length
      && value.every((type) => values.includes(type));
  };
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
 * Indica si aplica la pregunta de terreno o inmueble según el tipo de proyecto.
 * Para Stand publicitario es N/A: el espacio del evento se pregunta en su propia sección.
 *
 * @param {object} answers - Respuestas de la solicitud.
 * @returns {boolean} true cuando el tipo conserva la pregunta del inmueble.
 */
function appliesLandStatus(answers) {
  return requiresPropertyAvailability(answers.projectType);
}

/**
 * Indica si aplican las preguntas que dependen de un inmueble disponible.
 * Sin inmueble aplicable y disponible son N/A y no forman parte del cálculo.
 *
 * @param {object} answers - Respuestas de la solicitud.
 * @returns {boolean} true cuando hay inmueble aplicable y disponible.
 */
function appliesWithProperty(answers) {
  return hasApplicableProperty(answers);
}

/**
 * Indica si aplican las preguntas de «Requisitos del stand»: tipo Stand publicitario con bloque.
 * El contrato exige el bloque desde que existe el tipo; su ausencia identifica un registro que
 * nunca recibió la sección, cuyas preguntas quedan N/A sin respuestas ficticias ni penalización.
 *
 * @param {object} answers - Respuestas de la solicitud.
 * @returns {boolean} true cuando el stand tiene su sección de requisitos.
 */
function appliesWithStandSection(answers) {
  const block = answers.standRequirements;
  return isAdvertisingStand(answers.projectType)
    && block !== null && typeof block === "object" && !Array.isArray(block);
}

/**
 * Indica si aplica la lista de documentación del evento.
 * Solo con la sección del stand y la respuesta «Sí, tengo los requisitos».
 *
 * @param {object} answers - Respuestas de la solicitud.
 * @returns {boolean} true cuando la selección de documentos está habilitada.
 */
function appliesWithStandDocuments(answers) {
  return appliesWithStandSection(answers)
    && allowsStandDocumentSelection(answers.standRequirements.requirementsStatus);
}

/**
 * Crea el lector de una respuesta dentro del bloque de requisitos del stand.
 * Solo se invoca cuando la sección aplica, por lo que el bloque existe.
 *
 * @param {string} key - Propiedad del bloque `standRequirements`.
 * @returns {(answers: object) => unknown} Lector de la respuesta.
 */
function readStandAnswer(key) {
  /**
   * Obtiene la respuesta del stand guardada en el bloque JSON.
   * Los valores ausentes se leen como undefined y cuentan como no respondidos.
   *
   * @param {object} answers - Respuestas de la solicitud.
   * @returns {unknown} Respuesta guardada.
   */
  return function readNestedAnswer(answers) {
    return answers.standRequirements[key];
  };
}

/*
 * Catálogo de preguntas: identificador público (también el de `missingFields`), condición de
 * aplicabilidad, validez de respuesta y, para respuestas anidadas, su lector. El orden sigue
 * el del formulario.
 */
export const COMPLETENESS_QUESTIONS = Object.freeze([
  { field: "projectName", isAnswered: isTextWithin(PROJECT_REQUEST_TEXT_LIMITS.projectName), isApplicable: alwaysApplicable },
  { field: "projectType", isAnswered: isCatalogOption(READABLE_PROJECT_REQUEST_TYPES), isApplicable: alwaysApplicable },
  { field: "location", isAnswered: isTextWithin(PROJECT_REQUEST_TEXT_LIMITS.projectLocation), isApplicable: alwaysApplicable },
  { field: "description", isAnswered: isTextWithin(PROJECT_REQUEST_TEXT_LIMITS.description), isApplicable: alwaysApplicable },
  { field: "projectSize", isAnswered: isCatalogOption(PROJECT_REQUEST_VALUES.projectSize), isApplicable: alwaysApplicable },
  { field: "developmentMode", isAnswered: isCatalogOption(PROJECT_REQUEST_VALUES.developmentMode), isApplicable: alwaysApplicable },
  { field: "landStatus", isAnswered: isCatalogOption(PROJECT_REQUEST_VALUES.landStatus), isApplicable: appliesLandStatus },
  { field: "standRequirements.requirementsStatus", isAnswered: isCatalogOption(STAND_REQUIREMENTS_VALUES.requirementsStatus), isApplicable: appliesWithStandSection, read: readStandAnswer("requirementsStatus") },
  { field: "standRequirements.documentTypes", isAnswered: isDocumentList(STAND_REQUIREMENTS_VALUES.documentTypes), isApplicable: appliesWithStandDocuments, read: readStandAnswer("documentTypes") },
  { field: "standRequirements.spaceStatus", isAnswered: isCatalogOption(STAND_REQUIREMENTS_VALUES.spaceStatus), isApplicable: appliesWithStandSection, read: readStandAnswer("spaceStatus") },
  { field: "standRequirements.hasSpacePlans", isAnswered: isExplicitBoolean, isApplicable: appliesWithStandSection, read: readStandAnswer("hasSpacePlans") },
  { field: "legalDocumentationStatus", isAnswered: isCatalogOption(PROJECT_REQUEST_VALUES.legalDocumentationStatus), isApplicable: appliesWithProperty },
  { field: "legalDocumentTypes", isAnswered: isDocumentList(PROJECT_REQUEST_VALUES.legalDocumentTypes), isApplicable: hasAvailableLegalDocumentation },
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
 * Obtiene la respuesta guardada de una pregunta del catálogo.
 * Usa el lector de la pregunta para respuestas anidadas y, si no tiene, el campo homónimo.
 *
 * @param {{field: string, read?: (answers: object) => unknown}} question - Pregunta del catálogo.
 * @param {object} answers - Respuestas de la solicitud.
 * @returns {unknown} Respuesta guardada.
 */
function readAnswer(question, answers) {
  return question.read ? question.read(answers) : answers[question.field];
}

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
    .filter((question) => !question.isAnswered(readAnswer(question, source)))
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
