import { useEffect, useRef } from "react";

export const DIALOG_FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Aplica el contrato de teclado de los diálogos modales: enfoca un control inicial,
 * mantiene Tab dentro del diálogo, cierra con Escape y devuelve el foco al disparador.
 *
 * El contenedor se resuelve en cada evento porque `Modal` monta su contenido tras una
 * microtarea y dos frames; así el hook no depende del orden de montaje. La devolución
 * del foco se omite si el elemento previo ya no existe (p. ej. el menú en portal).
 *
 * @param {Object} params - Configuración del diálogo.
 * @param {boolean} params.open - Activa listeners y foco solo mientras el diálogo está visible.
 * @param {() => HTMLElement|null} params.getContainer - Devuelve el nodo del diálogo.
 * @param {() => void} params.onEscape - Cierre solicitado por Escape.
 * @param {(elements: HTMLElement[]) => HTMLElement|undefined} [params.getInitialFocus]
 * Elige el control inicial; por defecto el primero enfocable.
 * @returns {void}
 */
export function useDialogKeyboard({ open, getContainer, onEscape, getInitialFocus }) {
  // Refs para que callbacks nuevos en cada render no reinicien el foco ni los listeners.
  const latestRef = useRef({ getContainer, onEscape, getInitialFocus });

  useEffect(() => {
    latestRef.current = { getContainer, onEscape, getInitialFocus };
  });

  useEffect(() => {
    if (!open) return undefined;

    const previousElement = document.activeElement;
    const getFocusableElements = () => Array.from(
      latestRef.current.getContainer()?.querySelectorAll(DIALOG_FOCUSABLE_SELECTOR) ?? [],
    );
    let frameId = window.requestAnimationFrame(() => {
      frameId = window.requestAnimationFrame(() => {
        const elements = getFocusableElements();
        (latestRef.current.getInitialFocus?.(elements) ?? elements[0])?.focus();
      });
    });

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        latestRef.current.onEscape();
        return;
      }
      if (event.key !== "Tab") return;

      const elements = getFocusableElements();
      if (!elements.length) {
        event.preventDefault();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      const focusIsOutside = !latestRef.current.getContainer()?.contains(document.activeElement);

      if (event.shiftKey && (document.activeElement === first || focusIsOutside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || focusIsOutside)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(frameId);
      document.removeEventListener("keydown", handleKeyDown);
      if (previousElement instanceof HTMLElement && document.contains(previousElement)) {
        previousElement.focus();
      }
    };
  }, [open]);
}
