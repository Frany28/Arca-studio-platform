import { AppError, ConflictError, ValidationError } from "../errors/appError.js";
import { formatGeneratedCode } from "../domain/generatedCode.js";
import { formatUnitLabel } from "../domain/measurementUnitLabel.js";
import {
  CATALOG_LOAD_AUDIT_SOURCE,
  catalogVersionNote,
  diffServiceFromCatalog,
  expectedServiceState,
  planDenomination,
  planServices,
  toCatalogServiceUnit,
  toServiceCreateBody,
} from "../domain/officialServiceCatalog.js";
import { formatGeneratedServiceCode } from "../domain/serviceCatalog.js";
import { formatUnitOptionLabel } from "../domain/serviceUnitOptions.js";
import { insertAuditLog } from "../repositories/auditLogRepository.js";
import {
  findEquivalentDenomination,
  listAllServiceIds,
  listMeasurementUnitsByCode,
  readDatabaseIdentity,
  readNextSerialId,
  readServiceUnitOptionsMigrationState,
  summarizeServiceVersions,
  tryAcquireCatalogLoadLock,
} from "../repositories/catalogMaintenanceRepository.js";
import { findServiceById } from "../repositories/serviceCatalogRepository.js";
import { denominationCreateSchema } from "../validation/measurementUnitSchemas.js";
import { catalogDenominationKey, officialServiceCatalogSchema } from "../validation/officialServiceCatalogSchemas.js";
import { serviceCreateSchema } from "../validation/serviceCatalogSchemas.js";
import { createDenomination } from "./measurementUnitService.js";
import { createService } from "./serviceCatalogService.js";

/*
 * Carga controlada del catálogo oficial (comando scripts/load-official-service-catalog.mjs).
 *
 * - `planOfficialCatalogLoad` solo lee: valida el archivo, comprueba la migración, las unidades,
 *   las denominaciones y los servicios existentes, predice los códigos y enumera los bloqueos.
 *   No consume secuencias: un ensayo con escrituras revertidas gastaría códigos SERV.
 * - `applyOfficialCatalogLoad` repite el plan con el bloqueo de carga tomado y crea cada
 *   denominación y servicio con los servicios del dominio (validaciones, bloqueos, versión 1 y
 *   traducción de errores del backend), a nombre del administrador autenticado.
 * - Atomicidad: cada alta es atómica (su transacción). La carga completa es reanudable: lo ya
 *   creado e idéntico se reconoce y se omite, y antes de cada servicio se comprueba que la
 *   secuencia entregue su código; si no, se detiene sin crear nada más.
 * - `verifyOfficialCatalog` comprueba después, en solo lectura, servicios, unidades y versiones.
 */

const SERVICE_TABLE = "public.services";
const DENOMINATION_TABLE = "public.measurement_unit_denominations";
const DENOMINATION_CODE_PREFIX = "UNID-";
// Ids provisionales de denominaciones aún no creadas, solo para validar los cuerpos de alta en el
// plan (positivos, distintos y fuera del rango real de un catálogo pequeño).
const PLACEHOLDER_DENOMINATION_ID_BASE = 2_000_000_000;

/**
 * Valida el contenido del archivo del catálogo con officialServiceCatalogSchema y devuelve el
 * catálogo normalizado (textos NFC, tarifas «12.00»). Los errores llevan la ruta del campo.
 *
 * @param {unknown} raw - Contenido JSON ya interpretado.
 * @returns {object} Catálogo validado.
 * @throws {ValidationError} Si el archivo no cumple el esquema o sus reglas de coherencia.
 */
export function parseOfficialCatalog(raw) {
  const result = officialServiceCatalogSchema.safeParse(raw);
  if (result.success) return result.data;
  const fields = {};
  for (const issue of result.error.issues) fields[issue.path.join(".") || "catalog"] ??= issue.message;
  throw new ValidationError("El archivo del catálogo no es válido.", fields);
}

/**
 * Convierte los errores de un esquema Zod del backend en textos legibles para el plan, con el
 * elemento afectado y la ruta del campo.
 *
 * @param {string} subject - Elemento validado («SERV-001»).
 * @param {import("zod").ZodError} error - Error de Zod.
 * @returns {Array<string>} Mensajes.
 */
function describeSchemaIssues(subject, error) {
  return error.issues.map((issue) => `${subject}: ${issue.path.join(".")} ${issue.message}`);
}

/**
 * Lee las unidades base que usa el catálogo e informa de cada una que falte o esté inactiva:
 * el backend rechazaría cualquier alta que la use.
 *
 * @param {object} catalog - Catálogo validado.
 * @returns {Promise<{ unitsByCode: Map<string, object>, problems: Array<string> }>} Unidades por
 *   código y problemas encontrados.
 */
