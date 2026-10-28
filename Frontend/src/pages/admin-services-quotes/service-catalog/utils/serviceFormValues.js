// Valores del formulario de servicios (Figma 5764:226084): las reglas reproducen el esquema del
// backend (serviceCreateSchema / serviceUpdateSchema) para avisar antes de enviar; el backend
// sigue siendo la autoridad. El código no se edita: lo genera el sistema.

export const SERVICE_NAME_MAX_LENGTH = 150;
// Modalidades del contrato (`kind`). Ninguna restringe la unidad: ambas admiten cualquier unidad
// registrada y activa.
export const SERVICE_KINDS = Object.freeze({ INDIVIDUAL: "individual", TURNKEY: "turnkey" });
const SERVICE_KIND_VALUES = Object.freeze(Object.values(SERVICE_KINDS));
export const SERVICE_DESCRIPTION_MAX_LENGTH = 2000;
// Unidades por servicio y longitud del texto comercial (mismos límites que el backend).
export const SERVICE_UNIT_OPTIONS_MAX = 10;
export const PRESENTATION_LABEL_MAX_LENGTH = 80;
// NUMERIC(14,2): hasta 12 enteros y 2 decimales, sin signo.
const REFERENCE_RATE_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;
const RATE_FORMAT_MESSAGE = "Usa hasta 12 enteros y 2 decimales, sin signo (por ejemplo, 12.50).";

let alternativeKeySequence = 0;

/**
 * Copia de una denominación para el borrador (solo id y texto).
 *
 * @param {{id: number, denomination: string}|null|undefined} denomination - Denominación de la API.
 * @returns {{id: number, denomination: string}|null} Denominación del borrador.
 */
function toDraftDenomination(denomination) {
  return denomination ? { id: denomination.id, denomination: denomination.denomination } : null;
}

/**
 * Fila nueva o leída de «Unidades alternativas». La tarifa vacía significa «pendiente de
 * validación comercial»: nunca se rellena con otra tarifa. `key` identifica la fila en React.
 *
 * @param {Object} [option] - Unidad de la API (edición) o nada (fila nueva vacía).
 * @returns {{key: string, measurementUnitId: number|null, unitDenomination: Object|null, referenceRate: string,
 * presentationLabel: string}} Fila del borrador.
 */
export function createAlternativeUnit(option) {
  alternativeKeySequence += 1;
  return {
    key: `alternative-${alternativeKeySequence}`,
    measurementUnitId: option?.measurementUnit?.id ?? null,
    unitDenomination: toDraftDenomination(option?.unitDenomination),
    referenceRate: option?.referenceRate ?? "",
    presentationLabel: option?.presentationLabel ?? "",
  };
}

/**
 * Unidades de un servicio leído de la API, con la principal como única si no trae `unitOptions`.
 *
 * @param {Object|null} service - Servicio de la API.
 * @returns {Array<Object>} Unidades en su orden (vacío en el alta).
 */
export function getServiceUnitOptions(service) {
  if (!service) return [];
  if (Array.isArray(service.unitOptions) && service.unitOptions.length) return service.unitOptions;
  return [{
    measurementUnit: service.measurementUnit,
    presentationLabel: null,
    referenceRate: service.referenceRate,
    unitDenomination: service.unitDenomination ?? null,
  }];
}

/**
 * Borrador inicial: vacío en el alta y con los datos reales del servicio en la edición. La
 * descripción y las tarifas se conservan tal como las guardó el backend (texto, sin conversión).
 *
 * La modalidad empieza sin elegir en el alta (se exige una selección) y en la edición es la
 * guardada, sin conversiones. La unidad principal vive en `measurementUnitId` y
 * `unitDenomination`; las demás, en `alternativeUnits`. Con alternativas, la principal tiene su
 * propia tarifa (`primaryUnitRate`, vacía = pendiente) y `referenceRate` es la del tabulador.
 *
 * @param {Object|null} service - Servicio leído de la API (edición) o null (alta).
 * @returns {{name: string, kind: string, description: string, measurementUnitId: number|null,
 * unitDenomination: {id: number, denomination: string}|null, presentationLabel: string, referenceRate: string,
 * primaryUnitRate: string, alternativeUnits: Array<Object>}} Borrador.
 */
