import { useState } from "react";

/**
 * Aviso único de una pestaña del módulo (AlertToast): en el tabulador lo comparten el formulario
 * y los cambios de estado; en Cotizaciones, el visor y las operaciones del listado.
 * Cada aviso recibe un identificador nuevo para que AlertToast vuelva a mostrarse aunque el
 * texto se repita.
 *
 * @returns {{value: Object|null, notify: (tone: "success"|"danger", title: string, message: string, content?: string) => void,
 * dismiss: () => void}} Aviso vigente y acciones.
 */
export function useAlertFeedback() {
  const [value, setValue] = useState(null);
  return {
    value,
    notify: (tone, title, message, content) => setValue({ id: Date.now(), message, title, tone, content }),
    dismiss: () => setValue(null),
  };
}
