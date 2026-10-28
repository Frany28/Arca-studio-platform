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
 * Unidades con las que puede cotizarse un servicio del tabulador: posición, etiqueta, decimales y
 * tarifa de referencia (null = pendiente de validación comercial, no cotizable). Sin `unitOptions`
 * (contrato anterior) la unidad principal es la única, con la tarifa del servicio.
 *
 * @param {Object} service - Servicio de `GET /admin/services`.
 * @returns {Array<{position: number, label: string, allowsDecimals: boolean, referenceRate: string|null}>} Unidades.
 */
export function getServiceUnitChoices(service) {
  const options = Array.isArray(service?.unitOptions) && service.unitOptions.length ? service.unitOptions : null;
  if (!options) {
    return [{ allowsDecimals: service.measurementUnit?.allowsDecimals !== false, label: service.unitLabel, position: 1, referenceRate: service.referenceRate }];
  }
  return options.map((option) => ({
    allowsDecimals: option.measurementUnit?.allowsDecimals !== false,
    label: option.label,
    position: option.position,
    referenceRate: option.referenceRate ?? null,
  }));
}

/**
 * Indica si un servicio tiene al menos una unidad con tarifa confirmada (puede cotizarse).
 *
 * @param {Object} service - Servicio de `GET /admin/services`.
 * @returns {boolean} true si alguna unidad es cotizable.
 */
export function isServiceQuotable(service) {
  return getServiceUnitChoices(service).some((choice) => choice.referenceRate !== null);
}

/**
 * Aplica a un concepto la unidad elegida: su etiqueta, sus decimales y su tarifa de referencia,
 * que también pasa a ser la tarifa aplicada propuesta (editable).
 *
 * @param {Object} line - Concepto.
 * @param {{position: number, label: string, allowsDecimals: boolean, referenceRate: string}} choice - Unidad cotizable.
 * @returns {Object} Concepto con la unidad aplicada.
 */
function withUnitChoice(line, choice) {
  return {
    ...line,
    referenceRate: choice.referenceRate,
    unitAllowsDecimals: choice.allowsDecimals,
    unitLabel: choice.label,
    unitOptionPosition: choice.position,
    unitRate: toEditableDecimal(choice.referenceRate),
  };
}

/**
 * Crea un concepto a partir de un servicio activo del tabulador. La cantidad empieza vacía para
 * que el administrador la escriba. Con una sola unidad cotizable se elige sola y su tarifa es la
 * aplicada propuesta; con varias, el concepto queda sin unidad hasta que se elija una. Las
 * unidades pendientes de validación comercial nunca se eligen ni aportan tarifa.
 *
 * @param {Object} service - Servicio de `GET /admin/services`.
 * @returns {Object} Concepto del borrador.
 */
export function createLineFromService(service) {
  const unitChoices = getServiceUnitChoices(service);
  const quotable = unitChoices.filter((choice) => choice.referenceRate !== null);
  const line = {
    key: `service-${service.id}`,
    quantity: "",
    referenceRate: null,
    serviceCode: service.code,
    serviceDescription: service.description ?? null,
    serviceId: service.id,
    serviceName: service.name,
    unitAllowsDecimals: true,
    unitChoices,
    unitLabel: "",
    unitOptionPosition: null,
    unitRate: "",
  };
  return quotable.length === 1 ? withUnitChoice(line, quotable[0]) : line;
}

/**
 * Cambia la unidad de un concepto por otra cotizable del mismo servicio; una pendiente no se aplica.
 *
 * @param {Array<Object>} lines - Conceptos actuales.
 * @param {string} key - Concepto que cambia.
 * @param {number} position - Posición de la unidad elegida.
 * @returns {Array<Object>} Conceptos resultantes (los mismos si la unidad no es cotizable).
 */
export function selectLineUnit(lines, key, position) {
  return lines.map((line) => {
    if (line.key !== key) return line;
    const choice = (line.unitChoices ?? []).find((candidate) => candidate.position === position);
    return choice && choice.referenceRate !== null ? withUnitChoice(line, choice) : line;
  });
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
    // La unidad cotizada pertenece a la versión guardada: es la única opción de la fila.
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
      unitChoices: [{ allowsDecimals: item.unit.allowsDecimals, label: item.unit.label, position: item.unit.position ?? 1, referenceRate: item.referenceRate }],
      unitLabel: item.unit.label,
      unitOptionPosition: item.unit.position ?? null,
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
 * observaciones (vacías → null) y conceptos con cantidad y tarifa como texto decimal y, si se
 * conoce, la posición de la unidad elegida (`unitOptionPosition`).
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
      ...(line.unitOptionPosition ? { unitOptionPosition: line.unitOptionPosition } : {}),
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
  // Un servicio con varias unidades cotizables necesita una elegida (mismo mensaje que el backend).
  draft.lines.forEach((line, index) => {
    if (!line.unitOptionPosition && (line.unitChoices ?? []).length > 1) {
      fields[`items.${index}.unitOptionPosition`] = "Elige la unidad de medida con la que se cotiza este servicio.";
    }
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
