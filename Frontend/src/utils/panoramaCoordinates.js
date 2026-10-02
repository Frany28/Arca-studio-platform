/**
 * Resuelve orientación desde selection, targetMetadata o el propio valor.
 * Prefiere yaw/pitch finitos; como alternativa convierte modelPosition a grados,
 * con yaw atan2(x, -z) y pitch asin(y/longitud), limitado para evitar desbordes.
 *
 * @param {Object|null} value - Orientación o referencia de una observación.
 * @returns {Object|null} yaw y pitch en grados, o null sin vector finito no nulo.
 */
export function getPanoramaOrientation(value) {
  const selection = value?.selection || value?.targetMetadata?.selection || value?.targetMetadata || value;
  const yaw = selection?.yaw;
  const pitch = selection?.pitch;
  if (Number.isFinite(yaw) && Number.isFinite(pitch)) return { yaw, pitch };

  const position = selection?.viewerPoint?.modelPosition;
  const x = position?.x;
  const y = position?.y;
  const z = position?.z;
  const length = Math.hypot(x, y, z);
  if (
    ![x, y, z].every(Number.isFinite) ||
    !Number.isFinite(length) ||
    length === 0
  ) {
    return null;
  }
  return {
    yaw: Math.atan2(x, -z) * 180 / Math.PI,
    pitch: Math.asin(Math.min(Math.max(y / length, -1), 1)) * 180 / Math.PI,
  };
}

/**
 * Convierte el campo de visión de radianes a grados y lo limita entre 15 y 90.
 * Acepta valores convertibles a número y devuelve null para ausencia o valores no finitos.
 *
 * @param {number|string|null} value - Campo de visión en radianes.
 * @returns {number|null} Campo de visión limitado en grados.
 */
export function getPanoramaFieldOfViewDegrees(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;

  const degrees = Number(value) * 180 / Math.PI;

  return Math.min(Math.max(degrees, 15), 90);
}

/**
 * Convierte yaw y pitch en grados a coordenadas cartesianas escaladas.
 * Yaw cero mira hacia -Z; pitch positivo eleva Y y yaw positivo apunta hacia +X.
 * No limita ángulos ni exige radio positivo, pero rechaza valores no finitos.
 *
 * @param {number|string} yawDegrees - Giro horizontal en grados.
 * @param {number|string} pitchDegrees - Inclinación en grados.
 * @param {number} [radius=1] - Escala aplicada al vector.
 * @returns {Object|null} Vector { x, y, z } o null.
 */
export function getPanoramaDirection(yawDegrees, pitchDegrees, radius = 1) {
  const yaw = Number(yawDegrees) * Math.PI / 180;
  const pitch = Number(pitchDegrees) * Math.PI / 180;
  if (![yaw, pitch, radius].every(Number.isFinite)) return null;
  return {
    x: Math.sin(yaw) * Math.cos(pitch) * radius,
    y: Math.sin(pitch) * radius,
    z: -Math.cos(yaw) * Math.cos(pitch) * radius,
  };
}