export function createServiceDraft(service) {
  const [primary, ...alternatives] = getServiceUnitOptions(service);
  return {
    name: service?.name ?? "",
    kind: service?.kind ?? "",
    description: service?.description ?? "",
    measurementUnitId: service?.measurementUnit?.id ?? null,
    unitDenomination: toDraftDenomination(service?.unitDenomination),
    presentationLabel: primary?.presentationLabel ?? "",
    referenceRate: service?.referenceRate ?? "",
    primaryUnitRate: alternatives.length ? primary?.referenceRate ?? "" : "",
    alternativeUnits: alternatives.map(createAlternativeUnit),
  };
}

/**
 * Clave de una combinación de unidad base y denominación, para detectar repeticiones.
 *
 * @param {number|null} measurementUnitId - Unidad base.
 * @param {{id: number}|null} unitDenomination - Denominación.
 * @returns {string} Clave.
 */
function unitKey(measurementUnitId, unitDenomination) {
  return `${measurementUnitId}:${unitDenomination?.id ?? ""}`;
}

/**
 * Indica si una unidad elegida está disponible para una asignación nueva: una base activa del
 * catálogo y, si tiene denominación, una denominación activa de esa base.
 *
 * @param {{measurementUnitId: number, unitDenomination: {id: number}|null}} unit - Unidad elegida.
 * @param {Object} catalog - Catálogo de nuevas asignaciones.
 * @param {Array<Object>} [catalog.availableDenominations] - Denominaciones activas.
 * @param {Array<{id: number}>} [catalog.availableBases] - Bases activas.
 * @returns {string} Mensaje de error, o cadena vacía si está disponible.
 */
function unitAvailabilityError({ measurementUnitId, unitDenomination }, { availableBases, availableDenominations }) {
  if (unitDenomination && Array.isArray(availableDenominations)
    && !filterDenominationsForBase(availableDenominations, measurementUnitId).some((item) => item.id === unitDenomination.id)) {
    return "Elige una unidad activa registrada para este símbolo.";
  }
  if (!unitDenomination && Array.isArray(availableBases) && !availableBases.some((base) => base.id === measurementUnitId)) {
    return "Elige una unidad base activa.";
  }
  return "";
}

/**
 * Valida una tarifa opcional de unidad: vacía es «pendiente»; si se escribe, con el formato del contrato.
 *
 * @param {string} rate - Tarifa escrita.
 * @returns {string} Mensaje de error, o cadena vacía.
 */
function optionalRateError(rate) {
  const value = String(rate ?? "").trim();
  return value && !REFERENCE_RATE_PATTERN.test(value) ? RATE_FORMAT_MESSAGE : "";
}

/**
 * Valida la unidad principal, su texto comercial y las unidades alternativas: unidad elegida,
 * disponible (salvo la combinación ya guardada, aunque sea histórica), sin repeticiones, dentro
 * del máximo y con tarifas válidas o vacías (pendientes).
 *
 * @param {Object} draft - Borrador del formulario.
 * @param {Object} context - Catálogo y combinaciones guardadas (ver validateServiceDraft).
 * @param {Record<string, string>} errors - Errores acumulados; se modifica.
 * @returns {void}
 */
