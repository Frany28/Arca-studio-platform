// Pasos del formulario «Nuevo Proyecto» (Figma 3727:618978), en el orden del diseño.
export const CONFIGURATION_STEPS = Object.freeze([
  { id: "general", label: "Información general" },
  { id: "tracking", label: "Seguimiento" },
  { id: "files", label: "Gestión de archivos" },
  { id: "warranties", label: "Garantías" },
]);

// Tipos que admite un proyecto nuevo (el histórico «stands_exhibitions» no se ofrece).
export const PROJECT_TYPE_ITEMS = Object.freeze([
  { id: "residential", label: "Residencial", type: "Text" },
  { id: "commercial", label: "Comercial", type: "Text" },
  { id: "corporate", label: "Corporativo", type: "Text" },
  { id: "advertising_stand", label: "Stand publicitario", type: "Text" },
]);

export const STAGE_STATUS_ITEMS = Object.freeze([
  { id: "pending", label: "Pendiente", type: "Text" },
  { id: "in_process", label: "En proceso", type: "Text" },
  { id: "finished", label: "Finalizado", type: "Text" },
]);

// Requisito pendiente devuelto por la API → paso que lo resuelve y mensaje visible.
const REQUIREMENT_STEPS = Object.freeze({
  assigneeIds: "general",
  clientId: "general",
  constructionArea: "general",
  generalArea: "general",
  location: "general",
  name: "general",
  projectType: "general",
  stages: "tracking",
  "stages.incomplete": "tracking",
  zoning: "general",
});

/**
 * Valores editables de «Información general» a partir de la configuración de la API. Los números
 * se muestran como texto para no inventar ceros en campos vacíos.
 *
 * @param {Object|null} configuration - Configuración de la API (null en modo creación).
 * @returns {Object} Estado del formulario.
 */
export function toGeneralForm(configuration) {
  const text = (value) => (value === null || value === undefined ? "" : String(value));
  return {
    assignees: configuration?.assignees || [],
    clientId: configuration?.clientId ?? null,
    clientName: configuration?.client?.name || "",
    conditions: text(configuration?.conditions),
    constructionArea: text(configuration?.constructionArea),
    equipment: text(configuration?.equipment),
    formattedAddress: configuration?.formattedAddress ?? null,
    generalArea: text(configuration?.generalArea),
    latitude: configuration?.latitude ?? null,
    location: text(configuration?.location),
    longitude: configuration?.longitude ?? null,
    name: text(configuration?.name),
    procedures: text(configuration?.procedures),
    projectType: configuration?.projectType || null,
    providerPlaceId: configuration?.providerPlaceId ?? null,
    zoning: text(configuration?.zoning),
  };
}

/**
 * Convierte un área escrita (admite coma decimal) en número positivo o null si está vacía.
 *
 * @param {string} value - Texto del campo.
 * @returns {number|null} Área o null.
 */
export function parseArea(value) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : Number.NaN;
}

/**
 * Cuerpo de `PUT …/configuration/general`. Los textos vacíos viajan como null para que un
 * borrador se guarde incompleto; la API exige los obligatorios solo al finalizar.
 *
 * @param {Object} form - Estado de «Información general».
 * @returns {Object} Payload de la API.
 */
export function toGeneralPayload(form) {
  const optional = (value) => (String(value ?? "").trim() ? String(value).trim() : null);
  return {
    assigneeIds: form.assignees.map((assignee) => Number(assignee.id)),
    conditions: optional(form.conditions),
    constructionArea: parseArea(form.constructionArea),
    equipment: optional(form.equipment),
    formattedAddress: form.formattedAddress ?? null,
    generalArea: parseArea(form.generalArea),
    latitude: form.latitude ?? null,
    location: optional(form.location),
    longitude: form.longitude ?? null,
    name: String(form.name ?? "").trim(),
    procedures: optional(form.procedures),
    projectType: form.projectType || null,
    providerPlaceId: form.providerPlaceId ?? null,
    zoning: optional(form.zoning),
  };
}

/**
 * Valores editables de «Seguimiento». Cada fila conserva una clave local estable para React.
 *
 * @param {Object|null} configuration - Configuración de la API.
 * @returns {{estimatedDeliveryDate: string|null, stages: Object[], milestones: Object[]}} Estado.
 */
