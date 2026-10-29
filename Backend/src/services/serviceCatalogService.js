import { withTransaction } from "../config/db.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors/appError.js";
import {
  DEFAULT_SERVICE_KIND,
  SERVICE_CURRENCY,
  formatGeneratedServiceCode,
  listChangedServiceFields,
  mergeServiceChanges,
} from "../domain/serviceCatalog.js";
import { normalizePresentationLabel } from "../domain/serviceUnitOptions.js";
import { lockDenomination } from "../repositories/measurementUnitDenominationRepository.js";
import { findMeasurementUnitById } from "../repositories/measurementUnitRepository.js";
import { serviceHasQuoteReferences } from "../repositories/quoteRepository.js";
import {
  findServiceById,
  insertServiceRecord,
  insertServiceVersionSnapshot,
  listServices,
  lockServiceForUpdate,
  replaceServiceUnitOption,
  reserveServiceId,
  retireCurrentServiceVersion,
  serviceCodeExists,
  updateServiceRecord,
} from "../repositories/serviceCatalogRepository.js";
import { decodeCursor, pageResult, parsePageLimit } from "../utils/pagination.js";
import {
  SERVICE_VERSION_CONFLICT_MESSAGE,
  missingServiceVersionError,
  translateServiceCatalogError,
} from "./serviceCatalogErrors.js";

const SERVICE_NOT_FOUND_MESSAGE = "El servicio seleccionado no existe.";
const SERVICE_MODALITY_IN_USE_MESSAGE = "La modalidad no se puede modificar porque este servicio ya está incluido en una cotización.";

/**
 * Obtiene una página del catálogo con filtros y paginación por cursor (sort_order, id).
 * Incluye servicios inactivos salvo que se filtre por estado, porque el catálogo
 * administrativo también los consulta. No usa caché: los datos cambian por edición directa.
 *
 * @param {object} [filters] - Consulta validada por serviceListSchema.
 * @returns {Promise<{ services: Array<object>, nextCursor: string|null }>} Página del catálogo.
 */
export async function getServicesPage(filters = {}) {
  const limit = parsePageLimit(filters.limit);
  const rows = await listServices({
    cursor: decodeCursor(filters.cursor),
    isActive: filters.status ? filters.status === "active" : undefined,
    kind: filters.kind,
    limit,
    measurementUnitId: filters.measurementUnitId,
    search: filters.search,
    unitDenominationId: filters.unitDenominationId,
  });
  const page = pageResult(rows, limit, (service) => service, (service) => [service.sortOrder, String(service.id)]);
  return { nextCursor: page.nextCursor, services: page.items };
}

/**
 * Obtiene un servicio del catálogo, activo o inactivo, con su unidad y versión vigente.
 *
 * @param {number} serviceId - Identificador validado.
 * @returns {Promise<object>} Servicio.
 * @throws {NotFoundError} SERVICE_NOT_FOUND si no existe.
 */
export async function getService(serviceId) {
  const service = await findServiceById(serviceId);
  if (!service) throw new NotFoundError("SERVICE_NOT_FOUND", SERVICE_NOT_FOUND_MESSAGE);
  return service;
}

/**
 * Comprueba en la transacción que una unidad exista y esté activa al asignarla o al reactivar el
 * servicio, y la bloquea con FOR SHARE hasta el COMMIT. Cualquier modalidad admite cualquier
 * unidad base registrada y activa: la modalidad no interviene.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {number} measurementUnitId - Unidad elegida.
 * @returns {Promise<void>}
 * @throws {ValidationError} Si la unidad no existe o está inactiva.
 */
async function assertAssignableUnit(client, measurementUnitId) {
  const unit = await findMeasurementUnitById(measurementUnitId, { executor: client, lockForShare: true });
  if (!unit) throw new ValidationError(undefined, { measurementUnitId: "La unidad de medida no existe." });
  if (!unit.isActive) {
    throw new ValidationError(undefined, { measurementUnitId: "La unidad de medida está inactiva." });
  }
}

