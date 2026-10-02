/**
 * Presenta bytes en unidades B a TB con divisiones de 1024 y formato es-VE.
 * Por defecto usa un decimal para cantidades menores de diez fuera de B, y cero en el resto.
 *
 * @param {number|string} bytes - Cantidad convertible a número; valores falsy numéricos usan cero.
 * @param {Object} [options={}] - Opciones de precisión.
 * @param {number} [options.maximumFractionDigits] - Sobrescribe la precisión automática.
 * @returns {string} Cantidad con unidad.
 */
export function formatStorage(bytes, { maximumFractionDigits } = {}) {
  const value = Number(bytes) || 0;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unitIndex = 0;
  let amount = value;

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  const digits = maximumFractionDigits ?? (amount >= 10 || unitIndex === 0 ? 0 : 1);
  return `${amount.toLocaleString("es-VE", { maximumFractionDigits: digits })} ${units[unitIndex]}`;
}

/**
 * Formatea fecha y hora de carga en es-VE, con reloj de 24 horas y zona local del navegador.
 * Devuelve el fallback si el valor está ausente o no produce una fecha válida.
 *
 * @param {string|number|null} value - Fecha de carga.
 * @param {string} [fallback="Sin cargas"] - Texto alternativo.
 * @returns {string} Fecha y hora visibles.
 */
export function formatFileUploadDate(value, fallback = "Sin cargas") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  return new Intl.DateTimeFormat("es-VE", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date).replace(",", "");
}
