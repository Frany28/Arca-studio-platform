#!/usr/bin/env node
/*
 * Genera `docs/INFORME_30_ESCENARIOS_EVALUACION_V33.md` ejecutando los 30 escenarios de
 * calibración sobre el motor real de evaluación 3.3.
 *
 * - Fuente única de escenarios: `tests/fixtures/projectRequestCalibrationScenarios.js` (la misma
 *   que usa la prueba de calibración). El informe solo toma de ella el identificador, las
 *   respuestas y la descripción; todos los resultados provienen de las funciones del dominio.
 * - Funciones puras: no se conecta a PostgreSQL ni a Supabase, no escribe datos y no usa red.
 * - Determinista: mismas respuestas y misma fecha producen el mismo documento.
 *
 * Uso (desde `Backend`):
 *   node scripts/generate-evaluation-scenarios-report.mjs [--date=AAAA-MM-DD] [--output=ruta] [--check]
 *
 * `--check` no escribe el archivo: compara el documento existente con el que se generaría y
 * termina con código 1 si difieren.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { COMPATIBILITY_SCORING_VERSION, evaluateProjectCompatibility } from "../src/domain/projectRequestCompatibility.js";
import { COMPLETENESS_QUESTIONS, evaluateProjectRequestCompleteness } from "../src/domain/projectRequestCompleteness.js";
import { evaluateFinancialViability } from "../src/domain/projectRequestFinancialViability.js";
import { buildProjectRequestReviewObservations } from "../src/domain/projectRequestReviewObservations.js";
import { CALIBRATION_SCENARIOS, SCENARIO_DESCRIPTIONS } from "../tests/fixtures/projectRequestCalibrationScenarios.js";
import { PROJECT_REQUEST_COMPATIBILITY_LABELS } from "../../Frontend/src/utils/projectRequestCompatibility.js";
import { PROJECT_REQUEST_OPTIONS } from "../../Frontend/src/utils/projectRequestOptions.js";
import { PROJECT_TYPE_LABELS } from "../../Frontend/src/utils/projectTypeDisplay.js";

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = path.resolve(BACKEND_DIR, "../docs/INFORME_30_ESCENARIOS_EVALUACION_V33.md");
const DEFAULT_DATE = "2026-11-04";
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// Textos de estados financieros y causas tal como los nombra la Propuesta V3.3 (§6 y §8).
const FINANCIAL_STATUS_LABELS = Object.freeze({
  HIGH_RISK: "Riesgo financiero elevado",
  INSUFFICIENT_DATA: "Información financiera insuficiente",
  NO_OBVIOUS_CONFLICT: "Sin incoherencias financieras detectadas",
  PENDING_RULES: "Pendiente de reglas de evaluación",
  REVIEW_REQUIRED: "Requiere revisión financiera",
});
const FINANCIAL_STATUS_MEANING = Object.freeze({
  HIGH_RISK: "hay una combinación que la propuesta considera de riesgo elevado; no demuestra que el proyecto sea inviable.",
  INSUFFICIENT_DATA: "faltan datos para contrastar la inversión con el alcance del proyecto.",
  NO_OBVIOUS_CONFLICT: "las reglas disponibles no encuentran contradicciones económicas; no equivale a una aprobación financiera.",
  PENDING_RULES: "estado reservado; la configuración actual no lo genera.",
  REVIEW_REQUIRED: "hay un cruce económico que conviene aclarar con el cliente.",
});
const CAUSES = Object.freeze({
  CAPITAL_TIMING_MISMATCH: ["Disponibilidad del capital frente al plazo de inicio", "Origen de los fondos y fecha en que estarán disponibles."],
  EXECUTION_MODE_UNDEFINED: ["Modalidad de desarrollo «Por definir»", "Si el proyecto se desarrollará por fases o en su totalidad."],
  FINANCIAL_DEFINITION_INSUFFICIENT: ["Rango de inversión sin definir", "Rango presupuestario disponible para el proyecto."],
  FINANCIAL_SCOPE_MISMATCH: ["Inversión baja frente al tamaño o la calidad", "Qué cubre el presupuesto (diseño, una fase o la ejecución) y su relación con el alcance."],
  LEGAL_DOCUMENTATION_PENDING: ["Documentación legal del inmueble pendiente", "Situación legal del inmueble y plazo del trámite."],
  PROJECT_SIZE_UNDEFINED: ["Tamaño desconocido pudiendo estimarlo", "Superficie aproximada del inmueble o del espacio."],
  PROPERTY_TIMING_MISMATCH: ["Disponibilidad del inmueble frente al plazo de inicio", "Plazo en que el inmueble estará disponible."],
});

// Preguntas del formulario en el orden de la Propuesta V3.3 §5 (Inputs 01–21) con su campo de completitud.
const QUESTIONS = Object.freeze([
  ["01", "Nombre del proyecto", "projectName", (answers) => commonText(answers.projectName)],
  ["02", "Tipo de proyecto", "projectType", (answers) => PROJECT_TYPE_LABELS[answers.projectType]],
  ["03", "Ubicación del proyecto", "location", (answers) => commonText(answers.location)],
  ["04", "Descripción del proyecto", "description", (answers) => commonText(answers.description)],
  ["05", "Tamaño aproximado del proyecto", "projectSize", (answers) => optionLabel("projectSize", answers.projectSize)],
  ["06", "¿Cómo desea desarrollar el proyecto?", "developmentMode", (answers) => optionLabel("developmentMode", answers.developmentMode)],
  ["07", "¿Tiene terreno o inmueble disponible?", "landStatus", (answers) => optionLabel("landStatus", answers.landStatus)],
  ["08", "¿El evento cuenta con normas o requisitos para el montaje del stand?", "standRequirements.requirementsStatus", (answers) => optionLabel("standRequirementsStatus", answers.standRequirements?.requirementsStatus)],
  ["09", "Documentación disponible (evento)", "standRequirements.documentTypes", (answers) => optionList("standDocumentTypes", answers.standRequirements?.documentTypes)],
  ["10", "¿Ya tienes asignado el espacio dentro del evento?", "standRequirements.spaceStatus", (answers) => optionLabel("standSpaceStatus", answers.standRequirements?.spaceStatus)],
  ["11", "¿Tienes las medidas o plano del espacio asignado?", "standRequirements.hasSpacePlans", (answers) => yesNo(answers.standRequirements?.hasSpacePlans)],
  ["12", "¿Cuenta con documentación que acredite la situación legal del inmueble?", "legalDocumentationStatus", (answers) => optionLabel("legalDocumentationStatus", answers.legalDocumentationStatus)],
  ["13", "Documentación disponible (inmueble)", "legalDocumentTypes", (answers) => optionList("legalDocumentTypes", answers.legalDocumentTypes)],
  ["14", "¿El inmueble tiene más de un propietario?", "hasMultipleOwners", (answers) => yesNo(answers.hasMultipleOwners)],
  ["15", "¿Dispone de planos del lugar?", "hasPlans", (answers) => yesNo(answers.hasPlans)],
  ["16", "Rango de inversión estimado", "investmentRange", (answers) => optionLabel("investmentRange", answers.investmentRange)],
  ["17", "Disponibilidad del capital", "capitalAvailability", (answers) => optionLabel("capitalAvailability", answers.capitalAvailability)],
  ["18", "¿Cuándo espera iniciar el proyecto?", "startTime", (answers) => optionLabel("startTime", answers.startTime)],
  ["19", "¿Quién toma la decisión final del proyecto?", "decisionMaker", (answers) => optionLabel("decisionMaker", answers.decisionMaker)],
  ["20", "Expectativa de estilo / nivel de calidad", "quality", (answers) => optionLabel("quality", answers.quality)],
  ["21", "¿Ha trabajado con un arquitecto o diseñador antes?", "experience", (answers) => optionLabel("experience", answers.experience)],
]);
const QUESTION_BY_FIELD = new Map(QUESTIONS.map(([, question, field]) => [field, question]));

/**
 * Lee los argumentos `--clave=valor` y `--bandera` de la línea de comandos.
 *
 * @param {Array<string>} argv - Argumentos posteriores al script.
 * @returns {{check: boolean, date: string, output: string}} Opciones de ejecución.
 */
