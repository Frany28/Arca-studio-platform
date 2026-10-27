/*
 * Reglas puras del catálogo de servicios (tabulador). No conocen PostgreSQL ni HTTP.
 *
 * - Modalidades de contratación: `individual` («Detalle por detalle») y `turnkey` («Llave en
 *   mano»). El administrador la elige al crear el servicio; omitida, es `individual`.
 * - La modalidad no restringe la unidad: ambas admiten cualquier unidad base registrada y activa
 *   (m², m³, m.l., und., pto., hrs...), con las mismas reglas de estado y referencias.
 * - Moneda única USD en esta fase (restricción también presente en PostgreSQL).
 * - Código visible generado por el sistema a partir del id (`SERV-001`, `SERV-1000`), como el
 *   `publicCode` de las unidades.
 * - Un cambio es efectivo cuando altera algún campo versionado; la nota de cambio sola no
 *   genera una versión nueva.
 */

import { formatGeneratedCode } from "./generatedCode.js";

export const SERVICE_KINDS = Object.freeze({ INDIVIDUAL: "individual", TURNKEY: "turnkey" });

export const SERVICE_CURRENCY = "USD";

/** Modalidad que se asigna cuando el alta no indica `kind` (compatibilidad con clientes previos). */
export const DEFAULT_SERVICE_KIND = SERVICE_KINDS.INDIVIDUAL;

const GENERATED_CODE_PREFIX = "SERV-";

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
  return formatGeneratedCode(GENERATED_CODE_PREFIX, serviceId, "service_catalog: el id del servicio");
}

/** Campos editables que forman parte de cada versión del servicio. */
export const SERVICE_EDITABLE_FIELDS = Object.freeze([
  "name", "description", "kind", "measurementUnitId", "unitDenominationId", "referenceRate", "isActive", "sortOrder",
]);

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
