import { QUOTE_INPUT_FORMATS, parseDecimalInput } from "./quoteAmounts.js";

// Borrador del formulario de cotización (Figma 5771:452483) y su traducción al contrato de la
// API. Funciones puras: no conocen React, HTTP ni el DOM.

export const QUOTE_NOTES_MAX_LENGTH = 2000;
export const EMPTY_QUOTE_DRAFT = Object.freeze({ client: null, lines: [], notes: "", project: null });

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
 * Crea un concepto a partir de un servicio activo del tabulador. La cantidad empieza vacía para
 * que el administrador la escriba; la tarifa aplicada empieza en la tarifa de referencia.
 *
 * @param {Object} service - Servicio de `GET /admin/services`.
 * @returns {Object} Concepto del borrador.
 */
export function createLineFromService(service) {
  return {
    key: `service-${service.id}`,
    quantity: "",
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
    project: { id: quote.project.id, name: quote.project.name },
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
 * Traduce el borrador al cuerpo de `POST/PATCH /admin/quotes`: ids del cliente y del proyecto,
 * observaciones (vacías → null) y conceptos con cantidad y tarifa como texto decimal.
 *
 * @param {Object} draft - Borrador.
 * @returns {{clientId: number|null, projectId: number|null, notes: string|null, items: Array<Object>}} Cuerpo.
 */
export function toQuotePayload(draft) {
  return {
    clientId: draft.client?.id ?? null,
    items: draft.lines.map((line) => ({
      quantity: toPayloadDecimal(line.quantity, QUOTE_INPUT_FORMATS.quantity),
      serviceId: line.serviceId,
      unitRate: toPayloadDecimal(line.unitRate, QUOTE_INPUT_FORMATS.unitRate),
    })),
    notes: draft.notes.trim() || null,
    projectId: draft.project?.id ?? null,
  };
}

/**
 * Valida el borrador antes de enviarlo con las mismas reglas que el backend, para señalar los
 * campos sin una petición. Devuelve los errores por ruta (`clientId`, `items.0.quantity`...).
 *
 * @param {Object} draft - Borrador.
 * @param {{lines: Array<{errors: Object}>}} preview - Resultado de calculateQuotePreview.
 * @returns {Record<string, string>} Errores; vacío si es válido.
 */
export function validateQuoteDraft(draft, preview) {
  const fields = {};
  if (!draft.client) fields.clientId = "Selecciona el cliente de la cotización.";
  if (!draft.project) fields.projectId = draft.client ? "Selecciona el proyecto del cliente." : "Selecciona primero el cliente.";
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
