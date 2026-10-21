import { withTransaction } from "../config/db.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors/appError.js";
import {
  SERVICE_CURRENCY,
  isUnitCompatibleWithKind,
  listChangedServiceFields,
  mergeServiceChanges,
} from "../domain/serviceCatalog.js";
import { lockDenomination } from "../repositories/measurementUnitDenominationRepository.js";
import { findMeasurementUnitById } from "../repositories/measurementUnitRepository.js";
import {
  findServiceById,
  insertServiceRecord,
  insertServiceVersionSnapshot,
  listServices,
  lockServiceForUpdate,
  retireCurrentServiceVersion,
  updateServiceRecord,
} from "../repositories/serviceCatalogRepository.js";
import { decodeCursor, pageResult, parsePageLimit } from "../utils/pagination.js";
import {
  SERVICE_VERSION_CONFLICT_MESSAGE,
  missingServiceVersionError,
  translateServiceCatalogError,
} from "./serviceCatalogErrors.js";

const SERVICE_NOT_FOUND_MESSAGE = "El servicio seleccionado no existe.";

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
 * Comprueba en la transacción que una unidad pueda usarse con el tipo de servicio y la bloquea
 * con FOR SHARE hasta el COMMIT. Exige que esté activa al asignarla o al reactivar el servicio;
 * un cambio de tipo con la misma unidad solo verifica la compatibilidad.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {object} options - Datos de la asignación.
 * @param {number} options.measurementUnitId - Unidad elegida.
 * @param {string} options.kind - Tipo de servicio.
 * @param {boolean} options.requireActive - Exige que la unidad esté activa.
 * @returns {Promise<void>}
 * @throws {ValidationError} Si la unidad no existe, está inactiva o es incompatible con el tipo.
 */


async function assertAssignableUnit(client, { kind, measurementUnitId, requireActive }) {
  const unit = await findMeasurementUnitById(measurementUnitId, { executor: client, lockForShare: true });
  if (!unit) throw new ValidationError(undefined, { measurementUnitId: "La unidad de medida no existe." });
  if (requireActive && !unit.isActive) {
    throw new ValidationError(undefined, { measurementUnitId: "La unidad de medida está inactiva." });
  }
  if (!isUnitCompatibleWithKind(kind, unit)) {
    throw new ValidationError(undefined, {
      measurementUnitId: "Las modalidades llave en mano requieren una unidad de superficie en metros cuadrados.",
    });
  }
}

/**
 * Comprueba que una denominación exista, esté activa y sea de la unidad base del servicio, y
 * la bloquea con FOR SHARE hasta el COMMIT para que nadie la desactive o edite mientras se
 * asigna. La compatibilidad con el tipo de servicio la decide la unidad base.
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
 * Valida unidad y denominación cuando cambian, cuando cambia el tipo o al reactivar el servicio
 * (pudieron desactivarse mientras estuvo inactivo), bloqueándolas con FOR SHARE hasta el COMMIT.
 * Cambiar la base conservando la denominación anterior se rechaza: pertenece a la otra base.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {object} options - Datos de la edición.
 * @param {Array<string>} options.changedFields - Campos con cambio efectivo.
 * @param {object} options.next - Estado resultante (mergeServiceChanges).
 * @param {object} options.payload - Cuerpo validado de la edición.
 * @returns {Promise<void>}
 * @throws {ValidationError} Si la unidad o la denominación no son válidas para el estado resultante.
 */
async function assertServiceUnitChanges(client, { changedFields, next, payload }) {
  const unitChanged = changedFields.includes("measurementUnitId");
  const denominationChanged = changedFields.includes("unitDenominationId");
  // Reactivar revalida aunque los ids no cambien. Si una desactivación de la denominación toma su
  // bloqueo antes, la lectura posterior a FOR SHARE ya la ve inactiva y se rechaza; si la
  // reactivación lo toma antes, la desactivación cuenta después este servicio activo (IN_USE).
  const reactivating = changedFields.includes("isActive") && next.isActive;
  if (unitChanged && payload.unitDenominationId === undefined && next.unitDenominationId !== null) {
    throw new ValidationError(undefined, {
      unitDenominationId: "La denominación actual pertenece a otra unidad. Indica una denominación de la nueva unidad o null.",
    });
  }
  if (unitChanged || reactivating || changedFields.includes("kind")) {
    await assertAssignableUnit(client, {
      kind: next.kind,
      measurementUnitId: next.measurementUnitId,
      requireActive: unitChanged || reactivating,
    });
  }
  if ((unitChanged || denominationChanged || reactivating) && next.unitDenominationId !== null) {
    await assertAssignableDenomination(client, { measurementUnitId: next.measurementUnitId, unitDenominationId: next.unitDenominationId });
  }
}

/**
 * Crea un servicio y su versión 1 en una única transacción: si falla cualquiera de las dos
 * escrituras no queda ningún registro. La unicidad del código la garantiza PostgreSQL
 * (uq_services_code), lo que también cubre dos altas simultáneas.
 *
 * @param {object} options - Datos de la operación.
 * @param {object} options.payload - Cuerpo validado por serviceCreateSchema.
 * @param {{ id: number }} options.user - Administrador autenticado.
 * @returns {Promise<object>} Servicio creado con currentVersion = 1.
 * @throws {ValidationError} Si la unidad no es válida para el servicio.
 * @throws {ConflictError} SERVICE_CODE_ALREADY_EXISTS si el código ya existe.
 */
export async function createService({ payload, user }) {
  try {
    return await withTransaction(async (client) => {
      await assertAssignableUnit(client, { kind: payload.kind, measurementUnitId: payload.measurementUnitId, requireActive: true });
      if (payload.unitDenominationId) {
        await assertAssignableDenomination(client, { measurementUnitId: payload.measurementUnitId, unitDenominationId: payload.unitDenominationId });
      }
      const serviceId = await insertServiceRecord(client, {
        ...payload,
        currency: SERVICE_CURRENCY,
        description: payload.description ?? null,
        userId: user.id,
      });
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
 * @throws {ConflictError} SERVICE_VERSION_CONFLICT si otra edición se confirmó antes.
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

      await assertServiceUnitChanges(client, { changedFields, next, payload });
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
