// Valores del formulario de servicios (Figma 5764:226084): las reglas reproducen el esquema del
// backend (serviceCreateSchema / serviceUpdateSchema) y su regla de llave en mano para avisar
// antes de enviar; el backend sigue siendo la autoridad. El código no se edita: lo genera el sistema.

export const SERVICE_NAME_MAX_LENGTH = 150;
// Modalidades del contrato (`kind`). Llave en mano solo admite la unidad base de superficie con
// código estable `square_meter` (cualquier denominación de esa base), como
// TURNKEY_COMPATIBLE_UNIT_CODES en el dominio del backend; nunca se decide por el símbolo visible.
export const SERVICE_KINDS = Object.freeze({ INDIVIDUAL: "individual", TURNKEY: "turnkey" });
const SERVICE_KIND_VALUES = Object.freeze(Object.values(SERVICE_KINDS));
const TURNKEY_UNIT_CODES = Object.freeze(["square_meter"]);
const TURNKEY_UNIT_MESSAGE = "Llave en mano requiere una unidad en metros cuadrados (m²).";
export const SERVICE_DESCRIPTION_MAX_LENGTH = 2000;
// NUMERIC(14,2): hasta 12 enteros y 2 decimales, sin signo.
const REFERENCE_RATE_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

/**
 * Borrador inicial: vacío en el alta y con los datos reales del servicio en la edición. La
 * descripción y la tarifa se conservan tal como las guardó el backend (texto, sin conversión).
 *
 * La modalidad empieza sin elegir en el alta (se exige una selección) y en la edición es la
 * guardada, sin conversiones.
 *
 * @param {Object|null} service - Servicio leído de la API (edición) o null (alta).
 * @returns {{name: string, kind: string, description: string, measurementUnitId: number|null,
 * unitDenomination: {id: number, denomination: string}|null, referenceRate: string}} Borrador.
 */
export function createServiceDraft(service) {
  return {
    name: service?.name ?? "",
    kind: service?.kind ?? "",
    description: service?.description ?? "",
    measurementUnitId: service?.measurementUnit?.id ?? null,
    unitDenomination: service?.unitDenomination
      ? { id: service.unitDenomination.id, denomination: service.unitDenomination.denomination }
      : null,
    referenceRate: service?.referenceRate ?? "",
  };
}

/**
 * Indica si una unidad base puede usarse con la modalidad: individual admite cualquiera y llave
 * en mano solo la de código `square_meter`.
 *
 * @param {string} kind - Modalidad (`individual` o `turnkey`).
 * @param {string|undefined} unitCode - Código estable de la unidad base.
 * @returns {boolean} true si la combinación es válida.
 */
export function isBaseUnitAllowedForKind(kind, unitCode) {
  return kind !== SERVICE_KINDS.TURNKEY || TURNKEY_UNIT_CODES.includes(unitCode);
}

/**
 * Unidades base que el selector ofrece para la modalidad: todas en individual (o sin modalidad
 * elegida) y solo m² en llave en mano.
 *
 * @param {Array<{id: number, code?: string}>} options - Unidades base disponibles.
 * @param {string} kind - Modalidad del borrador.
 * @returns {Array<Object>} Opciones permitidas (la misma lista si no hay restricción).
 */
export function filterBaseOptionsForKind(options, kind) {
  const list = Array.isArray(options) ? options : [];
  return kind === SERVICE_KINDS.TURNKEY ? list.filter((option) => isBaseUnitAllowedForKind(kind, option.code)) : list;
}

/**
 * Cambio de modalidad del borrador: conserva la unidad y la denominación si siguen siendo válidas
 * y, si la base no admite la nueva modalidad (o se desconoce su código), las retira para que el
 * administrador elija una compatible. Solo responde a una elección explícita del administrador.
 *
 * @param {Object} draft - Borrador actual.
 * @param {string} kind - Modalidad elegida.
 * @param {Array<{id: number, code?: string}>} baseOptions - Unidades base conocidas (con su código).
 * @returns {{kind: string, measurementUnitId?: null, unitDenomination?: null}} Cambios del borrador.
 */
export function changeDraftKind(draft, kind, baseOptions) {
  if (!draft.measurementUnitId) return { kind };
  const unitCode = (baseOptions || []).find((option) => option.id === draft.measurementUnitId)?.code;
  return isBaseUnitAllowedForKind(kind, unitCode) ? { kind } : { kind, measurementUnitId: null, unitDenomination: null };
}

