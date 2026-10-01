export function getFiniteVector(vector) {
  if (!vector || typeof vector === "string") {
    return null;
  }

  const { x, y, z } = vector;

  return [x, y, z].every((value) => Number.isFinite(value))
    ? { x, y, z }
    : null;
}

export function getFiniteCameraOrbit(orbit) {
  if (!orbit || typeof orbit === "string") {
    return null;
  }

  const { phi, radius, theta } = orbit;

  return [phi, radius, theta].every((value) => Number.isFinite(value))
    ? { phi, radius, theta }
    : null;
}

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
