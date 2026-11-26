/**
 * Ordena proyectos y solicitudes por fecha de creación descendente, con los registros sin fecha al final.
 * @param {Array<{createdAt?: string|null}>} rows - Filas de proyectos y solicitudes.
 * @returns {Array<object>} Copia ordenada.
 */
export function sortByNewestCreation(rows) {
  return [...rows].sort((first, second) => {
    const firstTime = Date.parse(first.createdAt);
    const secondTime = Date.parse(second.createdAt);
    if (Number.isNaN(firstTime)) return Number.isNaN(secondTime) ? 0 : 1;
    if (Number.isNaN(secondTime)) return -1;
    return secondTime - firstTime;
  });
}
