import { runWithConcurrency, SERVICE_BULK_STATUS_CONCURRENCY } from "./serviceBulkStatus.js";

export const SERVICE_SELECTION_CHANGED_MESSAGE = "Los servicios seleccionados cambiaron desde que se cargó la tabla. Actualiza la selección y vuelve a intentarlo. No se enviaron cambios.";

/**
 * Señala que el borrador de la operación dejó de representar los servicios vigentes.
 * El código permite reutilizar la traducción de errores tanto individual como masiva.
 * @returns {Error} Error local sin escrituras, con el contrato normalizado de la API.
 */
function selectionChangedError() {
  return Object.assign(new Error(SERVICE_SELECTION_CHANGED_MESSAGE), { code: "SERVICE_SELECTION_CHANGED", status: 409 });
}

/**
 * Relee todos los servicios antes de cualquier PATCH, sin caché, y verifica estado y versión
 * contra la selección confirmada. Un cambio, una lectura fallida o una referencia inactiva al
 * reactivar cancela el conjunto; nunca convierte una selección mixta en un subconjunto elegible.
 * @param {Array<Object>} services - Instantáneas elegidas al abrir la confirmación.
 * @param {boolean} isActive - Estado de destino.
 * @param {(options: {serviceId: number, signal?: AbortSignal}) => Promise<{service: Object}>} readService - Lectura individual existente.
 * @param {AbortSignal} [signal] - Cancela las lecturas al desmontar el panel.
 * @returns {Promise<void>} Resuelve solo si toda la selección sigue vigente y es elegible.
 * @throws {Error} Selección desactualizada, fallo HTTP o referencia inactiva; no hubo escrituras.
 */
export async function verifyServiceStatusSelection(services, isActive, readService, signal) {
  if (!services.length || services.some((service) => service.isActive !== !isActive
    || !Number.isInteger(service.currentVersion) || service.currentVersion < 1)) throw selectionChangedError();

  const results = await runWithConcurrency(services, SERVICE_BULK_STATUS_CONCURRENCY,
    (service) => readService({ serviceId: service.id, signal }));
  signal?.throwIfAborted();
  const failedRead = results.find((result) => !result.ok);
  if (failedRead) throw failedRead.error;

  // Se comprueban primero TODOS los estados/versiones antes de evaluar restricciones de unidad.
  if (results.some(({ item, value }) => !value?.service
    || value.service.id !== item.id || value.service.isActive !== item.isActive
    || value.service.currentVersion !== item.currentVersion)) throw selectionChangedError();

  if (!isActive) return;
  for (const { value: { service } } of results) {
    const field = service.measurementUnit?.isActive !== true ? "measurementUnitId"
      : service.unitDenomination && service.unitDenomination.isActive !== true ? "unitDenominationId" : null;
    if (field) {
      throw Object.assign(new Error("La unidad del servicio está inactiva."), {
        code: "VALIDATION_ERROR", status: 400, fields: { [field]: "La unidad está inactiva." }, serviceCode: service.code,
      });
    }
  }
}

/**
 * Comprueba la selección completa antes de escribir y ejecuta los PATCH con concurrencia limitada.
 * Ante un fallo detiene los envíos pendientes; los que ya estaban en curso se esperan y se
 * informan individualmente. El endpoint individual no permite prometer atomicidad ni rollback.
 * @param {Object} options - Servicios, destino y operaciones HTTP existentes.
 * @param {Array<Object>} options.services - Instantáneas de la selección homogénea.
 * @param {boolean} options.isActive - Estado solicitado.
 * @param {Function} options.readService - GET individual, sin caché.
 * @param {Function} options.changeStatus - PATCH individual con expectedVersion.
 * @param {AbortSignal} [options.signal] - Cancela comprobaciones y nuevos envíos al desmontar.
 * @returns {Promise<Array<Object>>} Resultados por servicio, incluidos los cancelados sin envío.
 * @throws {Error} Fallo de la comprobación previa; no se envió ningún PATCH.
 */
export async function executeServiceStatusChanges({ services, isActive, readService, changeStatus, signal }) {
  await verifyServiceStatusSelection(services, isActive, readService, signal);
  const skipped = Symbol("cancelled-before-send");
  let stopped = false;
  const results = await runWithConcurrency(services, SERVICE_BULK_STATUS_CONCURRENCY, async (service) => {
    if (stopped || signal?.aborted) return skipped;
    try {
      return await changeStatus({ serviceId: service.id, expectedVersion: service.currentVersion, isActive });
    } catch (error) {
      stopped = true;
      throw error;
    }
  });
  return results.map((result) => (result.ok && result.value === skipped
    ? { item: result.item, ok: false, skipped: true } : result));
}
