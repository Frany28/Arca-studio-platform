import { AppError, ConflictError } from "../errors/appError.js";
import { catalogVersionNote, diffServiceFromCatalog, planServices } from "../domain/officialServiceCatalog.js";
import { formatGeneratedServiceCode } from "../domain/serviceCatalog.js";
import {
  fingerprintServiceHistory,
  listServicesWithAlternativeUnits,
  readDatabaseIdentity,
  readNextSerialId,
  readServiceUnitOptionsMigrationState,
  summarizeQuoteReferences,
  tryAcquireCatalogLoadLock,
} from "../repositories/catalogMaintenanceRepository.js";
import { serviceUpdateSchema } from "../validation/serviceCatalogSchemas.js";
import {
  auditCatalogWrite,
  createPendingServices,
  denominationResolver,
  loadCatalogUnits,
  planCatalogDenominations,
  prepareCatalogServices,
  readExistingServices,
  verifyOfficialCatalog,
} from "./officialServiceCatalogLoadService.js";
import { updateService } from "./serviceCatalogService.js";

/*
 * Separación de los servicios con unidades alternativas en servicios independientes, una unidad
 * por servicio (comando scripts/split-service-units.mjs). El catálogo oficial revisado describe el
 * estado final: cada servicio con su única unidad, los originales con su nombre nuevo y los
 * servicios adicionales a continuación (orden N+1..., código generado por la secuencia).
 *
 * - `planServiceUnitSplit` solo lee. Cada servicio con alternativas debe estar en el catálogo con
 *   la misma unidad principal, tarifa y demás datos: la separación solo cambia su nombre y retira
 *   las alternativas vigentes. Las altas pendientes se calculan sobre ese estado previsto, con las
 *   reglas de la carga oficial (códigos SERV-00N y secuencia sin reiniciar). Bloquea si algún
 *   servicio afectado figura en cotizaciones, si habría que crear denominaciones o si la base no
 *   está lista, y registra la huella del historial.
 * - `applyServiceUnitSplit` repite el plan con el bloqueo de carga: versiona cada original con
 *   updateService (versión nueva; la anterior conserva sus unidades como historial) y crea los
 *   servicios adicionales con createService, auditando cada escritura. Termina verificando.
 * - `verifyServiceUnitSplit` comprueba el catálogo exacto, que no quedan alternativas vigentes y,
 *   con una huella anterior, que las versiones, sus unidades copiadas y los conceptos de
 *   cotización existentes no cambiaron.
 */

/** Origen registrado en auditoría para las escrituras de la separación. */
export const SERVICE_UNIT_SPLIT_AUDIT_SOURCE = "maintenance:split-service-units";

const SERVICE_TABLE = "public.services";

/**
 * Planifica la versión nueva de cada servicio con unidades alternativas: debe estar en el catálogo
 * y coincidir con él salvo en el nombre (las alternativas no son visibles en la forma pública).
 *
 * @param {Array<{ id: number, code: string, unitCount: number, currentVersion: number|null }>} legacy - Servicios con alternativas.
 * @param {Array<object>} existing - Servicios existentes (forma pública).
 * @param {Map<string, object>} preparedByCode - Servicios del catálogo preparados, por código previsto.
 * @param {Array<string>} blockers - Bloqueos acumulados (se modifica).
 * @returns {Array<object>} Pasos de versión.
 */
function planServiceVersions(legacy, existing, preparedByCode, blockers) {
  const byId = new Map(existing.map((service) => [service.id, service]));
  return legacy.map((item) => {
    const current = byId.get(item.id);
    const prepared = preparedByCode.get(item.code);
    if (!prepared) {
      blockers.push(`${item.code} «${current.name}» tiene unidades alternativas y no figura en el catálogo.`);
      return null;
    }
    const differences = diffServiceFromCatalog(current, prepared.expected).filter((field) => field !== "name");
    if (differences.length) {
      blockers.push(`${item.code}: la separación solo cambia el nombre y retira las unidades alternativas; además difiere en: ${differences.join(", ")}.`);
    }
    if (item.currentVersion === null) blockers.push(`${item.code} no tiene versión vigente.`);
    return {
      action: "version",
      code: item.code,
      currentVersion: item.currentVersion,
      fromName: current.name,
      nextVersion: item.currentVersion === null ? null : item.currentVersion + 1,
      referenceRate: current.referenceRate,
      removedUnits: item.unitCount - 1,
      serviceId: item.id,
      toName: prepared.entry.name,
      unitLabel: current.unitLabel,
    };
  }).filter(Boolean);
}

/**
 * Planifica la separación sin escribir ni consumir secuencias: destino, migración, unidades,
 * denominaciones (todas deben existir), versiones de los originales, altas pendientes con su
 * código previsto, referencias en cotizaciones y huella del historial. `ready` es true solo sin
 * bloqueos.
 *
 * @param {object} catalog - Catálogo revisado y validado (parseOfficialCatalog).
 * @param {object} options - Datos de la ejecución.
 * @param {string} options.runId - Identificador de la ejecución (para la nota de versión).
 * @returns {Promise<object>} Plan con destino, versiones, altas, cotizaciones, huella y bloqueos.
 */