function collectUnitErrors(draft, { availableBases, availableDenominations, preserveStoredUnit, storedUnitKeys }, errors) {
  const catalog = { availableBases, availableDenominations };
  if (!draft.measurementUnitId) errors.unit = "Elige la unidad de medida.";
  else if (!preserveStoredUnit) {
    const message = unitAvailabilityError(draft, catalog);
    if (message) errors.unit = message;
  }
  if ((draft.presentationLabel ?? "").trim().length > PRESENTATION_LABEL_MAX_LENGTH) {
    errors.presentationLabel = `Usa como máximo ${PRESENTATION_LABEL_MAX_LENGTH} caracteres.`;
  }
  const alternatives = draft.alternativeUnits ?? [];
  if (!alternatives.length) return;
  if (alternatives.length + 1 > SERVICE_UNIT_OPTIONS_MAX) errors.alternatives = `Un servicio admite como máximo ${SERVICE_UNIT_OPTIONS_MAX} unidades de medida.`;
  const primaryRateError = optionalRateError(draft.primaryUnitRate);
  if (primaryRateError) errors.primaryUnitRate = primaryRateError;
  const seen = new Set([unitKey(draft.measurementUnitId, draft.unitDenomination)]);
  alternatives.forEach((alternative, index) => {
    const key = unitKey(alternative.measurementUnitId, alternative.unitDenomination);
    if (!alternative.measurementUnitId) errors[`alternative.${index}`] = "Elige la unidad alternativa.";
    else if (seen.has(key)) errors[`alternative.${index}`] = "Esta unidad ya está incluida en el servicio.";
    else if (!storedUnitKeys?.has(key)) {
      const message = unitAvailabilityError(alternative, catalog);
      if (message) errors[`alternative.${index}`] = message;
    }
    seen.add(key);
    const rateError = optionalRateError(alternative.referenceRate);
    if (rateError) errors[`alternativeRate.${index}`] = rateError;
  });
}

/**
 * Valida el borrador con las reglas del contrato. Devuelve un mensaje por campo inválido.
 *
 * La unidad principal es una base activa (sola o con una denominación activa), con cualquier
 * modalidad; la edición puede conservar la combinación histórica guardada (`preserveStoredUnit`)
 * sin sustituirla, también al cambiar solo la modalidad. Las alternativas siguen el mismo criterio.
 *
 * @param {Object} draft - Borrador del formulario.
 * @param {Object} [context] - Datos que dependen del catálogo.
 * @param {boolean} [context.preserveStoredUnit] - No cambió la base ni denominación principal guardada.
 * @param {Array<Object>} [context.availableDenominations] - Denominaciones activas para nuevas asignaciones.
 * @param {Array<{id: number}>} [context.availableBases] - Bases activas para nuevas asignaciones.
 * @param {Set<string>} [context.storedUnitKeys] - Combinaciones ya guardadas en el servicio (se conservan aunque sean históricas).
 * @returns {Record<string, string>} Errores por campo (name, kind, description, unit, presentationLabel,
 * referenceRate, primaryUnitRate, alternatives, `alternative.N`, `alternativeRate.N`).
 */
export function validateServiceDraft(draft, { availableBases, availableDenominations, preserveStoredUnit = false, storedUnitKeys } = {}) {
  const errors = {};
  const name = draft.name.trim();
  if (!name) errors.name = "Escribe el nombre del servicio.";
  else if (name.length > SERVICE_NAME_MAX_LENGTH) errors.name = `Usa como máximo ${SERVICE_NAME_MAX_LENGTH} caracteres.`;
  if (!SERVICE_KIND_VALUES.includes(draft.kind)) errors.kind = "Elige la modalidad de contratación.";
  if (draft.description.trim().length > SERVICE_DESCRIPTION_MAX_LENGTH) {
    errors.description = `Usa como máximo ${SERVICE_DESCRIPTION_MAX_LENGTH} caracteres.`;
  }
  collectUnitErrors(draft, { availableBases, availableDenominations, preserveStoredUnit, storedUnitKeys }, errors);
  const rate = draft.referenceRate.trim();
  if (!rate) errors.referenceRate = "Indica la tarifa.";
  else if (!REFERENCE_RATE_PATTERN.test(rate)) errors.referenceRate = RATE_FORMAT_MESSAGE;
  return errors;
}

/**
 * Combinaciones de unidad y denominación guardadas en un servicio, para conservar las históricas.
 *
 * @param {Object|null} service - Servicio leído de la API.
 * @returns {Set<string>} Claves de las combinaciones.
 */