/**
 * Valida el borrador con las reglas del contrato. Devuelve un mensaje por campo inválido.
 *
 * @param {Object} draft - Borrador del formulario.
 * La unidad es una denominación registrada; solo se admite la base sin denominación cuando la
 * edición conserva la unidad que el servicio ya tenía así (`allowBaseOnly`).
 *
 * @param {Object} draft - Borrador del formulario.
 * @param {Object} [context] - Datos que dependen del catálogo.
 * @param {string} [context.unitCode] - Código estable de la unidad base elegida.
 * @param {boolean} [context.allowBaseOnly] - La base sin denominación es la guardada del servicio.
 * @returns {{name?: string, kind?: string, description?: string, unit?: string, referenceRate?: string}} Errores.
 */
export function validateServiceDraft(draft, { allowBaseOnly = false, unitCode } = {}) {
  const errors = {};
  const name = draft.name.trim();
  if (!name) errors.name = "Escribe el nombre del servicio.";
  else if (name.length > SERVICE_NAME_MAX_LENGTH) errors.name = `Usa como máximo ${SERVICE_NAME_MAX_LENGTH} caracteres.`;
  if (!SERVICE_KIND_VALUES.includes(draft.kind)) errors.kind = "Elige la modalidad de contratación.";
  if (draft.description.trim().length > SERVICE_DESCRIPTION_MAX_LENGTH) {
    errors.description = `Usa como máximo ${SERVICE_DESCRIPTION_MAX_LENGTH} caracteres.`;
  }
  if (!draft.measurementUnitId || (!draft.unitDenomination && !allowBaseOnly)) errors.unit = "Elige la unidad de medida.";
  else if (!isBaseUnitAllowedForKind(draft.kind, unitCode)) errors.unit = TURNKEY_UNIT_MESSAGE;
  const rate = draft.referenceRate.trim();
  if (!rate) errors.referenceRate = "Indica la tarifa.";
  else if (!REFERENCE_RATE_PATTERN.test(rate)) errors.referenceRate = "Usa hasta 12 enteros y 2 decimales, sin signo (por ejemplo, 12.50).";
  return errors;
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
 * si está vacía. La tarifa viaja como texto para conservar su precisión.
 *
 * @param {Object} draft - Borrador válido.
 * @returns {Object} Cuerpo de POST /admin/services.
 */
export function toCreateServicePayload(draft) {
  const description = draft.description.trim();
  return {
    name: draft.name.trim(),
    kind: draft.kind,
    ...(description ? { description } : {}),
    measurementUnitId: draft.measurementUnitId,
    ...(draft.unitDenomination ? { unitDenominationId: draft.unitDenomination.id } : {}),
    referenceRate: draft.referenceRate.trim(),
  };
}

/**
 * Cambios de la edición con la versión leída (`expectedVersion`). Solo incluye los campos que
 * cambian, para no sobrescribir datos que el administrador no tocó; cambiar la unidad base envía
 * también la denominación (de la nueva base o null), como exige el contrato. La modalidad solo
 * viaja si el administrador la cambió explícitamente.
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
  const denominationId = draft.unitDenomination?.id ?? null;
  const originalDenominationId = service.unitDenomination?.id ?? null;
  if (draft.measurementUnitId !== service.measurementUnit.id) {
    changes.measurementUnitId = draft.measurementUnitId;
    changes.unitDenominationId = denominationId;
  } else if (denominationId !== originalDenominationId) {
    changes.unitDenominationId = denominationId;
  }
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
 * Unidades de medida registradas que admite la modalidad: todas en individual (o sin modalidad
 * elegida) y solo las de base `square_meter` en llave en mano (por código, nunca por símbolo).
 *
 * @param {Array<{measurementUnit: {code: string}}>} denominations - Denominaciones activas.
 * @param {string} kind - Modalidad del borrador.
 * @returns {Array<Object>} Denominaciones permitidas (la misma lista si no hay restricción).
 */
export function filterDenominationsForKind(denominations, kind) {
  const list = Array.isArray(denominations) ? denominations : [];
  return kind === SERVICE_KINDS.TURNKEY ? list.filter((item) => isBaseUnitAllowedForKind(kind, item.measurementUnit?.code)) : list;
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
  return (denominations || []).filter((item) => item.isActive !== false && item.measurementUnit?.id === measurementUnitId);
}
