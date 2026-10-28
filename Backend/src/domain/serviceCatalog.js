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
import { currentUnitOptions, resolveUnitOptions, unitOptionsChanged } from "./serviceUnitOptions.js";

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

/**
 * Campos editables que forman parte de cada versión del servicio. `measurementUnitId` y
 * `unitDenominationId` son la unidad principal (posición 1 de `unitOptions`).
 */
export const SERVICE_EDITABLE_FIELDS = Object.freeze([
  "name", "description", "kind", "measurementUnitId", "unitDenominationId", "unitOptions", "referenceRate", "isActive", "sortOrder",
]);

// Campos simples: se copian del cuerpo si llegan. Las unidades se resuelven aparte.
const SCALAR_FIELDS = Object.freeze(["name", "description", "kind", "referenceRate", "isActive", "sortOrder"]);

/**
 * Combina el estado vigente de un servicio con los campos enviados en una edición.
 * Los campos omitidos conservan su valor; `description` y `unitDenominationId` admiten null
 * explícito para borrarlos (sin denominación el servicio usa solo la unidad base). Las unidades
 * se resuelven con resolveUnitOptions y la principal define `measurementUnitId` y
 * `unitDenominationId`.
 *
 * @param {object} current - Servicio vigente (forma pública del repositorio, con `unitOptions`).
 * @param {object} changes - Campos editables validados.
 * @returns {{ name: string, description: string|null, kind: string, measurementUnitId: number,
 *   unitDenominationId: number|null, unitOptions: Array<object>, referenceRate: string, isActive: boolean,
 *   sortOrder: number }} Estado resultante.
 */
export function mergeServiceChanges(current, changes) {
  const next = {
    description: current.description,
    isActive: current.isActive,
    kind: current.kind,
    name: current.name,
    referenceRate: current.referenceRate,
    sortOrder: current.sortOrder,
  };
  for (const field of SCALAR_FIELDS) {
    if (changes[field] !== undefined) next[field] = changes[field];
  }
  const unitOptions = resolveUnitOptions({ changes, current: currentUnitOptions(current), referenceRate: next.referenceRate });
  return {
    ...next,
    measurementUnitId: unitOptions[0].measurementUnitId,
    unitDenominationId: unitOptions[0].unitDenominationId,
    unitOptions,
  };
}

/**
 * Enumera los campos versionados cuyo valor cambia entre el servicio vigente y el estado nuevo.
 * Las tarifas se comparan como texto decimal normalizado ("12.00"), igual que las devuelve
 * PostgreSQL para NUMERIC(14,2), por lo que 12 y "12.00" no se consideran un cambio. Las
 * unidades cambian si varía su orden, unidad, denominación, texto comercial o tarifa.
 *
 * @param {object} current - Servicio vigente (forma pública del repositorio).
 * @param {object} next - Estado resultante de mergeServiceChanges.
 * @returns {Array<string>} Campos modificados; vacío si no hay cambio efectivo.
 */
export function listChangedServiceFields(current, next) {
  const before = mergeServiceChanges(current, {});
  return SERVICE_EDITABLE_FIELDS.filter((field) => (field === "unitOptions"
    ? unitOptionsChanged(before.unitOptions, next.unitOptions)
    : before[field] !== next[field]));
}