export function getStoredUnitKeys(service) {
  return new Set(getServiceUnitOptions(service).map((option) => unitKey(option.measurementUnit?.id, option.unitDenomination)));
}

/**
 * Indica si el borrador necesita la lista completa `unitOptions` (alternativas o texto comercial)
 * o le basta el atajo `measurementUnitId` / `unitDenominationId`.
 *
 * @param {Object} draft - Borrador.
 * @returns {boolean} true si hay alternativas o texto comercial.
 */
function needsUnitOptions(draft) {
  return (draft.alternativeUnits ?? []).length > 0 || Boolean((draft.presentationLabel ?? "").trim());
}

/**
 * Lista `unitOptions` del contrato a partir del borrador. Con una sola unidad no envía tarifa (la
 * del servicio); con varias, cada tarifa vacía viaja como null (pendiente de validación comercial).
 *
 * @param {Object} draft - Borrador válido.
 * @returns {Array<Object>} Unidades en su orden (la primera es la principal).
 */
export function toDraftUnitOptions(draft) {
  const alternatives = draft.alternativeUnits ?? [];
  const rateOf = (rate) => String(rate ?? "").trim() || null;
  const toOption = (unit, rate) => ({
    measurementUnitId: unit.measurementUnitId,
    unitDenominationId: unit.unitDenomination?.id ?? null,
    presentationLabel: (unit.presentationLabel ?? "").trim() || null,
    ...(alternatives.length ? { referenceRate: rateOf(rate) } : {}),
  });
  return [toOption(draft, draft.primaryUnitRate), ...alternatives.map((alternative) => toOption(alternative, alternative.referenceRate))];
}

/**
 * Forma comparable de las unidades: unidad, denominación, texto comercial y, con varias unidades,
 * su tarifa canónica (con una sola, la tarifa es la del servicio y se compara aparte).
 *
 * @param {Array<{measurementUnitId: number, unitDenominationId: number|null, presentationLabel: string|null,
 * referenceRate?: string|null}>} options - Unidades.
 * @returns {string} Huella comparable.
 */
function unitOptionsFingerprint(options) {
  return JSON.stringify(options.map((option) => [
    option.measurementUnitId, option.unitDenominationId ?? null, option.presentationLabel ?? null,
    options.length > 1 && option.referenceRate ? canonicalRate(option.referenceRate) : null,
  ]));
}

/**
 * Unidades guardadas de un servicio con la forma de toDraftUnitOptions.
 *
 * @param {Object} service - Servicio de la API.
 * @returns {Array<Object>} Unidades comparables.
 */
function storedUnitOptions(service) {
  return getServiceUnitOptions(service).map((option) => ({
    measurementUnitId: option.measurementUnit.id,
    unitDenominationId: option.unitDenomination?.id ?? null,
    presentationLabel: option.presentationLabel ?? null,
    referenceRate: option.referenceRate ?? null,
  }));
}

/**
 * Forma canónica de una tarifa decimal para compararla sin convertirla a Number: sin ceros a la
 * izquierda en la parte entera ni a la derecha en la decimal ("012.50" → "12.5", "12.00" → "12").
 *
 * @param {string} rate - Tarifa como texto decimal válido.
 * @returns {string} Forma canónica.
 */
export function canonicalRate(rate) {
  const [integerPart, fractionPart = ""] = String(rate).trim().split(".");
  const integer = integerPart.replace(/^0+(?=\d)/, "");
  const fraction = fractionPart.replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : integer;
}

// Dígitos máximos de una tarifa: 12 enteros y 2 céntimos (NUMERIC(14,2)).
const RATE_MAX_DIGITS = 14;

/**
 * Compone la tarifa a partir de dígitos como una caja registradora: los dígitos entran por la
 * derecha y los dos últimos son los céntimos ("1" → "0.01", "100" → "1.00"). Trabaja con texto
 * (sin Number) para no perder precisión. Sin dígitos significativos devuelve "": así borrar hasta
 * el final vacía el campo (que muestra "0.00" como ejemplo) en vez de quedarse en "0.00".
 *
 * @param {string} digits - Solo dígitos, sin ceros a la izquierda y limitados a RATE_MAX_DIGITS.
 * @returns {string} Tarifa con dos decimales o cadena vacía.
 */