export async function loadCatalogUnits(catalog) {
  const codes = [...new Set([...catalog.denominations.map((item) => item.unit), ...catalog.services.map((service) => service.unit)])];
  const unitsByCode = await listMeasurementUnitsByCode(codes);
  const problems = [];
  for (const code of codes) {
    const unit = unitsByCode.get(code);
    if (!unit) problems.push(`La unidad base «${code}» no existe.`);
    else if (!unit.isActive) problems.push(`La unidad base «${code}» está inactiva.`);
  }
  return { problems, unitsByCode };
}

/**
 * Planifica las denominaciones: reutiliza las equivalentes activas e idénticas, predice el código
 * de las nuevas (UNID-00N, sin consumir la secuencia) y valida cada alta con su esquema real.
 *
 * @param {object} catalog - Catálogo validado.
 * @param {Map<string, object>} unitsByCode - Unidades base por código (todas existentes).
 * @param {Array<string>} blockers - Bloqueos acumulados (se modifica).
 * @returns {Promise<Array<object>>} Pasos de denominación en el orden del archivo.
 */
export async function planCatalogDenominations(catalog, unitsByCode, blockers) {
  let nextId = await readNextSerialId(DENOMINATION_TABLE, "id");
  const steps = [];
  for (const [index, item] of catalog.denominations.entries()) {
    const unit = unitsByCode.get(item.unit);
    const label = formatUnitLabel(unit.symbol, item.denomination);
    const existing = await findEquivalentDenomination(unit.id, item.denomination);
    const decision = planDenomination(item, existing);
    if (decision.action === "blocked") blockers.push(`Denominación «${label}»: ${decision.reason}`);
    const parsed = denominationCreateSchema.safeParse({ body: { denomination: item.denomination, measurementUnitId: unit.id } });
    if (!parsed.success) blockers.push(...describeSchemaIssues(`Denominación «${label}»`, parsed.error));
    const step = {
      action: decision.action,
      denomination: item.denomination,
      id: existing?.id ?? null,
      key: catalogDenominationKey(item.unit, item.denomination),
      label,
      provisionalId: PLACEHOLDER_DENOMINATION_ID_BASE + index,
      publicCode: existing?.publicCode ?? null,
      reason: decision.reason ?? null,
      unit: item.unit,
    };
    if (decision.action === "create") {
      step.publicCode = formatGeneratedCode(DENOMINATION_CODE_PREFIX, nextId, "la denominación");
      nextId += 1;
    }
    steps.push(step);
  }
  return steps;
}

/**
 * Etiqueta visible de la unidad de un servicio del catálogo, para el informe: el texto comercial
 * o la composición de la abreviatura y la denominación.
 *
 * @param {object} entry - Servicio del catálogo.
 * @param {Map<string, object>} unitsByCode - Unidades base por código.
 * @returns {string} Etiqueta.
 */
function describeEntryUnit(entry, unitsByCode) {
  return formatUnitOptionLabel({ denomination: entry.denomination, presentationLabel: entry.presentationLabel, symbol: unitsByCode.get(entry.unit)?.symbol ?? entry.unit });
}

/**
 * Lee todos los servicios existentes, de cualquier estado, en su forma pública (con su unidad y
 * versión vigente). El catálogo es pequeño: una lectura por servicio basta.
 *
 * @returns {Promise<Array<object>>} Servicios.
 */
export async function readExistingServices() {
  const services = [];
  for (const id of await listAllServiceIds()) services.push(await findServiceById(id));
  return services;
}

/**
 * Prepara cada servicio del catálogo con su unidad resuelta y su estado esperado, y valida su
 * cuerpo de alta con serviceCreateSchema.
 *
 * @param {object} catalog - Catálogo validado.
 * @param {object} options - Datos resueltos.
 * @param {Map<string, object>} options.unitsByCode - Unidades base por código.
 * @param {(unit: string, denomination: string) => number} options.denominationId - Id real o provisional.
 * @param {string} options.changeNote - Nota de la versión 1.
 * @param {Array<string>} [blockers] - Bloqueos acumulados (se modifica si se indica).
 * @returns {Array<{ entry: object, body: object, expected: object }>} Servicios preparados.
 */
