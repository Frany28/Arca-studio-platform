/**
 * Marca de tiempo de la última actividad de una fila de Gestión de proyectos: `updatedAt`
 * (solicitud o proyecto) y, si falta o no es válida, `createdAt`. Sin ninguna fecha válida
 * devuelve -Infinity para que la fila quede al final.
 *
 * @param {{updatedAt?: string|null, createdAt?: string|null}} row - Fila de solicitud o proyecto.
 * @returns {number} Milisegundos desde la época o -Infinity.
 */
export function getLatestActivityTime(row) {
  for (const value of [row?.updatedAt, row?.createdAt]) {
    const time = value ? new Date(value).getTime() : Number.NaN;
    if (Number.isFinite(time)) return time;
  }
  return Number.NEGATIVE_INFINITY;
}

/**
 * Ordena solicitudes y proyectos (draft, en espera, en progreso, finalizados, archivados) en una
 * sola lista por última actividad, de la más reciente a la más antigua, sin agruparlos por tipo
 * ni por estado. `Array.prototype.sort` es estable: con la misma actividad (o sin fechas) las
 * filas conservan el orden recibido, que la API ya devuelve determinista. No muta el arreglo
 * recibido; búsqueda, filtros y paginación de la tabla conservan este orden.
 *
 * @param {Array<Object>} rows - Filas de solicitudes y proyectos.
 * @returns {Array<Object>} Copia ordenada.
 */
export function sortByLatestActivity(rows) {
  return [...rows].sort((first, second) => {
    const firstTime = getLatestActivityTime(first);
    const secondTime = getLatestActivityTime(second);
    // Restar dos -Infinity daría NaN: sin fechas en ambas, se mantienen en su orden.
    return firstTime === secondTime ? 0 : secondTime - firstTime;
  });
}
