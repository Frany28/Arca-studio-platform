import { describeProjectNameError, normalizeProjectName, projectNameKey } from "../../../../../../Backend/src/domain/projectName.js";
import { QUOTE_INPUT_FORMATS, parseDecimalInput } from "./quoteAmounts.js";

// Borrador del formulario de cotización (Figma 5771:452483) y su traducción al contrato de la
// API. Funciones puras: no conocen React, HTTP ni el DOM.

export const QUOTE_NOTES_MAX_LENGTH = 2000;
export const EMPTY_QUOTE_DRAFT = Object.freeze({ client: null, lines: [], notes: "", project: null });

// Proyecto del borrador: uno existente elegido en las sugerencias o, solo en el alta, el nombre de
// uno nuevo que el backend crea como Draft al guardar la cotización.
export const PROJECT_KIND = Object.freeze({ EXISTING: "existing", NEW: "new" });

/**
 * Busca entre las sugerencias del cliente un proyecto con exactamente el nombre escrito, con la
 * misma clave que la unicidad de PostgreSQL (sin distinguir mayúsculas, con tildes y espacios
 * normalizados). Una coincidencia se pide seleccionar: nunca se crea otro ni se vincula en silencio.
 *
 * @param {Array<{id: number, name: string}>} options - Proyectos sugeridos del cliente.
 * @param {string} name - Nombre escrito.
 * @returns {{id: number, name: string}|null} Proyecto coincidente o null.
 */
export function findExactProjectMatch(options, name) {
  const key = projectNameKey(name);
  return key ? options.find((option) => projectNameKey(option.name) === key) ?? null : null;
}

/**
 * Explica que el nombre escrito ya pertenece a un proyecto del cliente y debe seleccionarse.
 *
 * @param {{name: string}} project - Proyecto existente coincidente.
 * @returns {string} Mensaje para el campo.
 */
export function describeExistingProjectMatch(project) {
  return `Ya existe el proyecto «${project.name}» para este cliente. Selecciónalo en las sugerencias.`;
}

/**
 * Quita los ceros decimales sobrantes de un decimal de la API para editarlo (`200.000` → `200`,
 * `12.50` → `12.5`). Un valor no decimal se devuelve tal cual.
 *
 * @param {string|null|undefined} value - Decimal como texto.
 * @returns {string} Valor editable.
 */