export function prepareCatalogServices(catalog, { changeNote, denominationId, unitsByCode }, blockers = []) {
  return catalog.services.map((entry) => {
    const unit = toCatalogServiceUnit(entry, { denominationId, unitsByCode });
    const body = toServiceCreateBody(entry, { changeNote, unit });
    const parsed = serviceCreateSchema.safeParse({ body });
    if (!parsed.success) blockers.push(...describeSchemaIssues(formatGeneratedServiceCode(entry.order), parsed.error));
    return { body, entry, expected: expectedServiceState(entry, unit) };
  });
}

/**
 * Crea la función que resuelve el id de una denominación del catálogo a partir de los pasos
 * planificados: el real si existe (o ya se creó) y, si no, el provisional del plan.
 *
 * @param {Array<object>} denominationSteps - Pasos de denominación.
 * @returns {(unit: string, denomination: string) => number} Resolución de ids.
 */
export function denominationResolver(denominationSteps) {
  const byKey = new Map(denominationSteps.map((step) => [step.key, step]));
  return (unit, denomination) => {
    const step = byKey.get(catalogDenominationKey(unit, denomination));
    return step.id ?? step.provisionalId;
  };
}

/**
 * Planifica la carga sin escribir ni consumir secuencias: identidad y estado de la base,
 * migración de unidades, unidades base, denominaciones, servicios existentes y códigos
 * previstos. `ready` es true solo sin bloqueos; `pendingWrites` cuenta las altas necesarias.
 *
 * @param {object} catalog - Catálogo validado (parseOfficialCatalog).
 * @param {object} options - Datos de la ejecución.
 * @param {string} options.runId - Identificador de la ejecución (para la nota de versión).
 * @returns {Promise<object>} Plan con destino, pasos, bloqueos y resumen.
 */
export async function planOfficialCatalogLoad(catalog, { runId }) {
  const blockers = [];
  const target = await readDatabaseIdentity();
  if (target.inRecovery) blockers.push("La base está en recuperación (solo lectura).");
  const migration = await readServiceUnitOptionsMigrationState();
  if (!migration.structureReady) blockers.push("Falta la estructura de unidades por servicio: aplica la migración 20261027120000_service_unit_options.");
  if (migration.migrationFinished === false) blockers.push("La migración 20261027120000_service_unit_options no figura como terminada en _prisma_migrations.");
  if (blockers.length) return { blockers, denominations: [], migration, pendingWrites: 0, ready: false, services: [], target };

  const { problems, unitsByCode } = await loadCatalogUnits(catalog);
  if (problems.length) return { blockers: problems, denominations: [], migration, pendingWrites: 0, ready: false, services: [], target };
  const denominations = await planCatalogDenominations(catalog, unitsByCode, blockers);
  const prepared = prepareCatalogServices(catalog, {
    changeNote: catalogVersionNote(catalog.changeNote, runId),
    denominationId: denominationResolver(denominations),
    unitsByCode,
  }, blockers);
  const nextServiceId = await readNextSerialId(SERVICE_TABLE, "id");
  const servicePlan = planServices({ entries: prepared, existingServices: await readExistingServices(), nextServiceId });
  blockers.push(...servicePlan.blockers);
  const services = servicePlan.services.map((step, index) => ({
    ...step,
    kind: prepared[index].entry.kind,
    referenceRate: prepared[index].entry.referenceRate,
    unitLabel: describeEntryUnit(prepared[index].entry, unitsByCode),
  }));
  const pendingWrites = denominations.filter((step) => step.action === "create").length
    + services.filter((step) => step.action === "create").length;
  return { blockers, denominations, migration, nextServiceId, pendingWrites, ready: blockers.length === 0, services, target };
}

/**
 * Registra en `audit_logs` un alta hecha por la carga, con la ejecución, el catálogo y su huella.
 * El origen (`user_agent`) identifica al comando de mantenimiento frente a la API.
 *
 * @param {object} options - Datos del registro.
 * @param {{ id: number }} options.user - Administrador responsable.
 * @param {string} options.action - Acción auditada.
 * @param {string} options.entityType - Tipo de entidad.
 * @param {number} options.entityId - Entidad creada.
 * @param {string} options.description - Descripción breve.
 * @param {object} options.values - Valores registrados (se añaden ejecución y catálogo).
 * @param {object} options.run - Ejecución: `runId`, `catalogId`, `catalogSha256` y, opcional,
 *   `auditSource` (comando de origen; por defecto la carga del catálogo).
 * @returns {Promise<void>}
 */
export async function auditCatalogWrite({ action, description, entityId, entityType, run, user, values }) {
  await insertAuditLog({
    action,
    description,
    entityId,
    entityType,
    newValues: { ...values, catalogId: run.catalogId, catalogSha256: run.catalogSha256, runId: run.runId },
    userAgent: run.auditSource ?? CATALOG_LOAD_AUDIT_SOURCE,
    userId: user.id,
  });
}

