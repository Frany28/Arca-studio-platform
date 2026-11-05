import { useEffect, useMemo, useRef } from "react";

import { PROJECT_PANEL_MODULES } from "../components/projectPanelModules.js";

// Permanencia mínima del puntero o del foco antes de precargar: evita descargar las pestañas que
// solo se cruzan al mover el ratón o recorrer la barra.
export const PANEL_INTENT_DELAY_MS = 80;
// Renders incluye three.js: exige una intención más sostenida.
export const HEAVY_PANEL_INTENT_DELAY_MS = 250;

/**
 * Indica si la conexión admite descargas anticipadas: no con ahorro de datos ni en redes 2G.
 *
 * @param {{saveData?: boolean, effectiveType?: string}|undefined} [connection] - Network Information API.
 * @returns {boolean} true si se puede precargar.
 */
export function allowsAnticipatoryDownloads(connection = globalThis.navigator?.connection) {
  if (!connection) return true;
  if (connection.saveData) return false;
  return !["slow-2g", "2g"].includes(connection.effectiveType);
}

// Índice de la pestaña que contiene el nodo, contado dentro de la barra que escucha el evento.
function getTabIndex(tablist, node) {
  const tab = node?.closest?.('[role="tab"]');
  if (!tab || !tablist?.contains(tab)) return null;
  const index = [...tablist.querySelectorAll('[role="tab"]')].indexOf(tab);
  return index >= 0 ? index : null;
}

/**
 * Precarga el panel diferido de una pestaña cuando hay intención clara de abrirla: puntero o foco
 * sostenidos sobre ella, o pulsación. Un toque solo precarga paneles ligeros (puede ser el inicio de
 * un desplazamiento de la barra). No precarga la pestaña activa ni con ahorro de datos o en 2G.
 *
 * @param {Object} params - Pestaña activa y módulos disponibles.
 * @param {number} params.activeIndex - Pestaña activa.
 * @param {Object<number, {component: {preload: Function}, heavy: boolean}>} [params.modules] - Paneles diferidos por índice.
 * @returns {Object} Manejadores para la barra de pestañas (delegación de eventos).
 */
export default function useProjectPanelPrefetch({ activeIndex, modules = PROJECT_PANEL_MODULES }) {
  const timerRef = useRef(null);
  const pendingIndexRef = useRef(null);
  const activeIndexRef = useRef(activeIndex);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return useMemo(() => {
    const cancel = () => {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      pendingIndexRef.current = null;
    };

    const preload = (index) => {
      const entry = modules[index];
      if (!entry || index === activeIndexRef.current || !allowsAnticipatoryDownloads()) return;
      entry.component.preload();
    };

    const scheduleIntent = (index) => {
      if (index === pendingIndexRef.current) return;
      cancel();
      const entry = modules[index];
      if (!entry || index === activeIndexRef.current) return;
      pendingIndexRef.current = index;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        pendingIndexRef.current = null;
        preload(index);
      }, entry.heavy ? HEAVY_PANEL_INTENT_DELAY_MS : PANEL_INTENT_DELAY_MS);
    };

    return {
      onBlur: cancel,
      onFocus: (event) => scheduleIntent(getTabIndex(event.currentTarget, event.target)),
      onPointerDown: (event) => {
        const index = getTabIndex(event.currentTarget, event.target);
        if (index === null) return;
        if (event.pointerType === "touch" && modules[index]?.heavy) return;
        cancel();
        preload(index);
      },
      onPointerOut: (event) => {
        const nextIndex = getTabIndex(event.currentTarget, event.relatedTarget);
        if (nextIndex !== pendingIndexRef.current) cancel();
      },
      onPointerOver: (event) => {
        if (event.pointerType === "touch") return;
        scheduleIntent(getTabIndex(event.currentTarget, event.target));
      },
    };
  }, [modules]);
}
