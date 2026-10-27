/**
 * Texto del contador de «Seleccionar servicios». Separa los dos conjuntos que ve el
 * administrador: las selecciones nuevas, sobre los servicios que aún pueden agregarse, y los
 * servicios que ya están en la cotización (filas marcadas y bloqueadas). Mezclarlos producía
 * «0 de 2 seleccionados» con dos filas marcadas.
 *
 * @param {Object} counts - Recuentos de la tabla.
 * @param {number} counts.selected - Servicios marcados para agregar.
 * @param {number} counts.available - Servicios que todavía pueden agregarse.
 * @param {number} counts.included - Servicios del listado que ya están incluidos.
 * @returns {string} Texto visible y anunciado del contador.
 */
export function formatServicePickerCount({ available, included, selected }) {
  const selection = `${selected} de ${available} seleccionados`;
  if (included === 0) return selection;
  return `${selection} · ${included} ${included === 1 ? "ya incluido" : "ya incluidos"}`;
}