export function toEditableDecimal(value) {
  const text = String(value ?? "");
  if (!/^\d+(\.\d+)?$/.test(text)) return text;
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

/**
 * Crea un concepto a partir de un servicio activo del tabulador. La cantidad empieza en 1 y el
 * administrador la ajusta; la tarifa aplicada empieza en la tarifa de referencia.
 *
 * @param {Object} service - Servicio de `GET /admin/services`.
 * @returns {Object} Concepto del borrador.
 */
export function createLineFromService(service) {
  return {
    key: `service-${service.id}`,
    quantity: "1",
    referenceRate: service.referenceRate,
    serviceCode: service.code,
    serviceDescription: service.description ?? null,
    serviceId: service.id,
    serviceName: service.name,
    unitAllowsDecimals: service.measurementUnit?.allowsDecimals !== false,
    unitLabel: service.unitLabel,
    unitRate: toEditableDecimal(service.referenceRate),
  };
}

/**
 * Añade al final los servicios elegidos que todavía no están incluidos: cada servicio aparece
 * una sola vez por cotización, igual que exige el backend.
 *
 * @param {Array<Object>} lines - Conceptos actuales.
 * @param {Array<Object>} services - Servicios elegidos en el selector.
 * @returns {Array<Object>} Conceptos resultantes.
 */
export function addServicesToLines(lines, services) {
  const included = new Set(lines.map((line) => line.serviceId));
  return [...lines, ...services.filter((service) => !included.has(service.id)).map(createLineFromService)];
}

/**
 * Cambia el servicio de un concepto desde el desplegable de su fila (Figma 5771:367425): toma
 * la unidad, el nombre y la tarifa de referencia del servicio nuevo, conserva la posición y la
 * cantidad escrita, y no admite un servicio que ya está en otra fila (uno por cotización).
 *
 * @param {Array<Object>} lines - Conceptos actuales.
 * @param {string} key - Concepto que cambia.
 * @param {Object} service - Servicio activo elegido.
 * @returns {Array<Object>} Conceptos resultantes (los mismos si el cambio no procede).
 */
export function replaceLineService(lines, key, service) {
  if (lines.some((line) => line.serviceId === service.id)) return lines;
  return lines.map((line) => (line.key === key ? { ...createLineFromService(service), quantity: line.quantity } : line));
}

/**
 * Construye el borrador de edición a partir de una cotización guardada, con los nombres y
 * unidades de la versión de servicio cotizada (lo que muestra el documento).
 *
 * @param {Object} quote - Cotización de `GET /admin/quotes/:id`.
 * @returns {Object} Borrador.
 */
export function draftFromQuote(quote) {
  return {
    client: { id: quote.client.id, name: quote.client.name, profilePhotoUrl: "" },
    lines: quote.items.map((item) => ({
      key: `service-${item.service.id}`,
      quantity: toEditableDecimal(item.quantity),
      referenceRate: item.referenceRate,
      serviceCode: item.service.code,
      serviceDescription: item.service.description ?? null,
      serviceId: item.service.id,
      serviceIsActive: item.service.isActive,
      serviceName: item.service.name,
      unitAllowsDecimals: item.unit.allowsDecimals,
      unitLabel: item.unit.label,
      unitRate: toEditableDecimal(item.unitRate),
    })),
    notes: quote.notes ?? "",
    project: { id: quote.project.id, kind: PROJECT_KIND.EXISTING, name: quote.project.name },
  };
}

/**
 * Borrador de una cotización nueva para un proyecto existente: su cliente y el propio proyecto,
 * sin conceptos ni observaciones. Usa solo los datos que devuelve `GET /projects/:id`; el
 * backend vuelve a validar cliente y proyecto al guardar.
 *
 * @param {{id: number, name: string, client?: {id: number, name: string}}} project - Proyecto leído.
 * @returns {Object|null} Borrador, o null si el proyecto no identifica a su cliente.
 */
export function draftFromProject(project) {
  if (project?.id == null || project.client?.id == null) return null;
  return {
    ...EMPTY_QUOTE_DRAFT,
    client: { id: project.client.id, name: project.client.name || "", profilePhotoUrl: "" },
    lines: [],
    project: { id: project.id, kind: PROJECT_KIND.EXISTING, name: project.name },
  };
}

/**
 * Normaliza un decimal escrito para enviarlo a la API (coma decimal a punto, sin espacios). Un
 * valor inválido se envía tal cual: el servidor responde con el error en su campo.
 *
 * @param {string} value - Valor escrito.
 * @param {{scale: number, maxIntegerDigits: number}} format - Precisión.
 * @returns {string} Texto decimal.
 */
function toPayloadDecimal(value, format) {
  const parsed = parseDecimalInput(value, format);
  return parsed.error ? String(value ?? "").trim() : parsed.normalized;
}

/**
 * Traduce el borrador al cuerpo de `POST/PATCH /admin/quotes`: id del cliente, id del proyecto
 * existente o nombre normalizado del proyecto nuevo (`newProjectName`, solo en el alta),
 * observaciones (vacías → null) y conceptos con cantidad y tarifa como texto decimal.
 *
 * @param {Object} draft - Borrador.
 * @returns {{clientId: number|null, projectId?: number|null, newProjectName?: string, notes: string|null,
 *   items: Array<Object>}} Cuerpo.
 */
export function toQuotePayload(draft) {
  const project = draft.project?.kind === PROJECT_KIND.NEW
    ? { newProjectName: normalizeProjectName(draft.project.name) }
    : { projectId: draft.project?.id ?? null };
  return {
    clientId: draft.client?.id ?? null,
    items: draft.lines.map((line) => ({
      quantity: toPayloadDecimal(line.quantity, QUOTE_INPUT_FORMATS.quantity),
      serviceId: line.serviceId,
      unitRate: toPayloadDecimal(line.unitRate, QUOTE_INPUT_FORMATS.unitRate),
    })),
    notes: draft.notes.trim() || null,
    ...project,
  };
}

/**
 * Valida el borrador antes de enviarlo con las mismas reglas que el backend, para señalar los
 * campos sin una petición. Devuelve los errores por ruta (`clientId`, `newProjectName`,
 * `items.0.quantity`...). Un proyecto nuevo con el nombre exacto de uno existente se rechaza para
 * que se seleccione el existente.
 *
 * @param {Object} draft - Borrador.
 * @param {{lines: Array<{errors: Object}>}} preview - Resultado de calculateQuotePreview.
 * @param {{existingProjectMatch?: {name: string}|null}} [context] - Coincidencia exacta del nombre nuevo.
 * @returns {Record<string, string>} Errores; vacío si es válido.
 */
export function validateQuoteDraft(draft, preview, { existingProjectMatch = null } = {}) {
  const fields = {};
  if (!draft.client) fields.clientId = "Selecciona el cliente de la cotización.";
  if (!draft.project) {
    fields.projectId = draft.client ? "Selecciona o escribe el proyecto del cliente." : "Selecciona primero el cliente.";
  } else if (draft.project.kind === PROJECT_KIND.NEW) {
    const nameError = describeProjectNameError(draft.project.name)
      || (existingProjectMatch ? describeExistingProjectMatch(existingProjectMatch) : null);
    if (nameError) fields.newProjectName = nameError;
  }
  if (draft.lines.length === 0) fields.items = "Añade al menos un servicio a la cotización.";
  if (draft.notes.trim().length > QUOTE_NOTES_MAX_LENGTH) fields.notes = `Admite como máximo ${QUOTE_NOTES_MAX_LENGTH} caracteres.`;
  preview.lines.forEach((line, index) => {
    for (const [field, message] of Object.entries(line.errors)) fields[`items.${index}.${field === "subtotal" ? "quantity" : field}`] = message;
  });
  return fields;
}

/**
 * Lleva los errores de la API a las rutas del formulario: Zod los envía con prefijo (`body.notes`)
 * y el servicio sin él (`clientId`, `items.0.serviceId`).
 *
 * @param {Record<string, string>|null|undefined} fields - `fields` de la respuesta 400.
 * @returns {Record<string, string>} Errores por ruta del formulario.
 */
export function normalizeServerFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).map(([path, message]) => [path.replace(/^body\./, ""), message]));
}

/**
 * Indica si el borrador cambió respecto al contenido inicial, para pedir confirmación antes de
 * descartarlo. Compara el cuerpo que se enviaría, no la presentación.
 *
 * @param {Object} initial - Borrador inicial.
 * @param {Object} draft - Borrador actual.
 * @returns {boolean} true si hay cambios sin guardar.
 */
export function isQuoteDraftDirty(initial, draft) {
  return JSON.stringify(toQuotePayload(initial)) !== JSON.stringify(toQuotePayload(draft));
}
