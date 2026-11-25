/*
 * Reglas puras de la restauración comercial de una versión de cotización (sin PostgreSQL ni HTTP).
 *
 * Restaurar reproduce el contenido de la versión de origen en una versión nueva y vigente:
 * - Se restauran cliente y proyecto (con los nombres copiados en esa versión), conceptos con la misma
 *   versión de servicio y la misma unidad copiada, cantidades, tarifas aplicadas y de referencia,
 *   observaciones y el IVA referencial con que se calculó.
 * - No se restauran (son inmutables o pertenecen a la cotización): id y código, autor y fecha de
 *   creación de la cotización, ni las versiones posteriores, que se conservan intactas.
 * - Una referencia que ya no está disponible (cliente inactivo o eliminado, proyecto eliminado o de
 *   otro cliente, servicio inactivo o inexistente) bloquea la operación con una explicación; nunca se
 *   sustituye por otra. Como en la edición, se admite si la versión vigente ya la usa.
 */

/** Longitud máxima del motivo de una restauración (columna restore_reason VARCHAR(500)). */
export const QUOTE_RESTORE_REASON_MAX_LENGTH = 500;

/**
 * Describe un servicio en los mensajes de conflicto con su código y nombre históricos,
 * tal como figuraban en la versión de origen (no los datos vigentes del tabulador).
 *
 * @param {{ code?: string, name?: string }} service - Servicio del concepto de origen.
 * @returns {string} «SERV-001 · Anteproyecto».
 */
function describeService(service) {
  return [service.code, service.name].filter(Boolean).join(" · ") || "Servicio";
}

/**
 * Reúne las referencias de la versión de origen que ya no pueden cotizarse. Una referencia
 * inactiva se admite cuando la versión vigente también la usa (la misma regla que conserva un
 * cliente, proyecto o servicio ya cotizado al editar).
 *
 * @param {object} options - Estado leído con los bloqueos de la transacción.
 * @param {object} options.source - Versión de origen (findQuoteById con número de versión).
 * @param {object} options.current - Versión vigente (findQuoteById).
 * @param {{ isAvailable: boolean }|null} options.clientRecord - Cliente actual del origen o null si no existe.
 * @param {{ clientId: number, isAvailable: boolean }|null} options.projectRecord - Proyecto actual del origen o null.
 * @param {Map<number, { isActive: boolean }>} options.services - Estado actual de los servicios del origen.
 * @returns {Array<{ type: "client"|"project"|"service", id: number, name: string, message: string }>}
 *   Conflictos en el orden del documento; vacío si todas las referencias siguen disponibles.
 */
export function collectRestoreReferenceConflicts({ clientRecord, current, projectRecord, services, source }) {
  const conflicts = [];
  const sameClient = current.client.id === source.client.id;
  if (!clientRecord) {
    conflicts.push({ id: source.client.id, message: `El cliente «${source.client.name}» ya no existe.`, name: source.client.name, type: "client" });
  } else if (!clientRecord.isAvailable && !sameClient) {
    conflicts.push({ id: source.client.id, message: `El cliente «${source.client.name}» está inactivo o fue eliminado.`, name: source.client.name, type: "client" });
  }

  const project = { id: source.project.id, name: source.project.name, type: "project" };
  if (!projectRecord) {
    conflicts.push({ ...project, message: `El proyecto «${source.project.name}» ya no existe.` });
  } else if (projectRecord.clientId !== source.client.id) {
    conflicts.push({ ...project, message: `El proyecto «${source.project.name}» ya no pertenece al cliente de la versión.` });
  } else if (!projectRecord.isAvailable && !(sameClient && current.project.id === source.project.id)) {
    conflicts.push({ ...project, message: `El proyecto «${source.project.name}» fue eliminado.` });
  }

  const currentServiceIds = new Set(current.items.map((item) => item.service.id));
  for (const item of source.items) {
    const service = services.get(item.service.id);
    const name = describeService(item.service);
    if (!service) {
      conflicts.push({ id: item.service.id, message: `El servicio «${name}» ya no existe.`, name, type: "service" });
    } else if (!service.isActive && !currentServiceIds.has(item.service.id)) {
      conflicts.push({ id: item.service.id, message: `El servicio «${name}» está inactivo y no puede volver a cotizarse.`, name, type: "service" });
    }
  }
  return conflicts;
}

/**
 * Copia los conceptos de la versión de origen con la forma de las líneas que guarda el servicio:
 * misma versión de servicio, misma unidad copiada y los mismos valores decimales en texto.
 *
 * @param {Array<object>} items - Conceptos de la versión de origen (findQuoteById).
 * @returns {Array<{ quantity: string, referenceRate: string|null, serviceId: number, serviceVersionId: number,
 *   serviceVersionUnitOptionId: number, unitAllowsDecimals: boolean, unitRate: string }>} Líneas en su orden.
 */
export function toRestoredLines(items) {
  return items.map((item) => ({
    quantity: item.quantity,
    referenceRate: item.referenceRate,
    serviceId: item.service.id,
    serviceVersionId: item.service.versionId,
    serviceVersionUnitOptionId: item.unit.optionId,
    unitAllowsDecimals: item.unit.allowsDecimals,
    unitRate: item.unitRate,
  }));
}

/**
 * Comprueba que el motor de cálculo reproduce exactamente los importes guardados en la versión de
 * origen (subtotales, total de servicios e IVA referencial). Compara texto decimal con escala fija,
 * sin conversiones a número flotante.
 *
 * @param {object} source - Versión de origen (findQuoteById).
 * @param {{ items: Array<{ subtotal: string }>, servicesTotal: string, referenceVat: { amount: string } }} totals -
 *   Resultado de calculateQuoteTotals con las líneas y el IVA del origen.
 * @returns {boolean} true si todos los importes coinciden.
 */
export function restoredAmountsMatch(source, totals) {
  if (totals.items.length !== source.items.length) return false;
  return totals.servicesTotal === source.servicesTotal
    && totals.referenceVat.amount === source.referenceVat.amount
    && totals.items.every((line, index) => line.subtotal === source.items[index].subtotal);
}