/**
 * Comprueba que una denominación exista, esté activa y sea de la unidad base del servicio, y
 * la bloquea con FOR SHARE hasta el COMMIT para que nadie la desactive o edite mientras se
 * asigna.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {object} options - Datos de la asignación.
 * @param {number} options.measurementUnitId - Unidad base del servicio.
 * @param {number} options.unitDenominationId - Denominación elegida.
 * @returns {Promise<void>}
 * @throws {ValidationError} Si la denominación no existe, está inactiva o es de otra unidad base.
 */
async function assertAssignableDenomination(client, { measurementUnitId, unitDenominationId }) {
  const denomination = await lockDenomination(client, unitDenominationId, "share");
  if (!denomination) throw new ValidationError(undefined, { unitDenominationId: "La denominación no existe." });
  if (denomination.measurementUnit.id !== measurementUnitId) {
    throw new ValidationError(undefined, { unitDenominationId: "La denominación no pertenece a la unidad de medida seleccionada." });
  }
  if (!denomination.isActive) {
    throw new ValidationError(undefined, { unitDenominationId: "La denominación está inactiva." });
  }
}

/**
 * Valida y bloquea FOR SHARE hasta el COMMIT la unidad del servicio y su denominación opcional.
 * Si la desactivación de la denominación toma su bloqueo antes, esta la ve inactiva y la rechaza;
 * si no, la desactivación cuenta después este servicio activo (IN_USE).
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {{ measurementUnitId: number, unitDenominationId: number|null }} unit - Unidad resultante.
 * @returns {Promise<void>}
 * @throws {ValidationError} Si la unidad o la denominación no pueden asignarse.
 */
async function assertAssignableServiceUnit(client, { measurementUnitId, unitDenominationId }) {
  await assertAssignableUnit(client, measurementUnitId);
  if (unitDenominationId !== null && unitDenominationId !== undefined) {
    await assertAssignableDenomination(client, { measurementUnitId, unitDenominationId });
  }
}

/**
 * Valida la unidad de una edición: cambiar la base conservando la denominación anterior se rechaza.
 * Solo se revalida si cambia la unidad o se reactiva el servicio; cambiar otros campos (también la
 * modalidad, que no restringe la unidad) conserva una unidad histórica inactiva.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {object} options - Datos de la edición.
 * @param {object} options.current - Servicio vigente.
 * @param {Array<string>} options.changedFields - Campos con cambio efectivo.
 * @param {object} options.next - Estado resultante (mergeServiceChanges).
 * @param {object} options.payload - Cuerpo validado de la edición.
 * @returns {Promise<void>}
 * @throws {ValidationError} Si la unidad no es válida para el estado resultante.
 */
async function assertServiceUnitChanges(client, { changedFields, current, next, payload }) {
  const reactivating = changedFields.includes("isActive") && next.isActive;
  if (payload.measurementUnitId !== undefined && payload.measurementUnitId !== current.measurementUnit.id
    && payload.unitDenominationId === undefined && current.unitDenomination) {
    throw new ValidationError(undefined, {
      unitDenominationId: "La denominación actual pertenece a otra unidad. Indica una denominación de la nueva unidad o null.",
    });
  }
  const unitChanged = changedFields.includes("measurementUnitId") || changedFields.includes("unitDenominationId");
  if (!unitChanged && !reactivating) return;
  await assertAssignableServiceUnit(client, next);
}

/**
 * Unidad que se guarda en service_unit_options para un servicio: su base, denominación, texto
 * comercial y la tarifa del servicio (una sola unidad, siempre con tarifa confirmada).
 *
 * @param {{ measurementUnitId: number, unitDenominationId?: number|null, presentationLabel?: string|null,
 *   referenceRate: string }} state - Estado del servicio (alta validada o mergeServiceChanges).
 * @returns {{ measurementUnitId: number, unitDenominationId: number|null, presentationLabel: string|null,
 *   referenceRate: string }} Unidad del servicio.
 */
