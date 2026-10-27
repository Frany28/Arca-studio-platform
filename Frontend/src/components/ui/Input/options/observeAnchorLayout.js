/**
 * Suscribe un listado flotante (portal con `position: fixed`) a todo lo que puede mover o
 * redimensionar su ancla mientras está abierto, para recalcular su posición:
 *
 * - `resize` de la ventana.
 * - `scroll` de cualquier contenedor (fase de captura), salvo el del propio listado, que no
 *   mueve el ancla y solo provocaría renders durante el desplazamiento.
 * - Cambios de tamaño del ancla (`ResizeObserver`), por ejemplo al cargar la fuente definitiva.
 * - Fin de transiciones y animaciones de cualquier ancestro (`transitionend`/`animationend`):
 *   un modal que entra con `transform` desplaza y escala el ancla sin emitir ninguno de los
 *   eventos anteriores, y un listado abierto durante esa entrada quedaba anclado a la geometría
 *   intermedia.
 *
 * @param {Object} params - Elementos y callback.
 * @param {Element|null} params.anchor - Ancla medida (segmento selector o campo completo).
 * @param {() => Element|null} params.getPanel - Devuelve el listado (puede montarse después).
 * @param {() => void} params.onChange - Recalcula la posición.
 * @returns {() => void} Cancela todas las suscripciones.
 */
export function observeAnchorLayout({ anchor, getPanel, onChange }) {
  const updateOnScroll = (event) => {
    if (getPanel()?.contains(event.target)) return;
    onChange();
  };
  window.addEventListener("resize", onChange);
  window.addEventListener("scroll", updateOnScroll, true);
  document.addEventListener("transitionend", onChange, true);
  document.addEventListener("animationend", onChange, true);
  const resizeObserver = typeof ResizeObserver === "undefined" || !anchor ? null : new ResizeObserver(() => onChange());
  if (anchor) resizeObserver?.observe(anchor);
  return () => {
    window.removeEventListener("resize", onChange);
    window.removeEventListener("scroll", updateOnScroll, true);
    document.removeEventListener("transitionend", onChange, true);
    document.removeEventListener("animationend", onChange, true);
    resizeObserver?.disconnect();
  };
}