/**
 * Crea las denominaciones pendientes con measurementUnitService y las audita. Actualiza el id de
 * cada paso para que los servicios usen el real.
 *
 * @param {Array<object>} denominations - Pasos de denominación del plan (se modifican).
 * @param {object} context - Datos de la ejecución.
 * @param {Array<object>} context.completed - Altas hechas (se añade cada una).
 * @param {object} context.run - Ejecución: `runId`, `catalogId`, `catalogSha256`.
 * @param {Map<string, object>} context.unitsByCode - Unidades base por código.
 * @param {{ id: number }} context.user - Administrador responsable.
 * @returns {Promise<void>}
 */
async function createPendingDenominations(denominations, { completed, run, unitsByCode, user }) {
  for (const step of denominations.filter((item) => item.action === "create")) {
    const { body } = denominationCreateSchema.parse({ body: { denomination: step.denomination, measurementUnitId: unitsByCode.get(step.unit).id } });
    const created = await createDenomination({ payload: body, user });
    step.id = created.id;
    completed.push({ code: created.publicCode, id: created.id, label: created.label, type: "denomination" });
    await auditCatalogWrite({
      action: "service_catalog.official_load.denomination_created",
      description: `Carga del catálogo oficial: denominación ${created.publicCode}`,
      entityId: created.id,
      entityType: "measurement_unit_denomination",
      run,
      user,
      values: { label: created.label, publicCode: created.publicCode },
    });
  }
}

/**
 * Crea los servicios pendientes en orden con serviceCatalogService. Antes de cada alta comprueba
 * que la secuencia entregue su código y, después, que el código sea el esperado; si no, detiene
 * la carga para no crear servicios con códigos desplazados.
 *
 * @param {Array<object>} steps - Pasos de servicio del plan.
 * @param {Array<object>} prepared - Servicios preparados con ids reales.
 * @param {object} context - Datos de la ejecución.
 * @param {Array<object>} context.completed - Altas hechas (se añade cada una).
 * @param {object} context.run - Ejecución: `runId`, `catalogId`, `catalogSha256`.
 * @param {{ id: number }} context.user - Administrador responsable.
 * @returns {Promise<void>}
 * @throws {ConflictError} CATALOG_LOAD_SEQUENCE_CHANGED o CATALOG_LOAD_CODE_MISMATCH.
 */
export async function createPendingServices(steps, prepared, { completed, run, user }) {
  for (const [index, step] of steps.entries()) {
    if (step.action !== "create") continue;
    const nextServiceId = await readNextSerialId(SERVICE_TABLE, "id");
    if (nextServiceId !== step.order) {
      throw new ConflictError("CATALOG_LOAD_SEQUENCE_CHANGED", `La secuencia entregaría ${formatGeneratedServiceCode(nextServiceId)} en lugar de ${step.expectedCode}: otra escritura intervino. La carga se detuvo.`);
    }
    const { body } = serviceCreateSchema.parse({ body: prepared[index].body });
    const service = await createService({ payload: body, user });
    completed.push({ code: service.code, id: service.id, name: service.name, type: "service" });
    if (service.code !== step.expectedCode) {
      throw new ConflictError("CATALOG_LOAD_CODE_MISMATCH", `${step.name} se creó como ${service.code} en lugar de ${step.expectedCode}. La carga se detuvo.`);
    }
    await auditCatalogWrite({
      action: "service_catalog.official_load.service_created",
      description: `Carga del catálogo oficial: servicio ${service.code}`,
      entityId: service.id,
      entityType: "service",
      run,
      user,
      values: { code: service.code, currentVersion: service.currentVersion, name: service.name, order: step.order },
    });
  }
}

/**
 * Ejecuta la carga: toma el bloqueo, repite el plan y, sin bloqueos, crea las denominaciones y
 * los servicios pendientes a nombre del administrador, auditando cada alta, y verifica el
 * resultado. Ante un error, `error.catalogLoad.completed` enumera lo creado antes del fallo.
 *
 * @param {object} catalog - Catálogo validado.
 * @param {object} options - Datos de la ejecución.
 * @param {{ id: number }} options.user - Administrador autenticado.
 * @param {string} options.runId - Identificador de la ejecución.
 * @param {string} options.catalogSha256 - Huella SHA-256 del archivo aprobado.
 * @returns {Promise<{ plan: object, completed: Array<object>, verification: object }>} Resultado.
 * @throws {ConflictError} CATALOG_LOAD_IN_PROGRESS si otra carga tiene el bloqueo.
 * @throws {AppError} CATALOG_LOAD_BLOCKED si el plan tiene bloqueos (no escribe nada).
 */