function toServiceUnitOption(state) {
  return {
    measurementUnitId: state.measurementUnitId,
    presentationLabel: normalizePresentationLabel(state.presentationLabel),
    referenceRate: state.referenceRate,
    unitDenominationId: state.unitDenominationId ?? null,
  };
}

// Reservas de id permitidas cuando el código generado coincide con uno heredado escrito a mano.
const MAX_CODE_RESERVATION_ATTEMPTS = 5;

/**
 * Reserva el id del servicio nuevo con la secuencia de `services.id` y compone `SERV-001`, sin
 * contar registros ni usar MAX(id)+1: cada reserva es única y nunca se reutiliza. Si el código
 * coincide con uno heredado (escrito cuando la API aceptaba códigos), reserva el siguiente id.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @returns {Promise<{ id: number, code: string }>} Id reservado y código generado.
 * @throws {ConflictError} SERVICE_CODE_ALREADY_EXISTS si no encuentra un código libre.
 */
async function reserveGeneratedServiceCode(client) {
  for (let attempt = 0; attempt < MAX_CODE_RESERVATION_ATTEMPTS; attempt += 1) {
    const id = await reserveServiceId(client);
    const code = formatGeneratedServiceCode(id);
    if (!(await serviceCodeExists(client, code))) return { code, id };
  }
  throw new ConflictError("SERVICE_CODE_ALREADY_EXISTS", "No se pudo generar un código de servicio disponible. Inténtalo de nuevo.");
}

/**
 * Crea un servicio, su única unidad y su versión 1 en una única transacción: si falla cualquier
 * escritura no queda ningún registro. El código `SERV-001` lo genera siempre el sistema a
 * partir del id reservado (el cuerpo validado no admite código) y la unicidad la garantiza
 * además PostgreSQL (uq_services_code). La modalidad (`kind`) la elige el administrador y
 * admite cualquier unidad base activa (con o sin denominación activa de esa base). Todas las
 * validaciones se hacen antes de reservar el id, para no consumir códigos en un alta inválida.
 *
 * @param {object} options - Datos de la operación.
 * @param {object} options.payload - Cuerpo validado por serviceCreateSchema (`kind` ya resuelto;
 *   `individual` si se omite).
 * @param {{ id: number }} options.user - Administrador autenticado.
 * @returns {Promise<object>} Servicio creado con currentVersion = 1.
 * @throws {ValidationError} Si alguna unidad o denominación no existe, está inactiva o no corresponde.
 * @throws {ConflictError} SERVICE_CODE_ALREADY_EXISTS si no hay código libre.
 */
export async function createService({ payload, user }) {
  const kind = payload.kind ?? DEFAULT_SERVICE_KIND;
  const unit = toServiceUnitOption(payload);
  try {
    return await withTransaction(async (client) => {
      await assertAssignableServiceUnit(client, unit);
      const { code, id } = await reserveGeneratedServiceCode(client);
      const serviceId = await insertServiceRecord(client, {
        ...payload,
        code,
        kind,
        currency: SERVICE_CURRENCY,
        id,
        description: payload.description ?? null,
        unitDenominationId: unit.unitDenominationId,
        userId: user.id,
      });
      // El trigger de alta registra la unidad sin texto comercial; se sustituye por la completa.
      await replaceServiceUnitOption(client, serviceId, unit);
      await insertServiceVersionSnapshot(client, { changeNote: payload.changeNote, serviceId, userId: user.id, versionNumber: 1 });
      return findServiceById(serviceId, client);
    });
  } catch (error) {
    throw translateServiceCatalogError(error);
  }
}