export function toTrackingForm(configuration) {
  return {
    estimatedDeliveryDate: configuration?.estimatedDeliveryDate ?? null,
    milestones: (configuration?.milestones || []).map((milestone) => ({ dueDate: milestone.dueDate, key: `m-${milestone.id}`, title: milestone.title })),
    stages: (configuration?.stages || []).map((stage) => ({
      endDate: stage.endDate,
      key: `s-${stage.id}`,
      name: stage.name,
      startDate: stage.startDate,
      status: stage.status,
    })),
  };
}

/**
 * Cuerpo de `PUT …/configuration/tracking`. Omite las filas totalmente vacías (añadidas y sin
 * completar) para no enviar fases o hitos fantasma.
 *
 * @param {Object} form - Estado de «Seguimiento».
 * @returns {Object} Payload de la API.
 */
export function toTrackingPayload(form) {
  return {
    estimatedDeliveryDate: form.estimatedDeliveryDate || null,
    milestones: form.milestones
      .filter((milestone) => milestone.title.trim() || milestone.dueDate)
      .map((milestone) => ({ dueDate: milestone.dueDate, title: milestone.title.trim() })),
    stages: form.stages
      .filter((stage) => stage.name.trim() || stage.startDate || stage.endDate)
      .map((stage) => ({ endDate: stage.endDate || null, name: stage.name.trim(), startDate: stage.startDate || null, status: stage.status })),
  };
}

/**
 * Progreso que mostrará el campo calculado: porcentaje entero de fases finalizadas, la misma
 * regla del backend (`computeProgressFromStages`), solo para la vista previa antes de guardar.
 *
 * @param {Array<{status: string}>} stages - Fases del formulario.
 * @returns {number} Progreso 0–100.
 */
export function previewProgress(stages) {
  const list = (stages || []).filter((stage) => stage.name?.trim());
  if (!list.length) return 0;
  return Math.round((list.filter((stage) => stage.status === "finished").length / list.length) * 100);
}

/**
 * Valores editables de «Garantías».
 *
 * @param {Object|null} configuration - Configuración de la API.
 * @returns {Object[]} Garantías con clave local.
 */
export function toWarrantiesForm(configuration) {
  return (configuration?.warranties || []).map((warranty) => ({ ...warranty, key: `w-${warranty.id}` }));
}

/**
 * Cuerpo de `PUT …/configuration/warranties`. Cada garantía agregada se envía completa: la API
 * exige todos sus campos (son opcionales como conjunto, no por campo).
 *
 * @param {Object[]} warranties - Estado de «Garantías».
 * @returns {{warranties: Object[]}} Payload de la API.
 */
export function toWarrantiesPayload(warranties) {
  return {
    warranties: warranties.map((warranty) => ({
      code: String(warranty.code ?? "").trim(),
      endDate: warranty.endDate || null,
      model: String(warranty.model ?? "").trim(),
      product: String(warranty.product ?? "").trim(),
      serviceDate: warranty.serviceDate || null,
      startDate: warranty.startDate || null,
    })),
  };
}

/**
 * Agrupa los requisitos pendientes de la API por paso, con su mensaje, para llevar al
 * administrador a la primera sección incompleta al intentar finalizar.
 *
 * @param {Record<string, string>|null} fields - `fields` del 400 de la finalización.
 * @returns {{firstStep: string|null, messages: string[]}} Paso inicial y mensajes.
 */
export function describeMissingRequirements(fields) {
  const entries = Object.entries(fields || {});
  const order = CONFIGURATION_STEPS.map((step) => step.id);
  const steps = entries.map(([code]) => REQUIREMENT_STEPS[code] || "general");
  const firstStep = steps.sort((a, b) => order.indexOf(a) - order.indexOf(b))[0] || null;
  return { firstStep, messages: entries.map(([, message]) => message) };
}

/**
 * Convierte el mapa `fields` de un 400 de guardado en errores por campo del formulario
 * (`body.name` → `name`).
 *
 * @param {Record<string, string>|null} fields - Errores de la API.
 * @returns {Record<string, string>} Errores por campo.
 */
export function toFieldErrors(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([key, message]) => [key.replace(/^body\./, ""), message]));
}
