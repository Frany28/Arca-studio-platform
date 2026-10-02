/**
 * Extrae un vector únicamente si x, y y z son números finitos.
 * Rechaza strings y no convierte representaciones textuales de coordenadas.
 *
 * @param {Object|string|null} vector - Datos de posición del visor.
 * @returns {Object|null} Copia { x, y, z } o null.
 */
export function getFiniteVector(vector) {
  if (!vector || typeof vector === "string") {
    return null;
  }

  const { x, y, z } = vector;

  return [x, y, z].every((value) => Number.isFinite(value))
    ? { x, y, z }
    : null;
}

/**
 * Extrae una órbita cuyos ángulos y radio sean números finitos.
 * No convierte strings ni impone un radio positivo; el consumidor aplica ese límite.
 *
 * @param {Object|string|null} orbit - Datos de órbita del visor.
 * @returns {Object|null} Copia { phi, radius, theta } o null; ángulos en radianes.
 */
export function getFiniteCameraOrbit(orbit) {
  if (!orbit || typeof orbit === "string") {
    return null;
  }

  const { phi, radius, theta } = orbit;

  return [phi, radius, theta].every((value) => Number.isFinite(value))
    ? { phi, radius, theta }
    : null;
}

/**
 * Obtiene extremos de dimensiones válidas mediante getDimensions del visor.
 * Ignora ejes no finitos o no positivos; puede devolver extremos con solo un eje válido.
 *
 * @param {Object|null} modelViewer - Visor que expone getDimensions opcional.
 * @returns {Object|null} min y max de los ejes válidos, o null si no hay ninguno.
 */
export function getModelViewerDimensions(modelViewer) {
  const dimensions = modelViewer?.getDimensions?.();
  const values = [dimensions?.x, dimensions?.y, dimensions?.z].filter(
    (value) => Number.isFinite(value) && value > 0,
  );

  if (!values.length) {
    return null;
  }

  return {
    max: Math.max(...values),
    min: Math.min(...values),
  };
}