export async function planServiceUnitSplit(catalog, { runId }) {
  const blockers = [];
  const target = await readDatabaseIdentity();
  if (target.inRecovery) blockers.push("La base está en recuperación (solo lectura).");
  const migration = await readServiceUnitOptionsMigrationState();
  if (!migration.structureReady) blockers.push("Falta la estructura de unidades por servicio (migración 20261027120000_service_unit_options).");
  const empty = { creations: [], denominations: [], pendingWrites: 0, ready: false, services: [], updates: [] };
  if (blockers.length) return { ...empty, blockers, migration, target };

  const { problems, unitsByCode } = await loadCatalogUnits(catalog);
  if (problems.length) return { ...empty, blockers: problems, migration, target };
  const denominations = await planCatalogDenominations(catalog, unitsByCode, blockers);
  for (const step of denominations.filter((item) => item.action !== "reuse")) {
    blockers.push(`La separación no crea denominaciones: «${step.label}» (${step.action}).`);
  }
  const prepared = prepareCatalogServices(catalog, {
    changeNote: catalogVersionNote(catalog.changeNote, runId),
    denominationId: denominationResolver(denominations),
    unitsByCode,
  }, blockers);
  const preparedByCode = new Map(prepared.map((item) => [formatGeneratedServiceCode(item.entry.order), item]));

  const existing = await readExistingServices();
  const legacy = await listServicesWithAlternativeUnits();
  const updates = planServiceVersions(legacy, existing, preparedByCode, blockers);
  // Las altas se planifican sobre el estado previsto tras versionar los originales.
  const renamed = new Map(updates.map((step) => [step.serviceId, step.toName]));
  const projected = existing.map((service) => (renamed.has(service.id) ? { ...service, name: renamed.get(service.id) } : service));
  const nextServiceId = await readNextSerialId(SERVICE_TABLE, "id");
  const servicePlan = planServices({ entries: prepared, existingServices: projected, nextServiceId });
  blockers.push(...servicePlan.blockers);
  const services = servicePlan.services.map((step, index) => ({
    ...step,
    kind: prepared[index].entry.kind,
    referenceRate: prepared[index].entry.referenceRate,
    sortOrder: prepared[index].entry.sortOrder,
  }));
  const creations = services.filter((step) => step.action === "create");

  // Cuenta todos los servicios con alternativas, también los que el catálogo no reconoce.
  const quoteReferences = await summarizeQuoteReferences(legacy.map((item) => item.id));
  if (quoteReferences.affectedQuoteItems > 0) {
    blockers.push(`${quoteReferences.affectedQuoteItems} conceptos de cotización incluyen servicios que se separarían: revísalos antes de continuar.`);
  }
  const history = await fingerprintServiceHistory();
  return {
    blockers,
    creations,
    denominations,
    history,
    migration,
    nextServiceId,
    pendingWrites: updates.length + creations.length,
    quoteReferences,
    ready: blockers.length === 0,
    services,
    target,
    updates,
  };
}

/**
 * Versiona cada servicio original con updateService (solo cambia el nombre; la sustitución de la
 * unidad retira las alternativas vigentes) y audita cada versión. Comprueba que la versión creada
 * sea la prevista.
 *
 * @param {Array<object>} updates - Pasos de versión del plan.
 * @param {object} context - Datos de la ejecución.
 * @param {string} context.changeNote - Nota de la versión nueva.
 * @param {Array<object>} context.completed - Escrituras hechas (se añade cada una).
 * @param {object} context.run - Ejecución (auditoría).
 * @param {{ id: number }} context.user - Administrador responsable.
 * @returns {Promise<void>}
 * @throws {ConflictError} SERVICE_SPLIT_VERSION_MISMATCH si la versión creada no es la prevista.
 */
async function versionOriginalServices(updates, { changeNote, completed, run, user }) {
  for (const step of updates) {
    const { body, params } = serviceUpdateSchema.parse({
      body: { changeNote, expectedVersion: step.currentVersion, name: step.toName },
      params: { serviceId: step.serviceId },
    });
    const { service } = await updateService({ payload: body, serviceId: params.serviceId, user });
    completed.push({ code: service.code, id: service.id, name: service.name, type: "service_version", version: service.currentVersion });
    if (service.currentVersion !== step.nextVersion) {
      throw new ConflictError("SERVICE_SPLIT_VERSION_MISMATCH", `${step.code} quedó en la versión ${service.currentVersion} en lugar de ${step.nextVersion}. La separación se detuvo.`);
    }
    await auditCatalogWrite({
      action: "service_catalog.unit_split.service_versioned",
      description: `Separación de unidades: ${step.code} versión ${service.currentVersion}`,
      entityId: service.id,
      entityType: "service",
      run,
      user,
      values: { code: step.code, fromName: step.fromName, removedUnits: step.removedUnits, toName: service.name, version: service.currentVersion },
    });
  }
}

