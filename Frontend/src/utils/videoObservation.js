export const VIDEO_TIME_SELECTION_KIND = "video-time";

/**
 * Presenta segundos completos no negativos como m:ss o h:mm:ss.
 * Trunca fracciones y normaliza valores convertibles falsy a cero; no valida finitud.
 *
 * @param {number|string|null} value - Tiempo en segundos.
 * @returns {string} Etiqueta temporal para la observación.
 */
export function formatVideoObservationTime(value) {
  const totalSeconds = Math.max(Math.floor(Number(value) || 0), 0);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Construye una selección video-time desde tiempo y duración convertibles a número.
 * Exige tiempo finito no negativo y duración finita positiva; redondea a décimas
 * y limita el tiempo redondeado a la duración original, no a la duración redondeada.
 *
 * @param {number|string} timeSeconds - Instante seleccionado.
 * @param {number|string} durationSeconds - Duración del video.
 * @returns {Object|null} Selección temporal o null si los datos no son válidos.
 */
export function createVideoTimeSelection(timeSeconds, durationSeconds) {
  const time = Number(timeSeconds);
  const duration = Number(durationSeconds);

  if (
    !Number.isFinite(time) ||
    time < 0 ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    return null;
  }

  return {
    durationSeconds: Math.round(duration * 10) / 10,
    kind: VIDEO_TIME_SELECTION_KIND,
    timeSeconds: Math.min(Math.round(time * 10) / 10, duration),
  };
}

/**
 * Valida una selección video-time y deriva sus datos para navegación y presentación.
 * Exige números originales finitos, duración positiva y tiempo dentro de la duración;
 * no convierte strings numéricos como hace el constructor de selección.
 *
 * @param {Object|null} selection - Selección asociada a la observación.
 * @returns {Object|null} videoDurationSeconds, videoTimeLabel y videoTimeSeconds, o null.
 */
export function getVideoObservationTiming(selection) {
  if (selection?.kind !== VIDEO_TIME_SELECTION_KIND) return null;

  if (
    typeof selection.timeSeconds !== "number" ||
    typeof selection.durationSeconds !== "number"
  ) {
    return null;
  }

  const timeSeconds = Number(selection.timeSeconds);
  const durationSeconds = Number(selection.durationSeconds);

  if (
    !Number.isFinite(timeSeconds) ||
    timeSeconds < 0 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    timeSeconds > durationSeconds
  ) {
    return null;
  }

  return {
    videoDurationSeconds: durationSeconds,
    videoTimeLabel: formatVideoObservationTime(timeSeconds),
    videoTimeSeconds: timeSeconds,
  };
}
