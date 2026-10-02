/**
 * Permite anotaciones solo cuando coinciden los indicadores de disponibilidad.
 * Exige visibilidad, carga terminada, loadState loaded y visor cargado.
 *
 * @param {Object} params - isLoading, loadState, viewerLoaded y visible del visor.
 * @returns {boolean} Si pueden mostrarse los marcadores.
 */
export function canShowPanoramaAnnotations({
  isLoading,
  loadState,
  viewerLoaded,
  visible,
}) {
  return Boolean(
    visible &&
      !isLoading &&
      loadState === "loaded" &&
      viewerLoaded,
  );
}

/**
 * Habilita la observación del visor únicamente si puede renderizarse e interactuar.
 * Exige visibilidad, shouldRender, modelo interactivo y visor disponible.
 *
 * @param {Object} params - hasInteractiveModel, shouldRender, viewerAvailable y visible.
 * @returns {boolean} Si el consumidor puede observar el visor.
 */
export function canObservePanoramaViewer({
  hasInteractiveModel,
  shouldRender,
  viewerAvailable,
  visible,
}) {
  return Boolean(
    visible && shouldRender && hasInteractiveModel && viewerAvailable,
  );
}
