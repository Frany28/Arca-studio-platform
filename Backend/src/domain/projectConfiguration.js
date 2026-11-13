import { PROJECT_STATUS } from "./projectStatus.js";

// Estados de fase admitidos por el formulario (Figma «Seguimiento»). Comparten el enum
// project_status, pero una fase nunca es draft (chk_project_stages_status_not_draft).
export const PROJECT_STAGE_STATUSES = Object.freeze([
  PROJECT_STATUS.PENDING,
  PROJECT_STATUS.IN_PROCESS,
  PROJECT_STATUS.FINISHED,
]);

export const PROJECT_CONFIGURATION_LIMITS = Object.freeze({
  maxAssignees: 20,
  maxMilestones: 50,
  maxStages: 30,
  maxWarranties: 50,
  textMax: 4000,
});

/**
 * Mapeo explícito solicitud → proyecto que se aplica al aprobar. Solo copia datos equivalentes:
 * nombre, cliente, tipo, descripción, ubicación (texto, dirección formateada, coordenadas y lugar
 * del proveedor) y existencia de planos. No traslada como datos definitivos lo que no lo es:
 * rango de inversión (no es presupuesto), tamaño aproximado (no es un área exacta), plazo esperado
 * (no confirma la fecha de inicio) ni los arquitectos que revisaron la solicitud (no son
 * automáticamente responsables operativos). Esos valores se ofrecen como referencia en la
 * configuración (`buildRequestReference`) y el administrador decide.
 *
 * @param {object} request - Fila de public.project_requests.
 * @returns {object} Columnas del proyecto draft derivadas de la solicitud.
 */
export function mapRequestToDraftProject(request) {
  return {
    clientId: request.client_id,
    description: request.description ?? null,
    formattedAddress: request.formatted_address ?? null,
    hasPlans: request.has_plans ?? null,
    latitude: request.location_latitude ?? null,
    location: request.location ?? null,
    longitude: request.location_longitude ?? null,
    name: request.project_name,
    projectType: request.project_type ?? null,
    providerPlaceId: request.provider_place_id ?? null,
  };
}

/**
 * Datos de la solicitud de origen que la configuración muestra como referencia, sin copiarlos a
 * campos definitivos del proyecto. Los responsables de la revisión se sugieren para precargar el
 * campo «Responsables»; solo se guardan si el administrador guarda la sección.
 *
 * @param {object|null} request - Solicitud de origen con sus responsables.
 * @returns {object|null} Referencia de la solicitud o null si el borrador no proviene de una.
 */
export function buildRequestReference(request) {
  if (!request) return null;
  return {
    capitalAvailability: request.capital_availability ?? null,
    expectedStartTime: request.expected_start_time ?? null,
    firstContactAt: request.first_contact_at ?? null,
    id: Number(request.id),
    investmentRange: request.investment_range ?? null,
    projectSize: request.project_size ?? null,
    suggestedAssigneeIds: Array.isArray(request.assignee_ids) ? request.assignee_ids.map(Number) : [],
  };
}

/**
 * Progreso general calculado a partir de las fases reales: porcentaje entero de fases finalizadas.
 * Sin fases el progreso es 0 (no hay avance registrado), nunca un valor de ejemplo.
 *
 * @param {Array<{status: string}>} stages - Fases vigentes del proyecto.
 * @returns {number} Progreso 0–100.
 */
export function computeProgressFromStages(stages) {
  const list = Array.isArray(stages) ? stages : [];
  if (!list.length) return 0;
  const finished = list.filter((stage) => stage.status === PROJECT_STATUS.FINISHED).length;
  return Math.round((finished / list.length) * 100);
}

/**
 * Indica si un texto tiene contenido además de espacios. Un borrador guarda los textos vacíos como
 * null, pero la regla se aplica igual a valores recibidos del formulario.
 *
 * @param {unknown} value - Valor a comprobar.
 * @returns {boolean} true si es un texto no vacío.
 */
function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Indica si un área está informada y es mayor que cero; null o cero cuentan como pendientes.
 * Acepta números o textos numéricos de PostgreSQL.
 *
 * @param {unknown} value - Área a comprobar.
 * @returns {boolean} true si es positiva.
 */
function isPositive(value) {
  return value !== null && value !== undefined && Number(value) > 0;
}

/**
 * Requisitos para confirmar «Finalizar configuración» (draft → pending), los campos marcados como
 * obligatorios en Figma: nombre, cliente, al menos un responsable, tipo, área general, área de
 * construcción, ubicación, zonificación y al menos una fase con nombre, estado y fechas. Garantías,
 * hitos, coordenadas y los demás textos son opcionales. Guardar una sección no evalúa esto.
 *
 * @param {object} configuration - Configuración actual del borrador.
 * @returns {string[]} Códigos de los requisitos que faltan (vacío si está completo).
 */
export function findMissingConfigurationRequirements(configuration) {
  const missing = [];
  if (!hasText(configuration.name)) missing.push("name");
  if (!configuration.clientId) missing.push("clientId");
  if (!configuration.assigneeIds?.length) missing.push("assigneeIds");
  if (!configuration.projectType) missing.push("projectType");
  if (!isPositive(configuration.generalArea)) missing.push("generalArea");
  if (!isPositive(configuration.constructionArea)) missing.push("constructionArea");
  if (!hasText(configuration.location) || configuration.location.trim().length < 5) missing.push("location");
  if (!hasText(configuration.zoning)) missing.push("zoning");
  const stages = configuration.stages || [];
  if (!stages.length) missing.push("stages");
  else if (stages.some((stage) => !hasText(stage.name) || !stage.status || !stage.startDate || !stage.endDate)) {
    missing.push("stages.incomplete");
  }
  return missing;
}

/**
 * Fecha de inicio que adopta el proyecto al finalizar la configuración: el inicio más temprano de
 * sus fases. PostgreSQL exige start_date fuera de draft; no se inventa una fecha si no hay fases
 * (la finalización ya las exige).
 *
 * @param {Array<{startDate: string|null}>} stages - Fases del borrador.
 * @returns {string|null} Fecha ISO (YYYY-MM-DD) o null.
 */
export function earliestStageStartDate(stages) {
  const dates = (stages || []).map((stage) => stage.startDate).filter(Boolean).sort();
  return dates[0] || null;
}
