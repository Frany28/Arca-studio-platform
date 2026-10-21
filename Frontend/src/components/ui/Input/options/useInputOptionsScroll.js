import { useEffect, useRef, useState } from "react";

/**
 * Lee tamaño y desplazamiento reales del listado para su scrollbar personalizado.
 * @param {HTMLElement|null} element Contenedor desplazable, si está montado.
 * @returns {{length: number, position: number}} Proporciones visibles y recorridas.
 */
export function getVerticalScrollMetrics(element) {
  if (!element) return { length: 1, position: 0 };
  const maxScroll = Math.max(element.scrollHeight - element.clientHeight, 0);
  return {
    length: Math.min(element.clientHeight / Math.max(element.scrollHeight, 1), 1),
    position: maxScroll > 0 ? element.scrollTop / maxScroll : 0,
  };
}

/**
 * Sincroniza el ScrollBar compartido con el scroll nativo (oculto) de un listado de opciones
 * del Input. La medición espera al montaje del listado y se repite si cambia el número de
 * opciones; el frame se cancela al cerrar o desmontar.
 *
 * @param {Object} params - Estado del listado.
 * @param {boolean} params.open - Listado montado.
 * @param {number} params.optionCount - Opciones visibles, para volver a medir al filtrar.
 * @param {boolean} params.disabled - Ignora el arrastre del ScrollBar si el selector está bloqueado.
 * @returns {{scrollRef: Object, metrics: {length: number, position: number}, handleScroll: Function,
 * handlePositionChange: Function}} Ref del área desplazable, métricas y manejadores.
 */
export default function useInputOptionsScroll({ open, optionCount, disabled }) {
  const scrollRef = useRef(null);
  const [metrics, setMetrics] = useState({ length: 1, position: 0 });

  useEffect(() => {
    if (!open) return undefined;
    const frameId = window.requestAnimationFrame(() => {
      setMetrics(getVerticalScrollMetrics(scrollRef.current));
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [optionCount, open]);

  /**
   * Desplaza el contenedor y actualiza las métricas del scrollbar desde el DOM.
   * @param {number} nextPosition Posición relativa solicitada por el scrollbar.
   * @returns {void}
   */
  const handlePositionChange = (nextPosition) => {
    if (disabled) return;
    const container = scrollRef.current;
    if (!container) return;
    const maxScroll = Math.max(container.scrollHeight - container.clientHeight, 0);
    container.scrollTop = maxScroll * nextPosition;
    setMetrics(getVerticalScrollMetrics(container));
  };

  /**
   * Lee las métricas del contenedor tras su desplazamiento nativo.
   * @param {object} event Evento de scroll del listado.
   * @returns {void}
   */
  const handleScroll = (event) => setMetrics(getVerticalScrollMetrics(event.currentTarget));

  return { handlePositionChange, handleScroll, metrics, scrollRef };
}
