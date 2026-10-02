/**
 * Elige el instante para capturar un fotograma sin recorrer todo el video.
 * Duraciones inválidas usan cero; bajo 0.2 segundos usa la mitad; el resto usa
 * el diez por ciento limitado entre 0.1 y cinco segundos.
 *
 * @param {number|string} duration - Duración en segundos.
 * @returns {number} Instante de captura en segundos.
 */
export function getVideoThumbnailTime(duration) {
  const safeDuration = Number(duration);

  if (!Number.isFinite(safeDuration) || safeDuration <= 0) return 0;
  if (safeDuration < 0.2) return safeDuration / 2;

  return Math.min(Math.max(safeDuration * 0.1, 0.1), 5);
}