/**
 * Ejecuta la separación: toma el bloqueo de carga, repite el plan y, sin bloqueos, versiona los
 * originales y crea los servicios adicionales a nombre del administrador, auditando cada escritura,
 * y verifica el resultado con la huella del historial tomada en el plan. Ante un error,
 * `error.serviceUnitSplit.completed` enumera lo escrito antes del fallo.
 *
 * @param {object} catalog - Catálogo revisado y validado.
 * @param {object} options - Datos de la ejecución.
 * @param {{ id: number }} options.user - Administrador autenticado.
 * @param {string} options.runId - Identificador de la ejecución.
 * @param {string} options.catalogSha256 - Huella SHA-256 del archivo aprobado.
 * @returns {Promise<{ plan: object, completed: Array<object>, verification: object }>} Resultado.
 * @throws {ConflictError} CATALOG_LOAD_IN_PROGRESS si otra operación del catálogo tiene el bloqueo.
 * @throws {AppError} SERVICE_SPLIT_BLOCKED si el plan tiene bloqueos (no escribe nada).
 */
export async function applyServiceUnitSplit(catalog, { catalogSha256, runId, user }) {
  const lock = await tryAcquireCatalogLoadLock();
  if (!lock) throw new ConflictError("CATALOG_LOAD_IN_PROGRESS", "Otra operación del catálogo está en curso.");
  const completed = [];
  try {
    const plan = await planServiceUnitSplit(catalog, { runId });
    if (!plan.ready) {
      const error = new AppError({ code: "SERVICE_SPLIT_BLOCKED", message: "La separación tiene bloqueos y no se escribió nada.", status: 409 });
      error.serviceUnitSplit = { completed, plan };
      throw error;
    }
    const run = { auditSource: SERVICE_UNIT_SPLIT_AUDIT_SOURCE, catalogId: catalog.catalogId, catalogSha256, runId };
    const changeNote = catalogVersionNote(catalog.changeNote, runId);
    await versionOriginalServices(plan.updates, { changeNote, completed, run, user });
    const { unitsByCode } = await loadCatalogUnits(catalog);
    const prepared = prepareCatalogServices(catalog, { changeNote, denominationId: denominationResolver(plan.denominations), unitsByCode });
    await createPendingServices(plan.services, prepared, { completed, run, user });
    return { completed, plan, verification: await verifyServiceUnitSplit(catalog, { historyBefore: plan.history }) };
  } catch (error) {
    error.serviceUnitSplit ??= { completed };
    throw error;
  } finally {
    await lock.release();
  }
}

/**
 * Compara la huella actual del historial, limitada a las filas que existían, con una anterior:
 * cualquier diferencia de filas o contenido indica que la operación alteró el historial.
 *
 * @param {object} before - Huella anterior (fingerprintServiceHistory).
 * @param {object} after - Huella actual limitada a los ids máximos de la anterior.
 * @returns {Array<string>} Incidencias; vacío si el historial no cambió.
 */
function compareHistory(before, after) {
  const labels = { quoteItems: "conceptos de cotización", versionUnits: "unidades copiadas en versiones", versions: "versiones de servicio" };
  return Object.entries(labels)
    .filter(([key]) => before[key].count !== after[key].count || before[key].digest !== after[key].digest)
    .map(([key, label]) => `El historial de ${label} cambió (${before[key].count} filas antes, ${after[key].count} después).`);
}

/**
 * Verifica en solo lectura el resultado de la separación: el catálogo exacto con una unidad por
 * servicio, ningún servicio con alternativas vigentes y, con la huella anterior, el historial intacto.
 *
 * @param {object} catalog - Catálogo revisado y validado.
 * @param {object} [options] - Opciones.
 * @param {object} [options.historyBefore] - Huella del plan (fingerprintServiceHistory).
 * @returns {Promise<{ ok: boolean, issues: Array<string>, notes: Array<string>, services: Array<object>,
 *   history: object|null, quoteReferences: object }>} Verificación.
 */
export async function verifyServiceUnitSplit(catalog, { historyBefore } = {}) {
  const verification = await verifyOfficialCatalog(catalog);
  const issues = [...verification.issues];
  const legacy = await listServicesWithAlternativeUnits();
  for (const item of legacy) issues.push(`${item.code} conserva ${item.unitCount} unidades vigentes.`);
  let history = null;
  if (historyBefore) {
    const after = await fingerprintServiceHistory({
      quoteItemId: historyBefore.quoteItems.maxId,
      versionId: historyBefore.versions.maxId,
      versionUnitId: historyBefore.versionUnits.maxId,
    });
    issues.push(...compareHistory(historyBefore, after));
    history = { after, before: historyBefore };
  }
  return { history, issues, notes: verification.notes, ok: issues.length === 0, quoteReferences: await summarizeQuoteReferences([]), services: verification.services };
}
