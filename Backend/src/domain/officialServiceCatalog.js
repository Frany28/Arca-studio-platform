/*
 * Reglas puras de la carga del catálogo oficial. No conocen PostgreSQL ni HTTP: reciben lo leído
 * de la base y deciden qué crear, qué ya existe y qué impide la carga.
 *
 * - El servicio de orden N debe quedar como `SERV-00N` (código derivado del id). Por eso los
 *   servicios existentes deben ser exactamente los N primeros del catálogo, idénticos, y la
 *   secuencia debe entregar el id siguiente. Cualquier otra situación bloquea la carga: nunca se
 *   reinicia la secuencia ni se modifica un servicio existente.
 * - Una denominación existente se reutiliza solo si está activa y su texto es idéntico; una
 *   equivalente inactiva o escrita de otra forma bloquea la carga (decisión administrativa).
 * - Los cuerpos de alta son los mismos que acepta `POST /admin/services` y
 *   `POST /admin/measurement-unit-denominations`; el backend los vuelve a validar.
 */

import { SERVICE_CURRENCY, formatGeneratedServiceCode } from "./serviceCatalog.js";
import { currentUnitOptions, resolveUnitOptions, toCanonicalUnitOption } from "./serviceUnitOptions.js";

/** Origen registrado en auditoría para las operaciones del comando. */
export const CATALOG_LOAD_AUDIT_SOURCE = "maintenance:load-official-service-catalog";

/**
 * Nota de la versión 1 de cada servicio cargado: la del catálogo más el identificador de la
 * ejecución, que enlaza la versión con el informe y la auditoría.
 *
 * @param {string} changeNote - Nota declarada en el catálogo.
 * @param {string} runId - Identificador de la ejecución.
 * @returns {string} Nota de versión.
 */
export function catalogVersionNote(changeNote, runId) {
  return `${changeNote} · carga ${runId}`;
}

/**
 * Convierte las unidades de un servicio del catálogo en las unidades del cuerpo de alta
 * (`unitOptions`), con los ids reales de unidad y denominación. Con una sola unidad no se envía
 * tarifa aparte: el backend usa la del servicio.
 *
 * @param {object} entry - Servicio validado del catálogo.
 * @param {object} lookups - Ids resueltos.
 * @param {Map<string, { id: number }>} lookups.unitsByCode - Unidades base por código.
 * @param {(unit: string, denomination: string) => number} lookups.denominationId - Id de una denominación.
 * @returns {Array<object>} Unidades del cuerpo de alta.
 */
export function toCatalogUnitOptions(entry, { denominationId, unitsByCode }) {
  return entry.units.map((unit) => ({
    measurementUnitId: unitsByCode.get(unit.unit).id,
    presentationLabel: unit.presentationLabel,
    unitDenominationId: unit.denomination === null ? null : denominationId(unit.unit, unit.denomination),
    ...(entry.units.length > 1 ? { referenceRate: unit.referenceRate } : {}),
  }));
}

/**
 * Cuerpo de alta de un servicio del catálogo, como el de `POST /admin/services`: activo, con su
 * orden de visualización igual a su orden en el documento y la nota de versión de la carga.
 *
 * @param {object} entry - Servicio validado del catálogo.
 * @param {object} options - Datos de la carga.
 * @param {Array<object>} options.unitOptions - Unidades resueltas (toCatalogUnitOptions).
 * @param {string} options.changeNote - Nota de la versión 1.
 * @returns {object} Cuerpo de alta.
 */
export function toServiceCreateBody(entry, { changeNote, unitOptions }) {
  return {
    changeNote,
    description: entry.description,
    isActive: true,
    kind: entry.kind,
    name: entry.name,
    referenceRate: entry.referenceRate,
    sortOrder: entry.order,
    unitOptions,
  };
}

/**
 * Estado esperado de un servicio del catálogo en la forma canónica del dominio, para compararlo
 * con un servicio existente: con una sola unidad su tarifa es la del servicio.
 *
 * @param {object} entry - Servicio validado del catálogo.
 * @param {Array<object>} unitOptions - Unidades resueltas (toCatalogUnitOptions).
 * @returns {object} Estado esperado.
 */
