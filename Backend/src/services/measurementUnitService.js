import { withTransaction } from "../config/db.js";
import { AppError, NotFoundError, ValidationError } from "../errors/appError.js";
import {
  findDenominationById,
  insertDenomination,
  listDenominations,
  lockDenomination,
  updateDenominationRecord,
} from "../repositories/measurementUnitDenominationRepository.js";
import { findMeasurementUnitById, listMeasurementUnits } from "../repositories/measurementUnitRepository.js";
import { decodeCursor, pageResult, parsePageLimit } from "../utils/pagination.js";
import { translateMeasurementUnitError } from "./measurementUnitErrors.js";

/*
 * Unidades de medida (arquitectura B2): las unidades base son de solo lectura en la API y
 * concentran las reglas (decimales, compatibilidad); las denominaciones personalizadas se
 * crean, editan y desactivan aquí. Una denominación usada por servicios activos no se edita
 * ni se desactiva: se crea otra y se reasignan los servicios.
 */

const DENOMINATION_NOT_FOUND_MESSAGE = "La denominación seleccionada no existe.";

/**
 * Lista las unidades base del catálogo para el Dropdown de formularios.
 * Por defecto solo las activas; las inactivas se consultan de forma explícita.
 *
 * @param {{ includeInactive?: boolean }} [filters] - Consulta validada.
 * @returns {Promise<{ measurementUnits: Array<object> }>} Unidades base ordenadas.
 */
export async function getMeasurementUnits(filters = {}) {
  return { measurementUnits: await listMeasurementUnits({ includeInactive: filters.includeInactive === true }) };
}

/**
 * Obtiene una página de denominaciones con filtros y paginación por cursor.
 * El cursor combina el orden de la unidad base, el texto y el id para un orden estable.
 *
 * @param {object} [filters] - Consulta validada por denominationListSchema.
 * @returns {Promise<{ unitDenominations: Array<object>, nextCursor: string|null }>} Página.
 */
export async function getDenominationsPage(filters = {}) {
  const limit = parsePageLimit(filters.limit);
  const rows = await listDenominations({
    cursor: decodeCursor(filters.cursor, 3),
    isActive: filters.status ? filters.status === "active" : undefined,
    limit,
    measurementUnitId: filters.measurementUnitId,
    search: filters.search,
  });
  const page = pageResult(rows, limit, (item) => item, (item) => [item.measurementUnit.sortOrder, item.denomination, String(item.id)]);
  return { nextCursor: page.nextCursor, unitDenominations: page.items };
}

/**
 * Obtiene una denominación con su unidad base, etiqueta y uso por servicios activos.
 *
 * @param {number} denominationId - Identificador validado.
 * @returns {Promise<object>} Denominación.
 * @throws {NotFoundError} MEASUREMENT_UNIT_DENOMINATION_NOT_FOUND si no existe.
 */
export async function getDenomination(denominationId) {
  const denomination = await findDenominationById(denominationId);
  if (!denomination) throw new NotFoundError("MEASUREMENT_UNIT_DENOMINATION_NOT_FOUND", DENOMINATION_NOT_FOUND_MESSAGE);
  return denomination;
}

/**
 * Comprueba en la transacción que la unidad base exista y esté activa, y la bloquea con
 * FOR SHARE para que no se desactive antes del COMMIT.
 *
 * @param {{ query: Function }} client - Cliente de la transacción en curso.
 * @param {number} measurementUnitId - Unidad base.
 * @returns {Promise<void>}
 * @throws {ValidationError} Si la unidad base no existe o está inactiva.
 */
async function assertActiveBaseUnit(client, measurementUnitId) {
  const unit = await findMeasurementUnitById(measurementUnitId, { executor: client, lockForShare: true });
  if (!unit) throw new ValidationError(undefined, { measurementUnitId: "La unidad de medida no existe." });
  if (!unit.isActive) throw new ValidationError(undefined, { measurementUnitId: "La unidad de medida está inactiva." });
}

/**
 * Crea el error para una denominación que no puede cambiar porque la usan servicios activos.
 * El mensaje indica la alternativa: crear otra denominación y reasignar esos servicios.
 *
 * @param {number} activeServiceCount - Servicios activos que la utilizan.
 * @returns {AppError} Error 409 MEASUREMENT_UNIT_IN_USE.
 */
function denominationInUseError(activeServiceCount) {
  return new AppError({
    code: "MEASUREMENT_UNIT_IN_USE",
    message: `La denominación está asignada a ${activeServiceCount} servicio(s) activo(s). Crea otra denominación y reasigna esos servicios.`,
    status: 409,
  });
}