function composeRateFromDigits(digits) {
  if (!digits) return "";
  const padded = digits.padStart(3, "0");
  return `${padded.slice(0, -2)}.${padded.slice(-2)}`;
}

/**
 * Tarifa resultante de lo que el usuario teclea o borra en el campo: se descartan los caracteres
 * que no son dígitos y los dígitos se desplazan de derecha a izquierda con dos céntimos fijos.
 * Si se supera el máximo del contrato, se conserva la tarifa anterior.
 *
 * @param {string} inputValue - Valor nuevo del campo nativo (con el último cambio aplicado).
 * @param {string} previousRate - Tarifa vigente del borrador.
 * @returns {string} Tarifa formateada ("12.50") o cadena vacía.
 */
export function rateFromTypedValue(inputValue, previousRate) {
  const digits = String(inputValue).replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length > RATE_MAX_DIGITS) return previousRate;
  return composeRateFromDigits(digits);
}

/**
 * Tarifa a partir de un texto pegado, que sustituye a la actual: un importe válido ("12.5",
 * "1250") se respeta como importe y se completa a dos decimales; cualquier otro texto
 * ("$1,250.50") se interpreta por sus dígitos, como si se tecleara.
 *
 * @param {string} pastedText - Texto pegado.
 * @param {string} previousRate - Tarifa vigente del borrador (se conserva si se excede el máximo).
 * @returns {string} Tarifa formateada, cadena vacía o la anterior.
 */
export function rateFromPastedText(pastedText, previousRate) {
  const text = String(pastedText).trim();
  if (REFERENCE_RATE_PATTERN.test(text)) {
    const [integerPart, fractionPart = ""] = text.split(".");
    return `${integerPart.replace(/^0+(?=\d)/, "")}.${fractionPart.padEnd(2, "0")}`;
  }
  return rateFromTypedValue(text, previousRate);
}

/**
 * Cuerpo del alta: con la modalidad elegida, sin código (lo genera el sistema) y sin descripción
 * si está vacía. La tarifa viaja como texto para conservar su precisión. Una sola unidad sin texto
 * comercial usa el atajo `measurementUnitId` / `unitDenominationId`; si no, la lista `unitOptions`.
 *
 * @param {Object} draft - Borrador válido.
 * @returns {Object} Cuerpo de POST /admin/services.
 */
export function toCreateServicePayload(draft) {
  const description = draft.description.trim();
  const units = needsUnitOptions(draft)
    ? { unitOptions: toDraftUnitOptions(draft) }
    : {
      measurementUnitId: draft.measurementUnitId,
      ...(draft.unitDenomination ? { unitDenominationId: draft.unitDenomination.id } : {}),
    };
  return {
    name: draft.name.trim(),
    kind: draft.kind,
    ...(description ? { description } : {}),
    ...units,
    referenceRate: draft.referenceRate.trim(),
  };
}

/**
 * Cambios de unidades de una edición. Si el servicio tenía una sola unidad sin texto comercial y
 * el borrador también, usa el atajo (cambiar la base envía también la denominación, de la nueva
 * base o null, como exige el contrato); en otro caso envía la lista `unitOptions` completa.
 *
 * @param {Object} draft - Borrador válido.
 * @param {Object} service - Servicio original leído de la API.
 * @returns {Object} Campos de unidad que cambian (vacío si no hay cambios).
 */
function toUnitChanges(draft, service) {
  const stored = storedUnitOptions(service);
  if (unitOptionsFingerprint(stored) === unitOptionsFingerprint(toDraftUnitOptions(draft))) return {};
  if (needsUnitOptions(draft) || stored.length > 1 || stored[0]?.presentationLabel) return { unitOptions: toDraftUnitOptions(draft) };
  const denominationId = draft.unitDenomination?.id ?? null;
  if (draft.measurementUnitId !== service.measurementUnit.id) {
    return { measurementUnitId: draft.measurementUnitId, unitDenominationId: denominationId };
  }
  return { unitDenominationId: denominationId };
}