export async function applyOfficialCatalogLoad(catalog, { catalogSha256, runId, user }) {
  const lock = await tryAcquireCatalogLoadLock();
  if (!lock) throw new ConflictError("CATALOG_LOAD_IN_PROGRESS", "Otra carga del catálogo está en curso.");
  const completed = [];
  try {
    const plan = await planOfficialCatalogLoad(catalog, { runId });
    if (!plan.ready) {
      const error = new AppError({ code: "CATALOG_LOAD_BLOCKED", message: "La carga tiene bloqueos y no se escribió nada.", status: 409 });
      error.catalogLoad = { completed, plan };
      throw error;
    }
    const run = { catalogId: catalog.catalogId, catalogSha256, runId };
    const { unitsByCode } = await loadCatalogUnits(catalog);
    await createPendingDenominations(plan.denominations, { completed, run, unitsByCode, user });
    const prepared = prepareCatalogServices(catalog, {
      changeNote: catalogVersionNote(catalog.changeNote, runId),
      denominationId: denominationResolver(plan.denominations),
      unitsByCode,
    });
    await createPendingServices(plan.services, prepared, { completed, run, user });
    return { completed, plan, verification: await verifyOfficialCatalog(catalog) };
  } catch (error) {
    error.catalogLoad ??= { completed };
    throw error;
  } finally {
    await lock.release();
  }
}

/**
 * Verifica en solo lectura que la base contiene el catálogo: denominaciones activas e idénticas,
 * cada servicio con su código, datos y unidad exactos, una sola unidad vigente, una versión
 * vigente que copia una sola unidad y ningún servicio ajeno al catálogo. `ok` es true solo sin
 * incidencias.
 *
 * @param {object} catalog - Catálogo validado.
 * @returns {Promise<{ ok: boolean, issues: Array<string>, notes: Array<string>, services: Array<object> }>} Verificación.
 */
export async function verifyOfficialCatalog(catalog) {
  const notes = [];
  const { problems: issues, unitsByCode } = await loadCatalogUnits(catalog);
  if (issues.length) return { issues, notes, ok: false, services: [] };
  const steps = [];
  for (const item of catalog.denominations) {
    const existing = await findEquivalentDenomination(unitsByCode.get(item.unit).id, item.denomination);
    const decision = planDenomination(item, existing);
    if (decision.action !== "reuse") issues.push(`Denominación «${item.unit} ${item.denomination}»: ${decision.reason ?? "no existe."}`);
    steps.push({ id: existing?.id ?? null, key: catalogDenominationKey(item.unit, item.denomination), provisionalId: 0 });
  }
  if (issues.length) return { issues, notes, ok: false, services: [] };

  const prepared = prepareCatalogServices(catalog, { changeNote: catalog.changeNote, denominationId: denominationResolver(steps), unitsByCode });
  const existing = await readExistingServices();
  const byCode = new Map(existing.map((service) => [service.code, service]));
  const versions = await summarizeServiceVersions(existing.map((service) => service.id));
  const services = prepared.map(({ entry, expected }) => {
    const code = formatGeneratedServiceCode(entry.order);
    const service = byCode.get(code);
    if (!service) {
      issues.push(`${code} «${entry.name}» no existe.`);
      return { code, name: entry.name, status: "missing" };
    }
    const differences = diffServiceFromCatalog(service, expected);
    if (differences.length) issues.push(`${code} difiere del catálogo en: ${differences.join(", ")}.`);
    const history = versions.get(service.id);
    if (!history?.currentVersion) issues.push(`${code} no tiene versión vigente.`);
    else if (history.currentVersionUnitCount !== 1) issues.push(`${code}: su versión vigente copia ${history.currentVersionUnitCount} unidades; debe copiar una.`);
    if (history && history.currentUnitCount !== 1) issues.push(`${code} tiene ${history.currentUnitCount} unidades vigentes; debe tener una.`);
    if (history?.currentVersion && history.currentVersion !== 1) notes.push(`${code} está en la versión ${history.currentVersion} (editado después de la carga).`);
    return { code, currentVersion: history?.currentVersion ?? null, differences, name: service.name, status: differences.length ? "different" : "ok", versionCount: history?.versionCount ?? 0 };
  });
  const expectedCodes = new Set(services.map((service) => service.code));
  for (const service of existing) {
    if (!expectedCodes.has(service.code)) issues.push(`${service.code} «${service.name}» no pertenece al catálogo.`);
  }
  return { issues, notes, ok: issues.length === 0, services };
}