export function expectedServiceState(entry, unitOptions) {
  return {
    currency: SERVICE_CURRENCY,
    description: entry.description,
    isActive: true,
    kind: entry.kind,
    name: entry.name,
    referenceRate: entry.referenceRate,
    sortOrder: entry.order,
    unitOptions: resolveUnitOptions({ changes: { unitOptions }, current: [], referenceRate: entry.referenceRate }),
  };
}

/**
 * Enumera los campos en que un servicio existente difiere del estado esperado del catálogo.
 * Las unidades se comparan en forma canónica (orden, unidad, denominación, texto y tarifa).
 *
 * @param {object} service - Servicio existente (forma pública del repositorio).
 * @param {object} expected - Estado esperado (expectedServiceState).
 * @returns {Array<string>} Campos distintos; vacío si coincide por completo.
 */
export function diffServiceFromCatalog(service, expected) {
  const fields = ["name", "description", "kind", "referenceRate", "sortOrder", "isActive", "currency"]
    .filter((field) => service[field] !== expected[field]);
  const actualUnits = JSON.stringify(currentUnitOptions(service));
  if (actualUnits !== JSON.stringify(expected.unitOptions.map(toCanonicalUnitOption))) fields.push("unitOptions");
  return fields;
}

/**
 * Decide la acción de cada denominación del catálogo a partir de la equivalente existente:
 * reutilizarla si está activa con el mismo texto, crearla si no existe o bloquear la carga.
 *
 * @param {object} item - Denominación del catálogo (`unit`, `denomination`).
 * @param {{ id: number, publicCode: string, denomination: string, isActive: boolean }|null} existing - Equivalente existente.
 * @returns {{ action: "reuse"|"create"|"blocked", reason?: string }} Decisión.
 */
export function planDenomination(item, existing) {
  if (!existing) return { action: "create" };
  if (!existing.isActive) {
    return { action: "blocked", reason: `${existing.publicCode} «${existing.denomination}» existe pero está inactiva.` };
  }
  if (existing.denomination !== item.denomination) {
    return { action: "blocked", reason: `${existing.publicCode} está escrita como «${existing.denomination}».` };
  }
  return { action: "reuse" };
}

/**
 * Decide qué servicios del catálogo crear y comprueba que cada uno recibirá su código
 * (`SERV-00N` para el orden N): los existentes deben ser los primeros del catálogo, idénticos, y
 * la secuencia debe entregar el id del primer servicio pendiente.
 *
 * @param {object} options - Datos leídos.
 * @param {Array<{ entry: object, expected: object }>} options.entries - Servicios del catálogo con su estado esperado.
 * @param {Array<object>} options.existingServices - Servicios existentes (forma pública), cualquier estado.
 * @param {number} options.nextServiceId - Próximo id de la secuencia de servicios.
 * @returns {{ services: Array<object>, blockers: Array<string> }} Pasos por servicio y bloqueos.
 */
export function planServices({ entries, existingServices, nextServiceId }) {
  const blockers = [];
  const byCode = new Map(entries.map((item) => [formatGeneratedServiceCode(item.entry.order), item]));
  const existingByCode = new Map();
  for (const service of existingServices) {
    const item = byCode.get(service.code);
    if (!item) {
      blockers.push(`${service.code} «${service.name}» no corresponde al catálogo: el catálogo debe empezar en SERV-001 sin otros servicios.`);
      continue;
    }
    const differences = diffServiceFromCatalog(service, item.expected);
    if (differences.length) blockers.push(`${service.code} ya existe y difiere del catálogo en: ${differences.join(", ")}.`);
    existingByCode.set(service.code, service);
  }
  const services = entries.map(({ entry }) => {
    const expectedCode = formatGeneratedServiceCode(entry.order);
    const existing = existingByCode.get(expectedCode);
    return { action: existing ? "exists" : "create", expectedCode, name: entry.name, order: entry.order, serviceId: existing?.id ?? null };
  });
  const firstPending = services.find((step) => step.action === "create");
  if (firstPending && services.some((step) => step.action === "exists" && step.order > firstPending.order)) {
    blockers.push("Los servicios existentes no son los primeros del catálogo en orden.");
  }
  if (firstPending && nextServiceId !== firstPending.order) {
    blockers.push(`La secuencia de servicios entregaría ${formatGeneratedServiceCode(nextServiceId)} y el siguiente debe ser ${firstPending.expectedCode}. No se reinicia la secuencia sin autorización.`);
  }
  return { blockers, services };
}