/**
 * Cambios de la edición con la versión leída (`expectedVersion`). Solo incluye los campos que
 * cambian, para no sobrescribir datos que el administrador no tocó. Las unidades viajan con el
 * atajo o con la lista completa según toUnitChanges. La modalidad solo viaja si el administrador
 * la cambió explícitamente.
 *
 * @param {Object} draft - Borrador válido.
 * @param {Object} service - Servicio original leído de la API.
 * @returns {Object|null} Cuerpo de PATCH /admin/services/:id, o null si no hay cambios.
 */
export function toUpdateServiceChanges(draft, service) {
  const changes = {};
  const name = draft.name.trim();
  if (name !== service.name) changes.name = name;
  if (draft.kind !== service.kind) changes.kind = draft.kind;
  const description = draft.description.trim();
  if (description !== (service.description ?? "").trim()) changes.description = description || null;
  Object.assign(changes, toUnitChanges(draft, service));
  const rate = draft.referenceRate.trim();
  if (canonicalRate(rate) !== canonicalRate(service.referenceRate)) changes.referenceRate = rate;
  return Object.keys(changes).length ? { expectedVersion: service.currentVersion, ...changes } : null;
}

/**
 * Etiqueta del campo de unidad para una denominación: solo el texto ("de construcción"), sin
 * avatar, con cierre para quitarla (Figma: Tag dentro del campo).
 *
 * @param {{id: number, denomination: string}} denomination - Denominación.
 * @returns {{id: number, label: string, avatar: false, closeIcon: true}} Tag del Input.
 */
export function toDenominationTag(denomination) {
  return { id: denomination.id, label: denomination.denomination, avatar: false, closeIcon: true };
}

/**
 * Etiqueta del campo de unidad para una unidad base asignada sin denominación: su nombre
 * («Metro lineal»), con cierre para quitarla; el prefijo muestra la abreviatura.
 *
 * @param {{id: number, label: string, description?: string}} base - Unidad base (abreviatura en `label`).
 * @returns {{id: string, label: string, avatar: false, closeIcon: true}} Tag del Input.
 */
export function toBaseUnitTag(base) {
  return { id: `base:${base.id}`, label: base.description || base.label, avatar: false, closeIcon: true };
}

/**
 * Sugerencia del campo de unidad: símbolo y denominación («m² de construcción»), con la etiqueta
 * que compone el backend (`label`); la búsqueda del Input filtra sobre ese texto.
 *
 * @param {{id: number, denomination: string, label?: string, measurementUnit: {symbol: string}}} denomination - Denominación.
 * @returns {{id: number, label: string, avatar: false, closeIcon: true}} Opción del Input.
 */
export function toDenominationOption(denomination) {
  const label = denomination.label || `${denomination.measurementUnit?.symbol ?? ""} ${denomination.denomination}`.trim();
  return { id: denomination.id, label, avatar: false, closeIcon: true };
}

/**
 * Sugerencias activas de la base elegida, comparando identificadores internos y nunca símbolos.
 * Sin base no hay sugerencias. La unidad guardada inactiva se conserva en el borrador de edición,
 * pero no se ofrece como una selección nueva.
 *
 * @param {Array<{isActive?: boolean, measurementUnit: {id: number}}>} denominations - Denominaciones registradas.
 * @param {number|null} measurementUnitId - Identificador de la base seleccionada.
 * @returns {Array<Object>} Denominaciones que pueden seleccionarse.
 */
export function filterDenominationsForBase(denominations, measurementUnitId) {
  if (!measurementUnitId) return [];
  return (denominations || []).filter((item) => item.isActive !== false
    && item.measurementUnit?.isActive !== false && item.measurementUnit?.id === measurementUnitId);
}