/**
 * Crea una denominación activa para una unidad base activa. La unicidad de denominaciones
 * equivalentes (mayúsculas, espacios, NFKC) la garantiza PostgreSQL, lo que también cubre
 * dos altas simultáneas.
 *
 * @param {object} options - Datos de la operación.
 * @param {{ measurementUnitId: number, denomination: string }} options.payload - Cuerpo validado.
 * @param {{ id: number }} options.user - Administrador autenticado.
 * @returns {Promise<object>} Denominación creada.
 * @throws {ValidationError} Si la unidad base no existe o está inactiva.
 * @throws {ConflictError} MEASUREMENT_UNIT_DENOMINATION_ALREADY_EXISTS si ya existe una equivalente.
 */
export async function createDenomination({ payload, user }) {
  try {
    return await withTransaction(async (client) => {
      await assertActiveBaseUnit(client, payload.measurementUnitId);
      const id = await insertDenomination(client, { ...payload, userId: user.id });
      return findDenominationById(id, client);
    });
  } catch (error) {
    throw translateMeasurementUnitError(error);
  }
}

/**
 * Aplica un cambio de texto o de estado a una denominación con bloqueo FOR UPDATE.
 * El uso por servicios activos se cuenta después del bloqueo (instantánea nueva en READ
 * COMMITTED), de modo que una asignación concurrente ya confirmada siempre se detecta.
 *
 * @param {object} options - Datos de la operación.
 * @param {number} options.denominationId - Denominación a modificar.
 * @param {{ denomination?: string, isActive?: boolean }} options.changes - Campos validados.
 * @param {{ id: number }} options.user - Administrador autenticado.
 * @returns {Promise<{ unitDenomination: object, changed: boolean }>} Resultado; `changed` es false sin cambios.
 * @throws {NotFoundError} MEASUREMENT_UNIT_DENOMINATION_NOT_FOUND si no existe.
 * @throws {AppError} MEASUREMENT_UNIT_IN_USE si la usan servicios activos.
 * @throws {ValidationError} Si se activa con la unidad base inactiva.
 */
async function changeDenomination({ changes, denominationId, user }) {
  try {
    return await withTransaction(async (client) => {
      const current = await lockDenomination(client, denominationId, "update");
      if (!current) throw new NotFoundError("MEASUREMENT_UNIT_DENOMINATION_NOT_FOUND", DENOMINATION_NOT_FOUND_MESSAGE);
      const next = {
        denomination: changes.denomination ?? current.denomination,
        isActive: changes.isActive ?? current.isActive,
      };
      const textChanged = next.denomination !== current.denomination;
      const deactivating = current.isActive && !next.isActive;
      if (!textChanged && next.isActive === current.isActive) return { changed: false, unitDenomination: current };

      // Editar el texto o desactivar alteraría servicios activos; reactivar no.
      if ((textChanged || deactivating) && current.activeServiceCount > 0) throw denominationInUseError(current.activeServiceCount);
      if (!current.isActive && next.isActive) await assertActiveBaseUnit(client, current.measurementUnit.id);

      await updateDenominationRecord(client, denominationId, next, user.id);
      return { changed: true, unitDenomination: await findDenominationById(denominationId, client) };
    });
  } catch (error) {
    throw translateMeasurementUnitError(error);
  }
}

/**
 * Edita el texto de una denominación. No cambia su unidad base (no es un campo editable y
 * PostgreSQL lo impide); si la usan servicios activos responde 409 MEASUREMENT_UNIT_IN_USE.
 *
 * @param {object} options - Datos de la operación.
 * @param {number} options.denominationId - Denominación a editar.
 * @param {{ denomination: string }} options.payload - Cuerpo validado.
 * @param {{ id: number }} options.user - Administrador autenticado.
 * @returns {Promise<{ unitDenomination: object, changed: boolean }>} Resultado de la edición.
 */
export function updateDenomination({ denominationId, payload, user }) {
  return changeDenomination({ changes: { denomination: payload.denomination }, denominationId, user });
}

/**
 * Activa o desactiva una denominación sin eliminarla. Desactivar una denominación usada por
 * servicios activos responde 409; activarla exige que su unidad base esté activa.
 *
 * @param {object} options - Datos de la operación.
 * @param {number} options.denominationId - Denominación a modificar.
 * @param {{ isActive: boolean }} options.payload - Cuerpo validado.
 * @param {{ id: number }} options.user - Administrador autenticado.
 * @returns {Promise<{ unitDenomination: object, changed: boolean }>} Resultado del cambio.
 */
export function changeDenominationStatus({ denominationId, payload, user }) {
  return changeDenomination({ changes: { isActive: payload.isActive }, denominationId, user });
}