function parseArguments(argv) {
  const options = { check: false, date: DEFAULT_DATE, output: DEFAULT_OUTPUT };
  for (const argument of argv) {
    if (argument === "--check") options.check = true;
    else if (argument.startsWith("--date=")) options.date = argument.slice("--date=".length);
    else if (argument.startsWith("--output=")) options.output = path.resolve(argument.slice("--output=".length));
    else throw new Error(`Argumento desconocido: ${argument}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) throw new Error("La fecha debe tener el formato AAAA-MM-DD.");
  return options;
}

/**
 * Describe un texto técnico común a todos los escenarios: solo debe ser válido y no influye en
 * la evaluación (Propuesta V3.3, Inputs 01, 03 y 04).
 *
 * @param {string} value - Texto del escenario.
 * @returns {string} Descripción de su validez.
 */
function commonText(value) {
  return `Texto válido de ${String(value).trim().length} caracteres (valor técnico común; no influye en la evaluación)`;
}

/**
 * Traduce un valor guardado a la etiqueta del catálogo del formulario.
 *
 * @param {string} field - Campo de PROJECT_REQUEST_OPTIONS.
 * @param {string|null|undefined} value - Valor guardado.
 * @returns {string|null} Etiqueta visible o null si no hay respuesta.
 */
function optionLabel(field, value) {
  return PROJECT_REQUEST_OPTIONS[field]?.find((option) => option.value === value)?.label ?? null;
}

/**
 * Traduce una lista de valores a sus etiquetas separadas por comas.
 *
 * @param {string} field - Campo de PROJECT_REQUEST_OPTIONS.
 * @param {Array<string>|undefined} values - Valores guardados.
 * @returns {string|null} Etiquetas o null si la lista está vacía.
 */
function optionList(field, values) {
  const labels = (values || []).map((value) => optionLabel(field, value) || value);
  return labels.length ? labels.join(", ") : null;
}

/**
 * Traduce un booleano opcional a «Sí» o «No».
 *
 * @param {boolean|null|undefined} value - Respuesta guardada.
 * @returns {string|null} Respuesta visible o null si no se respondió.
 */
function yesNo(value) {
  if (value === true) return "Sí";
  if (value === false) return "No";
  return null;
}

/**
 * Formatea una fecha AAAA-MM-DD en español.
 *
 * @param {string} isoDate - Fecha en formato ISO corto.
 * @returns {string} Fecha legible.
 */
function formatDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${day} de ${MONTHS[month - 1]} de ${year}`;
}

/**
 * Ejecuta las cuatro funciones del motor sobre las respuestas de un escenario.
 *
 * @param {Array} scenario - Entrada de CALIBRATION_SCENARIOS; solo se usan id y respuestas.
 * @param {number} index - Posición del escenario (numeración original).
 * @returns {object} Resultado real del motor con datos de presentación.
 */
function runScenario([id, answers], index) {
  const compatibility = evaluateProjectCompatibility(answers);
  const completeness = evaluateProjectRequestCompleteness(answers);
  const financial = evaluateFinancialViability(answers);
  const observations = buildProjectRequestReviewObservations(answers);
  const [name, situation] = SCENARIO_DESCRIPTIONS[id];
  return {
    answers,
    compatibility,
    completeness,
    deduction: compatibility.findings.reduce((total, finding) => total + finding.deduction, 0),
    financial,
    id,
    name,
    number: index + 1,
    observations,
    situation,
    type: PROJECT_TYPE_LABELS[answers.projectType],
  };
}

/**
 * Compara el resultado del motor con la prueba de calibración del mismo escenario. Los valores
 * esperados solo se usan para esta comprobación; el informe nunca los muestra como resultados.
 *
 * @param {object} result - Resultado del motor.
 * @param {Array} scenario - Entrada de CALIBRATION_SCENARIOS con sus valores esperados.
 * @returns {Array<string>} Diferencias encontradas (vacío si coincide).
 */
function compareWithCalibration(result, [, , causes, [answered, applicable], financialStatus, observations = []]) {
  const differences = [];
  const engineCauses = Object.fromEntries(result.compatibility.findings.map(({ code, deduction }) => [code, deduction]));
  const sorted = (object) => JSON.stringify(Object.entries(object).sort(([left], [right]) => left.localeCompare(right)));
  if (sorted(engineCauses) !== sorted(causes)) differences.push(`causas ${sorted(engineCauses)} frente a ${sorted(causes)}`);
  if (result.completeness.answered !== answered || result.completeness.applicable !== applicable) {
    differences.push(`completitud ${result.completeness.answered}/${result.completeness.applicable} frente a ${answered}/${applicable}`);
  }
  if (result.financial.status !== financialStatus) differences.push(`estado financiero ${result.financial.status} frente a ${financialStatus}`);
  const engineObservations = result.observations.map(({ code }) => code);
  if (JSON.stringify(engineObservations) !== JSON.stringify(observations)) differences.push(`avisos ${engineObservations} frente a ${observations}`);
  if (result.compatibility.version !== COMPATIBILITY_SCORING_VERSION) differences.push(`versión ${result.compatibility.version}`);
  return differences;
}

/**
 * Comprueba las reglas estructurales de la propuesta sobre un resultado del motor: puntuación igual
 * a 100 menos una deducción por causa (limitada a 0–100), clasificación por umbrales y porcentaje
 * redondeado de información completada.
 *
 * @param {object} result - Resultado del motor.
 * @returns {Array<string>} Incumplimientos encontrados (vacío si es consistente).
 */
function checkRules(result) {
  const issues = [];
  const codes = result.compatibility.findings.map(({ code }) => code);
  if (new Set(codes).size !== codes.length) issues.push("una causa aparece más de una vez");
  if (result.compatibility.score !== Math.max(0, Math.min(100, 100 - result.deduction))) issues.push("la puntuación no es 100 − Σ deducciones");
  const expectedLevel = result.compatibility.score >= 80 ? "excellent" : result.compatibility.score >= 60 ? "high"
    : result.compatibility.score >= 40 ? "medium" : result.compatibility.score >= 20 ? "low" : "poorly_defined";
  if (result.compatibility.level !== expectedLevel) issues.push("la clasificación no corresponde a los umbrales");
  const { answered, applicable, score } = result.completeness;
  if (score !== Math.round((answered / applicable) * 100)) issues.push("el porcentaje de información completada no es el redondeo esperado");
  if (result.financial.score !== null) issues.push("la coherencia financiera tiene porcentaje");
  return issues;
}

/**
 * Tabla de respuestas del escenario, con N/A para preguntas no aplicables y «Sin responder» para
 * las aplicables pendientes, según la completitud calculada por el motor.
 *
 * @param {object} result - Resultado del motor.
 * @returns {string} Tabla Markdown.
 */
function answersTable(result) {
  const applicable = new Set(COMPLETENESS_QUESTIONS.filter((question) => question.isApplicable(result.answers)).map(({ field }) => field));
  const missing = new Set(result.completeness.missingFields);
  const rows = QUESTIONS.map(([number, question, field, read]) => {
    if (!applicable.has(field)) return `| ${number} | ${question} | N/A (no aplica) |`;
    if (missing.has(field)) return `| ${number} | ${question} | Sin responder (pendiente) |`;
    return `| ${number} | ${question} | ${read(result.answers)} |`;
  });
  rows.push("| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |");
  rows.push(`| 23 | Link de referencia | ${result.answers.referenceLink ? "Enlace http/https registrado" : "Sin enlace"} (opcional; no puntúa ni cuenta para la información completada) |`);
  return ["| Input | Pregunta | Respuesta |", "| --- | --- | --- |", ...rows].join("\n");
}

/**
 * Tabla de causas y deducciones reales del motor, con las respuestas (evidencias) que las activan.
 *
 * @param {object} result - Resultado del motor.
 * @returns {string} Tabla Markdown o texto si no hay causas.
 */
function findingsTable(result) {
  if (!result.compatibility.findings.length) return "Ninguna causa activada.";
  const rows = result.compatibility.findings.map((finding) => (
    `| ${finding.code} | ${CAUSES[finding.code]?.[0] || finding.code} | ${finding.evidence.map(({ code }) => `\`${code}\``).join(", ")} | ${finding.explanation} | −${finding.deduction} |`
  ));
  return ["| Causa | Descripción | Evidencias | Explicación del motor | Deducción |", "| --- | --- | --- | --- | ---: |", ...rows].join("\n");
}

/**
 * Explicación en lenguaje sencillo construida a partir de los resultados del motor.
 *
 * @param {object} result - Resultado del motor.
 * @returns {string} Párrafo de interpretación.
 */
function interpretation(result) {
  const { compatibility, completeness, financial } = result;
  const parts = [];
  if (!compatibility.findings.length) {
    parts.push("La solicitud no presenta indefiniciones ni contradicciones que resten puntos.");
  } else {
    const causes = compatibility.findings.map((finding) => `${CAUSES[finding.code]?.[0].toLowerCase() || finding.code} (−${finding.deduction})`);
    parts.push(`La puntuación baja por ${compatibility.findings.length === 1 ? "una causa" : `${compatibility.findings.length} causas distintas`}: ${causes.join("; ")}.`);
    const grouped = compatibility.findings.filter((finding) => finding.evidence.length > 1);
    for (const finding of grouped) {
      parts.push(`Varias respuestas apuntan a la misma causa (${finding.evidence.map(({ code }) => code).join(", ")}) y solo se descuenta la mayor, −${finding.deduction}.`);
    }
  }
  parts.push(`Coherencia financiera: ${FINANCIAL_STATUS_MEANING[financial.status]}`);
  if (completeness.missingFields.length) {
    parts.push(`Quedan ${completeness.missingFields.length} ${completeness.missingFields.length === 1 ? "pregunta aplicable" : "preguntas aplicables"} sin responder, que bajan la información completada al ${completeness.score} % sin restar compatibilidad.`);
  }
  parts.push("La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.");
  return parts.join(" ");
}

/**
 * Aspectos que el equipo debería aclarar, derivados de causas, hallazgos financieros, preguntas
 * pendientes y avisos administrativos del motor.
 *
 * @param {object} result - Resultado del motor.
 * @returns {Array<string>} Lista de aspectos sin repetir.
 */
function clarifications(result) {
  const items = result.compatibility.findings.map((finding) => CAUSES[finding.code]?.[1]).filter(Boolean);
  for (const finding of result.financial.findings) {
    if (!result.compatibility.findings.some(({ code }) => code === finding.code)) items.push(finding.explanation);
  }
  for (const field of result.completeness.missingFields) items.push(`Respuesta pendiente: «${QUESTION_BY_FIELD.get(field) || field}».`);
  for (const observation of result.observations) items.push(observation.explanation);
  const unique = [...new Set(items)];
  return unique.length ? unique : ["Confirmar en la reunión inicial el alcance concreto del trabajo."];
}

/**
 * Sección Markdown completa de un escenario con sus resultados reales.
 *
 * @param {object} result - Resultado del motor.
 * @returns {string} Bloque Markdown.
 */
function scenarioSection(result) {
  const { compatibility, completeness, financial } = result;
  const financialReasons = financial.findings.length
    ? financial.findings.map((finding) => `  - **${finding.code}** (${finding.evidence.map(({ code }) => code).join(", ")}): ${finding.explanation}`).join("\n")
    : "  - Ninguno.";
  const observations = result.observations.length
    ? result.observations.map(({ explanation }) => explanation).join(" ")
    : "Ninguna.";
  return `### Escenario ${result.number} · ${result.id} — ${result.name}

**Tipo de proyecto:** ${result.type}. **Situación simulada:** ${result.situation}

**Respuestas del formulario**

${answersTable(result)}

**Resultados del motor (versión ${compatibility.version})**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −${result.deduction} |
| Compatibilidad | **${compatibility.score}** |
| Clasificación | ${PROJECT_REQUEST_COMPATIBILITY_LABELS[compatibility.level]} |
| Información completada | ${completeness.score} % (${completeness.answered} de ${completeness.applicable} preguntas aplicables) |
| Coherencia financiera | ${FINANCIAL_STATUS_LABELS[financial.status]} |

**Deducciones por causa**

${findingsTable(result)}

**Motivos de la coherencia financiera**

${financialReasons}

**Preguntas pendientes:** ${completeness.missingFields.length ? completeness.missingFields.map((field) => `«${QUESTION_BY_FIELD.get(field) || field}»`).join(", ") : "ninguna"}.

**Observaciones administrativas:** ${observations}

**Interpretación.** ${interpretation(result)}

**Aspectos a aclarar**

${clarifications(result).map((item) => `- ${item}`).join("\n")}
`;
}

/**
 * Cuenta ocurrencias por clave conservando el orden de aparición.
 *
 * @param {Array<object>} results - Resultados del motor.
 * @param {(result: object) => Array<string>|string} keyOf - Clave o claves de cada resultado.
 * @returns {Array<[string, number]>} Pares clave-frecuencia ordenados de mayor a menor.
 */
function frequency(results, keyOf) {
  const counts = new Map();
  for (const result of results) {
    for (const key of [keyOf(result)].flat()) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort(([, left], [, right]) => right - left);
}

/**
 * Lista breve «ID (puntuación)» para el análisis.
 *
 * @param {Array<object>} results - Resultados del motor.
 * @returns {string} Lista separada por comas o «ninguno».
 */
function idList(results) {
  return results.length ? results.map((result) => `${result.id} (${result.compatibility.score})`).join(", ") : "ninguno";
}

/**
 * Construye el informe completo a partir de los 30 resultados reales.
 *
 * @param {Array<object>} results - Resultados del motor, en el orden original.
 * @param {{calibrationDifferences: Array, date: string, ruleIssues: Array}} verification - Comprobaciones.
 * @returns {string} Documento Markdown.
 */
function buildReport(results, { calibrationDifferences, date, ruleIssues }) {
  const scores = results.map(({ compatibility }) => compatibility.score);
  const average = scores.reduce((total, score) => total + score, 0) / scores.length;
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const levelLabel = (result) => PROJECT_REQUEST_COMPATIBILITY_LABELS[result.compatibility.level];
  const financialLabel = (result) => FINANCIAL_STATUS_LABELS[result.financial.status];
  // Distribuciones en el orden de los umbrales (§10) y de los estados (§8), con ceros incluidos.
  const LEVEL_ORDER = ["excellent", "high", "medium", "low", "poorly_defined"];
  const STATUS_ORDER = ["NO_OBVIOUS_CONFLICT", "REVIEW_REQUIRED", "HIGH_RISK", "INSUFFICIENT_DATA", "PENDING_RULES"];
  const byLevel = LEVEL_ORDER.map((level) => [PROJECT_REQUEST_COMPATIBILITY_LABELS[level], results.filter(({ compatibility }) => compatibility.level === level).length]);
  const byFinancial = STATUS_ORDER.map((status) => [FINANCIAL_STATUS_LABELS[status], results.filter(({ financial }) => financial.status === status).length]);
  const byCause = frequency(results.filter(({ compatibility }) => compatibility.findings.length), (result) => result.compatibility.findings.map(({ code }) => code));
  const byFinancialFinding = frequency(results.filter(({ financial }) => financial.findings.length), (result) => result.financial.findings.map(({ code }) => code));
  const complete = results.filter(({ completeness }) => completeness.score === 100);
  const byType = [...new Set(results.map(({ type }) => type))].map((type) => {
    const group = results.filter((result) => result.type === type);
    const typeAverage = group.reduce((total, { compatibility }) => total + compatibility.score, 0) / group.length;
    return [type, group.length, typeAverage, Math.min(...group.map(({ compatibility }) => compatibility.score)), Math.max(...group.map(({ compatibility }) => compatibility.score))];
  });

  const highest = results.filter(({ compatibility }) => compatibility.score === maxScore);
  const lowest = [...results].sort((left, right) => left.compatibility.score - right.compatibility.score).slice(0, 3);
  const completeWithContradictions = complete.filter(({ compatibility, financial }) => compatibility.findings.length || financial.status !== "NO_OBVIOUS_CONFLICT");
  const incompleteCoherent = results.filter(({ compatibility, completeness }) => completeness.score < 100 && compatibility.findings.length === 0);
  const incompleteWithCauses = results.filter(({ compatibility, completeness }) => completeness.score < 100 && compatibility.findings.length > 0);
  const excellentWithWarning = results.filter(({ compatibility, financial }) => compatibility.level === "excellent" && financial.status !== "NO_OBVIOUS_CONFLICT");
  const stands = results.filter(({ answers }) => answers.projectType === "advertising_stand");
  const standsUnknownSizeNoDeduction = stands.filter(({ answers, compatibility }) => ["unknown", null].includes(answers.projectSize ?? null) && !compatibility.findings.some(({ code }) => code === "PROJECT_SIZE_UNDEFINED"));
  const standsImmediate = stands.filter(({ answers }) => answers.startTime === "immediate");
  const standsSharedMatrix = stands.filter(({ compatibility }) => compatibility.findings.some(({ code }) => code === "FINANCIAL_SCOPE_MISMATCH"));
  const adminReview = results.filter(({ compatibility, financial, observations }) => compatibility.findings.length >= 2 || financial.status === "HIGH_RISK" || financial.status === "REVIEW_REQUIRED" || observations.length);
  const groupedCauses = results.filter(({ compatibility }) => compatibility.findings.some((finding) => finding.evidence.length > 1));

  // Independencia de las tres métricas, observada en los resultados.
  const perfectButIncomplete = results.filter(({ compatibility, completeness }) => compatibility.score === 100 && completeness.score < 100);
  const completeButLow = complete.filter(({ compatibility }) => compatibility.score < 80);
  const excellentHighRisk = results.filter(({ compatibility, financial }) => compatibility.level === "excellent" && financial.status === "HIGH_RISK");

  const summaryRows = results.map((result) => (
    `| ${result.number} | ${result.id} | ${result.type} | ${result.name} | ${result.compatibility.score} | ${levelLabel(result)} | ${result.completeness.score} % (${result.completeness.answered}/${result.completeness.applicable}) | ${financialLabel(result)} | ${result.compatibility.findings.map(({ code, deduction }) => `${code} −${deduction}`).join("; ") || "—"} |`
  ));
  const totalCalibrationDifferences = calibrationDifferences.filter(({ differences }) => differences.length);
  const totalRuleIssues = ruleIssues.filter(({ issues }) => issues.length);
  const fmt = (value) => value.toLocaleString("es-VE", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

  return `# Evaluación de solicitudes de proyecto — Resultados de 30 escenarios ejecutados con el motor 3.3

| | |
| --- | --- |
| **Organización** | ARCA Studio |
| **Objeto** | Evaluación preliminar de solicitudes de proyecto |
| **Algoritmo** | Versión ${COMPATIBILITY_SCORING_VERSION} (motor vigente del sistema) |
| **Casos ejecutados** | ${results.length} escenarios de calibración interna |
| **Fecha de elaboración** | ${formatDate(date)} |
| **Estado** | Estudio de calibración interna, pendiente de aprobación de la dirección |
| **Documento de referencia** | *Propuesta de Algoritmo de Evaluación · Solicitudes de Proyecto · Fórmula 3.3* (9 de octubre de 2026) |

> Documento generado automáticamente por \`Backend/scripts/generate-evaluation-scenarios-report.mjs\`. No editar a mano: los resultados proceden de la ejecución del motor y se regeneran con el script. Los escenarios son **casos simulados** diseñados para cubrir las reglas; no corresponden a clientes reales ni son los escenarios oficiales del anexo que la propuesta prevé aprobar.

## 1. Introducción

ARCA Studio recibe solicitudes preliminares de proyectos residenciales, comerciales, corporativos y de stands publicitarios. El algoritmo de evaluación apoya al administrador y al arquitecto: indica qué tan preparada está una solicitud, si sus respuestas son coherentes entre sí y qué combinaciones económicas conviene aclarar antes de crear un proyecto.

Produce tres resultados independientes:

1. **Compatibilidad** (preparación y coherencia): puntuación de 0 a 100 con una clasificación.
2. **Información completada:** porcentaje de preguntas aplicables con respuesta.
3. **Coherencia financiera orientativa:** estado cualitativo con sus motivos, sin porcentaje.

**Limitaciones de la evaluación preliminar.** La evaluación no aprueba ni rechaza proyectos, no califica la seriedad del cliente, no verifica fondos, documentos ni la situación jurídica, no estima costos reales y no determina si el presupuesto cubre diseño, ejecución o ambos. Una puntuación baja nunca impide enviar la solicitud. La compatibilidad no equivale a solvencia, rentabilidad ni viabilidad técnica.

## 2. Metodología

- **Ejecución sobre el motor real.** Los ${results.length} casos se ejecutaron directamente con las funciones del backend \`evaluateProjectCompatibility\`, \`evaluateProjectRequestCompleteness\`, \`evaluateFinancialViability\` y \`buildProjectRequestReviewObservations\` (\`Backend/src/domain\`).
- **Entorno aislado y sin persistencia.** Las funciones son puras: el script no se conecta a PostgreSQL ni a Supabase, no crea solicitudes y no modifica datos.
- **Escenarios.** Son los 30 escenarios de calibración interna definidos en \`Backend/tests/fixtures/projectRequestCalibrationScenarios.js\`, la misma fuente que usa la prueba \`projectRequestCalibrationV33.test.js\`. Cada uno parte de un perfil base (arquitectura preparada o stand preparado) y cambia solo las respuestas que definen su situación.
- **Resultados.** Todas las puntuaciones, causas, porcentajes, estados y observaciones de este documento son la salida del motor. El nombre, la ubicación y la descripción son textos técnicos comunes que solo deben ser válidos y no influyen en la evaluación.
- **Reglas aplicadas por el motor** (Propuesta V3.3): la solicitud parte de 100 puntos; cada causa distinta descuenta una vez, con la deducción mayor de sus respuestas; las causas distintas se acumulan; las preguntas no aplicables (N/A) no suman, no restan ni cuentan para la información completada; la clasificación sigue los umbrales 80, 60, 40 y 20; la coherencia financiera es un estado sin puntos.

## 3. Resultados individuales

${results.map(scenarioSection).join("\n")}
## 4. Tabla comparativa

| N.º | ID | Tipo | Escenario | Compatibilidad | Clasificación | Información completada | Coherencia financiera | Causas |
| ---: | --- | --- | --- | ---: | --- | --- | --- | --- |
${summaryRows.join("\n")}

## 5. Análisis general

**Mayor y menor compatibilidad.** ${highest.length} escenarios alcanzan la máxima puntuación (${maxScore}): ${idList(highest)}. Las puntuaciones más bajas son ${idList(lowest)}.

**Solicitudes completas con contradicciones.** ${completeWithContradictions.length} escenarios tienen el 100 % de la información completada y, aun así, causas de deducción o advertencias financieras: ${idList(completeWithContradictions)}. Responder todas las preguntas no garantiza una solicitud preparada: «No lo sé aún», «Por definir» o «Indefinido» cuentan como respuestas.

**Solicitudes incompletas pero coherentes.** ${incompleteCoherent.length} escenarios tienen preguntas pendientes y ninguna causa de deducción: ${idList(incompleteCoherent)}. Las preguntas opcionales sin responder bajan la información completada, no la compatibilidad.${incompleteWithCauses.length ? ` Con preguntas pendientes y alguna causa: ${idList(incompleteWithCauses)}.` : ""}

**Inconsistencias financieras más frecuentes.** Hallazgos de la coherencia financiera: ${byFinancialFinding.map(([code, total]) => `${code} (${total})`).join(", ")}. ${excellentWithWarning.length} escenarios en «Excelente compatibilidad» presentan una advertencia financiera: ${excellentWithWarning.map((result) => `${result.id} (${financialLabel(result)})`).join(", ")}.

**Diferencias entre tipos de proyecto.**

| Tipo | Casos | Promedio | Mínima | Máxima |
| --- | ---: | ---: | ---: | ---: |
${byType.map(([type, total, typeAverage, min, max]) => `| ${type} | ${total} | ${fmt(typeAverage)} | ${min} | ${max} |`).join("\n")}

Las diferencias reflejan las situaciones elegidas en cada grupo, no un trato distinto por tipo: las reglas son comunes, salvo las propias de los stands.

**Situaciones especiales de los stands.** En los ${stands.length} stands no se pregunta por inmueble ni documentación legal. El tamaño desconocido no resta cuando no es estimable (${idList(standsUnknownSizeNoDeduction)}). Con inicio inmediato (${idList(standsImmediate)}) no se aplica el cruce de inmueble frente al inicio. Los cruces económicos usan provisionalmente la misma matriz que la arquitectura (${idList(standsSharedMatrix)}); su tratamiento propio está pendiente de decisión de la dirección.

**Una causa, una deducción.** En ${groupedCauses.length} escenarios varias respuestas apuntan a una misma causa y solo se descuenta la mayor: ${idList(groupedCauses)}.

**Casos que requieren revisión administrativa.** ${adminReview.length} escenarios combinan dos o más causas, una advertencia financiera de revisión o riesgo, u observaciones administrativas: ${idList(adminReview)}. Requieren una conversación con el cliente antes de avanzar.

**Independencia de las tres métricas.** Se observa en los propios resultados: ${perfectButIncomplete.length ? `compatibilidad 100 con información incompleta (${perfectButIncomplete.map(({ id, completeness }) => `${id}: ${completeness.score} %`).join(", ")})` : "ningún caso con compatibilidad 100 e información incompleta"}; información completa con compatibilidad inferior a 80 (${idList(completeButLow)}); y «Excelente compatibilidad» con riesgo financiero elevado (${idList(excellentHighRisk)}). Ninguna métrica se deriva de otra.

## 6. Estadísticas

| Indicador | Valor |
| --- | --- |
| Escenarios ejecutados | ${results.length} |
| Promedio de compatibilidad | ${fmt(average)} |
| Puntuación máxima | ${maxScore} (${highest.map(({ id }) => id).join(", ")}) |
| Puntuación mínima | ${minScore} (${results.filter(({ compatibility }) => compatibility.score === minScore).map(({ id }) => id).join(", ")}) |
| Casos con información completada al 100 % | ${complete.length} de ${results.length} |
| Casos sin ninguna causa de deducción | ${results.filter(({ compatibility }) => !compatibility.findings.length).length} de ${results.length} |

**Distribución por clasificación**

| Clasificación | Casos |
| --- | ---: |
${byLevel.map(([label, total]) => `| ${label} | ${total} |`).join("\n")}

**Distribución por estado financiero**

| Estado | Casos |
| --- | ---: |
${byFinancial.map(([label, total]) => `| ${label} | ${total} |`).join("\n")}

**Frecuencia de cada causa de deducción** (número de escenarios en que aparece)

| Causa | Descripción | Escenarios |
| --- | --- | ---: |
${byCause.map(([code, total]) => `| ${code} | ${CAUSES[code]?.[0] || code} | ${total} |`).join("\n")}

## 7. Conclusiones

**Comportamiento observado.** En los ${results.length} casos el motor aplica una sola deducción por causa, acumula causas independientes, respeta las preguntas no aplicables y no penaliza el material opcional (archivos, enlaces y planos). La clasificación «Excelente» concentra ${byLevel.find(([label]) => label === PROJECT_REQUEST_COMPATIBILITY_LABELS.excellent)?.[1] || 0} casos, y una sola causa de −20 deja una solicitud exactamente en el límite inferior de esa clasificación, por lo que la compatibilidad debe leerse siempre junto con la coherencia financiera y la información completada.

**Decisiones que corresponden a cada rol.**

- **Administración:** aclarar con el cliente las causas activadas, las respuestas pendientes y los motivos financieros de cada solicitud; atender las observaciones sobre planos.
- **Arquitectura:** valorar el alcance técnico real (superficie, modalidad, levantamiento de planos) y si el presupuesto es razonable para lo solicitado.
- **Dirección:** decidir si se mantiene provisionalmente la matriz económica común para los stands o se definen rangos propios, y aprobar estos 30 escenarios como anexo oficial o sustituirlos. Cualquier ajuste de deducciones o umbrales debería basarse en solicitudes reales y no en estos casos simulados.

## 8. Verificación

| Comprobación | Resultado |
| --- | --- |
| Escenarios ejecutados | ${results.length} |
| Versión del motor | ${COMPATIBILITY_SCORING_VERSION} |
| Reglas estructurales (100 − Σ deducciones, una causa una vez, umbrales, redondeo, sin porcentaje financiero) | ${totalRuleIssues.length ? `**${totalRuleIssues.length} incumplimientos**` : "Cumplidas en los 30 casos"} |
| Coincidencia con la prueba de calibración \`projectRequestCalibrationV33.test.js\` | ${results.length - totalCalibrationDifferences.length} de ${results.length} |

${totalRuleIssues.length || totalCalibrationDifferences.length ? `**Diferencias encontradas**\n\n${[...totalRuleIssues.map(({ id, issues }) => `- ${id}: ${issues.join("; ")}`), ...totalCalibrationDifferences.map(({ id, differences }) => `- ${id}: ${differences.join("; ")}`)].join("\n")}\n` : "No se encontraron diferencias entre el motor, las reglas de la propuesta y la prueba de calibración."}

Para regenerar el informe: \`node scripts/generate-evaluation-scenarios-report.mjs\` (desde \`Backend\`). Para comprobar que está al día sin escribirlo: \`node scripts/generate-evaluation-scenarios-report.mjs --check\`.
`;
}

/**
 * Ejecuta los escenarios, genera el informe y lo escribe o lo comprueba.
 *
 * @returns {void}
 */
function main() {
  const options = parseArguments(process.argv.slice(2));
  const results = CALIBRATION_SCENARIOS.map(runScenario);
  const calibrationDifferences = results.map((result, index) => ({ differences: compareWithCalibration(result, CALIBRATION_SCENARIOS[index]), id: result.id }));
  const ruleIssues = results.map((result) => ({ id: result.id, issues: checkRules(result) }));
  const report = buildReport(results, { calibrationDifferences, date: options.date, ruleIssues });

  const summary = {
    averageCompatibility: Number((results.reduce((total, { compatibility }) => total + compatibility.score, 0) / results.length).toFixed(1)),
    calibrationMatches: calibrationDifferences.filter(({ differences }) => !differences.length).length,
    executed: results.length,
    ruleIssues: ruleIssues.filter(({ issues }) => issues.length).length,
  };

  if (options.check) {
    const current = fs.existsSync(options.output) ? fs.readFileSync(options.output, "utf8") : "";
    const upToDate = current === report;
    console.log(JSON.stringify({ ...summary, upToDate }));
    process.exitCode = upToDate ? 0 : 1;
    return;
  }
  fs.writeFileSync(options.output, report);
  console.log(JSON.stringify({ ...summary, output: path.relative(path.resolve(BACKEND_DIR, ".."), options.output) }));
}

main();
