// Valores del formulario de servicios (Figma 5764:226084): las reglas reproducen el esquema del
// backend (serviceCreateSchema / serviceUpdateSchema) para avisar antes de enviar; el backend
// sigue siendo la autoridad. El código y el tipo no se editan: los genera el sistema.

export const SERVICE_NAME_MAX_LENGTH = 150;
export const SERVICE_DESCRIPTION_MAX_LENGTH = 2000;
// NUMERIC(14,2): hasta 12 enteros y 2 decimales, sin signo.
const REFERENCE_RATE_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

/**
 * Borrador inicial: vacío en el alta y con los datos reales del servicio en la edición. La
 * descripción y la tarifa se conservan tal como las guardó el backend (texto, sin conversión).
 *
 * @param {Object|null} service - Servicio leído de la API (edición) o null (alta).
 * @returns {{name: string, description: string, measurementUnitId: number|null,
 * unitDenomination: {id: number, denomination: string}|null, referenceRate: string}} Borrador.
 */
export function createServiceDraft(service) {
  return {
    name: service?.name ?? "",
    description: service?.description ?? "",
    measurementUnitId: service?.measurementUnit?.id ?? null,
    unitDenomination: service?.unitDenomination
      ? { id: service.unitDenomination.id, denomination: service.unitDenomination.denomination }
      : null,
    referenceRate: service?.referenceRate ?? "",
  };
}

/**
 * Valida el borrador con las reglas del contrato. Devuelve un mensaje por campo inválido.
 *
 * @param {Object} draft - Borrador del formulario.
 * @returns {{name?: string, description?: string, unit?: string, referenceRate?: string}} Errores.
 */
export function validateServiceDraft(draft) {
  const errors = {};
  const name = draft.name.trim();
  if (!name) errors.name = "Escribe el nombre del servicio.";
  else if (name.length > SERVICE_NAME_MAX_LENGTH) errors.name = `Usa como máximo ${SERVICE_NAME_MAX_LENGTH} caracteres.`;
  if (draft.description.trim().length > SERVICE_DESCRIPTION_MAX_LENGTH) {
    errors.description = `Usa como máximo ${SERVICE_DESCRIPTION_MAX_LENGTH} caracteres.`;
  }
  if (!draft.measurementUnitId) errors.unit = "Elige la unidad de medida.";
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
 * Cuerpo del alta: sin código ni tipo (los genera el sistema) y sin descripción si está vacía.
 * La tarifa viaja como texto para conservar su precisión.
 *
 * @param {Object} draft - Borrador válido.
 * @returns {Object} Cuerpo de POST /admin/services.
 */
export function toCreateServicePayload(draft) {
  const description = draft.description.trim();
  return {
    name: draft.name.trim(),
    ...(description ? { description } : {}),
    measurementUnitId: draft.measurementUnitId,
    ...(draft.unitDenomination ? { unitDenominationId: draft.unitDenomination.id } : {}),
    referenceRate: draft.referenceRate.trim(),
  };
}

/**
 * Cambios de la edición con la versión leída (`expectedVersion`). Solo incluye los campos que
 * cambian, para no sobrescribir datos que el administrador no tocó; cambiar la unidad base envía
 * también la denominación (de la nueva base o null), como exige el contrato.
 *
 * @param {Object} draft - Borrador válido.
 * @param {Object} service - Servicio original leído de la API.
 * @returns {Object|null} Cuerpo de PATCH /admin/services/:id, o null si no hay cambios.
 */
export function toUpdateServiceChanges(draft, service) {
  const changes = {};
  const name = draft.name.trim();
  if (name !== service.name) changes.name = name;
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
