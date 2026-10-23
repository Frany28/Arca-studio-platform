// Activación y desactivación de varios servicios seleccionados. El backend no ofrece una operación
// masiva: cada servicio se cambia con su PATCH /admin/services/:id/status y su `expectedVersion`,
// así que el conjunto NO es atómico (unos pueden aplicarse y otros fallar).

// Peticiones simultáneas como máximo: acota la carga y el límite de escrituras por administrador.
export const SERVICE_BULK_STATUS_CONCURRENCY = 3;
// Fallos detallados en el aviso; el resto se resume con su número.
const MAX_DETAILED_FAILURES = 3;

/**
 * Servicios seleccionados de la página visible que realmente cambiarían al estado pedido: los que
 * ya están en ese estado se excluyen para no enviar cambios sin efecto. Una selección mixta
 * devuelve solo los que corresponden a la acción.
 *
 * @param {Array<{id: number, isActive: boolean}>} items - Filas visibles.
 * @param {Set<string>} selectedIds - Ids seleccionados (texto, como usePageSelection).
 * @param {boolean} isActive - Estado pedido.
 * @returns {Array<Object>} Servicios afectados, en el orden de la tabla.
 */
export function getServiceStatusTargets(items, selectedIds, isActive) {
  return (items || []).filter((item) => selectedIds.has(String(item.id)) && Boolean(item.isActive) !== isActive);
}

/**
 * Ejecuta una tarea por elemento con un máximo de tareas simultáneas y nunca rechaza: devuelve el
 * resultado de cada elemento (en el orden recibido) para tratar los fallos uno a uno.
 *
 * @template T, R
 * @param {Array<T>} items - Elementos a procesar.
 * @param {number} limit - Tareas simultáneas como máximo (≥ 1).
 * @param {(item: T) => Promise<R>} worker - Tarea por elemento.
 * @returns {Promise<Array<{item: T, ok: true, value: R}|{item: T, ok: false, error: unknown}>>} Resultados.
 */
export async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  /**
   * Toma el siguiente elemento pendiente hasta agotar la lista.
   *
   * @returns {Promise<void>}
   */
  async function lane() {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { item: items[index], ok: true, value: await worker(items[index]) };
      } catch (error) {
        results[index] = { error, item: items[index], ok: false };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));
  return results;
}

/**
 * Resume el resultado de una operación masiva para el aviso: cuántos cambiaron, cuántos fallaron
 * y por qué (código del servicio y motivo), sin presentarla como atómica.
 *
 * @param {Object} params - Resultado y textos.
 * @param {boolean} params.isActive - Estado pedido.
 * @param {number} params.succeeded - Servicios cambiados.
 * @param {Array<{service: {code: string}, message: string}>} params.failures - Fallos con su motivo.
 * @returns {{tone: "success"|"danger", title: string, message: string}} Aviso.
 */
export function describeBulkStatusResult({ failures, isActive, succeeded }) {
  const total = succeeded + failures.length;
  const verb = isActive ? "activ" : "desactiv";
  const plural = (count, singular, pluralText) => (count === 1 ? singular : pluralText);
  if (!failures.length) {
    return {
      tone: "success",
      title: `${succeeded} ${plural(succeeded, `servicio ${verb}ado`, `servicios ${verb}ados`)}`,
      message: `Cambios correctos: ${succeeded}. Fallidos: 0. Actualizando el tabulador.`,
    };
  }
  const detail = failures.slice(0, MAX_DETAILED_FAILURES).map(({ message, service }) => `${service.code}: ${message}`).join(" ");
  const rest = failures.length > MAX_DETAILED_FAILURES ? ` Y ${failures.length - MAX_DETAILED_FAILURES} más.` : "";
  return {
    tone: "danger",
    title: succeeded
      ? `Se ${verb}aron ${succeeded} de ${total} servicios`
      : `No se ${plural(total, `pudo ${verb}ar el servicio`, `pudieron ${verb}ar los ${total} servicios`)}`,
    message: `Cambios correctos: ${succeeded}. Fallidos: ${failures.length}. ${detail}${rest}`,
  };
}
