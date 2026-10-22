/*
 * Reglas puras del catálogo de servicios (tabulador). No conocen PostgreSQL ni HTTP.
 *
 * - Tipos: `individual` (servicio del tabulador) y `turnkey` (modalidad llave en mano).
 * - Las modalidades llave en mano se cotizan por superficie: su unidad debe identificarse
 *   por un código estable de superficie, nunca por el nombre o símbolo visibles.
 * - Moneda única USD en esta fase (restricción también presente en PostgreSQL).
 * - Código visible generado por el sistema a partir del id (`SERV-001`, `SERV-1000`), como el
 *   `publicCode` de las unidades; los servicios del tabulador son individuales por defecto.
 * - Un cambio es efectivo cuando altera algún campo versionado; la nota de cambio sola no
 *   genera una versión nueva.
 */

export const SERVICE_KINDS = Object.freeze({ INDIVIDUAL: "individual", TURNKEY: "turnkey" });

export const SERVICE_CURRENCY = "USD";

/** Tipo de los servicios del tabulador; `turnkey` corresponde a la modalidad de las solicitudes. */
export const DEFAULT_SERVICE_KIND = SERVICE_KINDS.INDIVIDUAL;

const GENERATED_CODE_PREFIX = "SERV-";
const GENERATED_CODE_MIN_DIGITS = 3;

/**
 * Compone el código visible de un servicio a partir de su id: `SERV-` y el id con al menos tres
 * dígitos (`SERV-001`, `SERV-1000`). Hereda la unicidad y la permanencia del id, admite saltos
 * y cumple el CHECK de PostgreSQL (`chk_services_code`). Es solo presentación y búsqueda.
 *
 * @param {number} serviceId - Identificador del servicio (entero positivo).
 * @returns {string} Código generado.
 * @throws {TypeError} Si el id no es un entero positivo seguro.
 */
export function formatGeneratedServiceCode(serviceId) {
  if (!Number.isSafeInteger(serviceId) || serviceId <= 0) {
    throw new TypeError("service_catalog: el id del servicio debe ser un entero positivo.");
  }
  return `${GENERATED_CODE_PREFIX}${String(serviceId).padStart(GENERATED_CODE_MIN_DIGITS, "0")}`;
}

/**
 * Códigos estables de unidades de superficie compatibles con m². La carga inicial de
 * unidades debe registrar el metro cuadrado con el código `square_meter`.
 */
export const TURNKEY_COMPATIBLE_UNIT_CODES = Object.freeze(["square_meter"]);

/** Campos editables que forman parte de cada versión del servicio. */
export const SERVICE_EDITABLE_FIELDS = Object.freeze([
  "name", "description", "kind", "measurementUnitId", "unitDenominationId", "referenceRate", "isActive", "sortOrder",
]);

/**
 * Indica si una unidad de medida puede asignarse a un servicio del tipo indicado.
 * Los servicios individuales admiten cualquier unidad; los llave en mano solo unidades de
 * superficie identificadas por su código estable.
 *
 * @param {string} kind - Tipo del servicio (`individual` o `turnkey`).
 * @param {{ code: string }} unit - Unidad de medida con su código estable.
 * @returns {boolean} true si la combinación es válida.
 */
export function isUnitCompatibleWithKind(kind, unit) {
  if (kind !== SERVICE_KINDS.TURNKEY) return true;
  return TURNKEY_COMPATIBLE_UNIT_CODES.includes(unit?.code);
}

/**
 * Combina el estado vigente de un servicio con los campos enviados en una edición.
 * Los campos omitidos conservan su valor; `description` y `unitDenominationId` admiten null
 * explícito para borrarlos (sin denominación el servicio usa solo la unidad base).
 *
 * @param {object} current - Servicio vigente (forma pública del repositorio).
 * @param {object} changes - Campos editables validados.
 * @returns {{ name: string, description: string|null, kind: string, measurementUnitId: number,
 *   unitDenominationId: number|null, referenceRate: string, isActive: boolean, sortOrder: number }} Estado resultante.
 */
export function mergeServiceChanges(current, changes) {
  const currentState = {
    description: current.description,
    isActive: current.isActive,
    kind: current.kind,
    measurementUnitId: current.measurementUnit.id,
    name: current.name,
    referenceRate: current.referenceRate,
    sortOrder: current.sortOrder,
    unitDenominationId: current.unitDenomination?.id ?? null,
  };
  const next = { ...currentState };
  for (const field of SERVICE_EDITABLE_FIELDS) {
    if (changes[field] !== undefined) next[field] = changes[field];
  }
  return next;
}

/**
 * Enumera los campos versionados cuyo valor cambia entre el servicio vigente y el estado nuevo.
 * Las tarifas se comparan como texto decimal normalizado ("12.00"), igual que las devuelve
 * PostgreSQL para NUMERIC(14,2), por lo que 12 y "12.00" no se consideran un cambio.
 *
 * @param {object} current - Servicio vigente (forma pública del repositorio).
 * @param {object} next - Estado resultante de mergeServiceChanges.
 * @returns {Array<string>} Campos modificados; vacío si no hay cambio efectivo.
 */
export function listChangedServiceFields(current, next) {
  const before = mergeServiceChanges(current, {});
  return SERVICE_EDITABLE_FIELDS.filter((field) => before[field] !== next[field]);
}
