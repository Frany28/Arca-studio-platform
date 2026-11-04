import { useCallback, useEffect, useRef, useState } from "react";

import { focusFirstInvalidField } from "../utils/invalidFieldNavigation.js";

/**
 * Lleva el foco al primer campo inválido tras un intento de envío fallido. Devuelve una función que
 * el formulario llama cuando su validación (local o del backend) encuentra errores; la navegación
 * se ejecuta después del render que muestra esos errores, nunca mientras el usuario escribe.
 *
 * Por qué una petición en estado y no una llamada directa: los errores llegan con `setState`, así
 * que al llamar todavía no están en el DOM. Incrementar un contador en la misma actualización
 * garantiza que el efecto corre tras el commit que pinta `aria-invalid`, también cuando el error
 * obliga a mostrar antes otro paso del formulario (el paso debe cambiarse en la misma actualización).
 * El frame adicional deja que los campos terminen su layout (portales y animaciones de entrada) y
 * se cancela si el formulario se desmonta o llega otra petición.
 *
 * @param {Object} params - Configuración.
 * @param {() => ParentNode|null} params.getContainer - Devuelve el formulario o diálogo donde buscar;
 * se resuelve al navegar, así que admite refs y selectores de portales.
 * @returns {() => void} Solicita la navegación al primer campo inválido.
 */
export function useInvalidFieldFocus({ getContainer }) {
  const [request, setRequest] = useState(0);
  // Ref para que un getContainer nuevo en cada render no repita la navegación.
  const getContainerRef = useRef(getContainer);

  useEffect(() => {
    getContainerRef.current = getContainer;
  });

  useEffect(() => {
    if (request === 0) return undefined;
    const frame = window.requestAnimationFrame(() => focusFirstInvalidField(getContainerRef.current()));
    return () => window.cancelAnimationFrame(frame);
  }, [request]);

  return useCallback(() => setRequest((current) => current + 1), []);
}
