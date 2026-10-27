import { useCallback, useEffect, useRef } from "react";
import { useBlocker } from "react-router-dom";

/**
 * Protege un formulario con cambios sin guardar frente a cualquier salida:
 *
 * - Navegación dentro de la aplicación (enlaces del sidebar o del breadcrumb, `navigate()` y los
 *   botones Atrás/Adelante): `useBlocker` de React Router la detiene y el consumidor decide con
 *   `proceed` o `reset`, normalmente desde su diálogo de confirmación. Requiere el data router
 *   de `main.jsx`. Solo bloquea cambios de ruta (`pathname`), no de búsqueda o fragmento.
 * - Recarga, cierre de la pestaña o salida a otro sitio: `beforeunload` pide la confirmación
 *   nativa del navegador, que no admite un diálogo propio ni texto personalizado.
 *
 * `allowNavigation` desactiva la protección de forma inmediata (por ejemplo, tras un guardado
 * confirmado y justo antes de navegar al listado). Usa un ref porque React Router lee la función
 * de bloqueo registrada en el último render: un estado nuevo no llegaría a tiempo para la
 * navegación que se dispara en el mismo evento.
 *
 * @param {Object} params - Condición de protección.
 * @param {boolean} params.when - Hay cambios sin guardar que se perderían al salir.
 * @returns {{blocked: boolean, proceed: () => void, reset: () => void, allowNavigation: () => void}}
 * Estado de la navegación detenida y acciones.
 */
export function useUnsavedChangesGuard({ when }) {
  const allowedRef = useRef(false);
  const shouldBlock = useCallback(
    ({ currentLocation, nextLocation }) => when && !allowedRef.current && currentLocation.pathname !== nextLocation.pathname,
    [when],
  );
  const blocker = useBlocker(shouldBlock);

  // El listener solo existe mientras hay cambios: así no afecta a la caché de páginas del navegador
  // (bfcache) cuando el formulario está limpio.
  useEffect(() => {
    if (!when) return undefined;
    const confirmUnload = (event) => {
      if (allowedRef.current) return;
      event.preventDefault();
      // Navegadores que aún exigen returnValue para mostrar la confirmación.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", confirmUnload);
    return () => window.removeEventListener("beforeunload", confirmUnload);
  }, [when]);

  return {
    blocked: blocker.state === "blocked",
    proceed: () => blocker.proceed?.(),
    reset: () => blocker.reset?.(),
    allowNavigation: () => {
      allowedRef.current = true;
    },
  };
}