/**
 * Edita un servicio y registra una versión nueva solo si cambia algún campo versionado.
 * Bloquea el servicio, exige que `expectedVersion` sea la vigente (control optimista entre
 * administradores), retira la versión anterior, actualiza y copia el estado nuevo en la
 * misma transacción. Cubre también tarifas y estado: no existe otra ruta de versionado.
 *
 * @param {object} options - Datos de la operación.
 * @param {number} options.serviceId - Servicio a editar.
 * @param {object} options.payload - Cuerpo validado (serviceUpdateSchema o serviceStatusSchema).
 * @param {{ id: number }} options.user - Administrador autenticado.
 * @returns {Promise<{ service: object, changed: boolean, changedFields: Array<string> }>} Resultado;
 *   `changed` es false cuando no había cambios efectivos y no se creó versión.
 * @throws {NotFoundError} SERVICE_NOT_FOUND si el servicio no existe.
 * @throws {ConflictError} SERVICE_VERSION_CONFLICT si otra edición se confirmó antes;
 *   SERVICE_MODALITY_IN_USE si cambia `kind` y el servicio está incluido en alguna cotización.
 * @throws {ValidationError} Si la unidad no es válida para el estado resultante.
 */
export async function updateService({ payload, serviceId, user }) {
  try {
    return await withTransaction(async (client) => {
      const current = await lockServiceForUpdate(client, serviceId);
      if (!current) throw new NotFoundError("SERVICE_NOT_FOUND", SERVICE_NOT_FOUND_MESSAGE);
      if (current.currentVersion === null) throw missingServiceVersionError();
      if (current.currentVersion !== payload.expectedVersion) {
        throw new ConflictError("SERVICE_VERSION_CONFLICT", SERVICE_VERSION_CONFLICT_MESSAGE);
      }

      const next = mergeServiceChanges(current, payload);
      const changedFields = listChangedServiceFields(current, next);
      if (changedFields.length === 0) return { changed: false, changedFields, service: current };
      // Con el servicio bloqueado FOR UPDATE, un concepto confirmado por otra transacción ya es visible.
      if (changedFields.includes("kind") && await serviceHasQuoteReferences(client, serviceId)) {
        throw new ConflictError("SERVICE_MODALITY_IN_USE", SERVICE_MODALITY_IN_USE_MESSAGE);
      }

      await assertServiceUnitChanges(client, { changedFields, current, next, payload });
      // La unidad primero, en cada versión nueva: así la sincronización del trigger al actualizar
      // el servicio ya no cambia nada, y un servicio anterior a la unidad única pierde sus
      // alternativas vigentes (su versión anterior las conserva como historial).
      await replaceServiceUnitOption(client, serviceId, toServiceUnitOption(next));
      await updateServiceRecord(client, serviceId, next, user.id);
      await retireCurrentServiceVersion(client, serviceId);
      await insertServiceVersionSnapshot(client, {
        changeNote: payload.changeNote ?? null,
        serviceId,
        userId: user.id,
        versionNumber: current.currentVersion + 1,
      });
      return { changed: true, changedFields, service: await findServiceById(serviceId, client) };
    });
  } catch (error) {
    throw translateServiceCatalogError(error);
  }
}

/**
 * Activa o desactiva un servicio reutilizando la edición versionada. Un servicio inactivo
 * sigue disponible para consultas e historial; impedir su uso en cotizaciones nuevas es
 * responsabilidad del futuro servicio de cotizaciones.
 *
 * @param {object} options - Datos de la operación.
 * @param {number} options.serviceId - Servicio a modificar.
 * @param {{ isActive: boolean, expectedVersion: number, changeNote: string|null }} options.payload - Cuerpo validado.
 * @param {{ id: number }} options.user - Administrador autenticado.
 * @returns {Promise<{ service: object, changed: boolean, changedFields: Array<string> }>} Resultado de la edición.
 */
export function changeServiceStatus({ payload, serviceId, user }) {
  return updateService({ payload, serviceId, user });
}
