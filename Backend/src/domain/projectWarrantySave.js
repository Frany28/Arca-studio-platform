// Guardado estable de las garantías de un proyecto (Fase 1.2, B8). Dominio puro.
//
// Reglas:
// - una entrada con `id` actualiza esa garantía vigente del proyecto; su identificador no cambia;
// - una entrada sin `id` es una garantía nueva. Nunca se asocia por posición ni por contenido
//   parecido: dos garantías iguales siguen siendo dos registros distintos;
// - las garantías vigentes que no aparecen se retiran (`deleted_at`). Conservan su fila, su historial y
//   sus vínculos con documentos, que pasan a ser evidencia de una garantía retirada;
// - compatibilidad con los envíos anteriores, que no llevaban ids: si un envío no identifica ninguna
//   garantía y retiraría alguna con documentos vinculados, se rechaza (WARRANTY_REFERENCES_REQUIRED) en
//   lugar de romper esas referencias. Sin vínculos se comporta como antes (retira y crea de nuevo).

/**
 * Devuelve los vínculos activos de una garantía desde un Map o un objeto indexado por id.
 * Sin dato, cuenta cero vínculos.
 *
 * @param {Map<number, number>|Record<string, number>} counts - Vínculos activos por garantía.
 * @param {number} id - Garantía.
 * @returns {number} Vínculos activos.
 */
function activeLinkCount(counts, id) {
  return Number(counts instanceof Map ? counts.get(id) : counts[id]) || 0;
}

/**
 * Planifica el guardado de las garantías enviadas frente a las vigentes del proyecto.
 * No decide nada por posición: el orden enviado solo fija `sortOrder`.
 *
 * @param {object} request - Garantías vigentes, enviadas y vínculos activos.
 * @param {Array<{ id: number }>} request.existing - Garantías vigentes del proyecto.
 * @param {Array<{ id?: number }>} request.submitted - Garantías enviadas, en su orden.
 * @param {Map<number, number>|Record<string, number>} [request.activeLinkCounts] - Vínculos activos por garantía.
 * @returns {{ outcome: "allowed", updates: object[], inserts: object[], retireIds: number[] }
 *   | { outcome: "invalid", index: number, reason: string }
 *   | { outcome: "conflict", reason: string, warrantyIds: number[] }} Plan o motivo del rechazo.
 */
export function planWarrantySave({ activeLinkCounts = new Map(), existing, submitted }) {
  const existingIds = new Set(existing.map((warranty) => Number(warranty.id)));
  const seen = new Set();
  const updates = [];
  const inserts = [];
  for (const [index, warranty] of submitted.entries()) {
    const entry = { ...warranty, sortOrder: index + 1 };
    if (warranty.id === undefined || warranty.id === null) {
      inserts.push(entry);
      continue;
    }
    const id = Number(warranty.id);
    if (seen.has(id)) return { index, outcome: "invalid", reason: "DUPLICATE_WARRANTY_ID" };
    if (!existingIds.has(id)) return { index, outcome: "invalid", reason: "WARRANTY_NOT_FOUND" };
    seen.add(id);
    updates.push({ ...entry, id });
  }
  const retireIds = [...existingIds].filter((id) => !seen.has(id));
  const linkedRetired = retireIds.filter((id) => activeLinkCount(activeLinkCounts, id) > 0);
  if (seen.size === 0 && linkedRetired.length > 0) {
    return { outcome: "conflict", reason: "WARRANTY_REFERENCES_REQUIRED", warrantyIds: linkedRetired };
  }
  return { inserts, outcome: "allowed", retireIds, updates };
}
