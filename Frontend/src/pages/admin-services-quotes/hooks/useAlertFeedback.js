import { useState } from "react";

/**
 * Aviso único del tabulador (AlertToast) que comparten el formulario y los cambios de estado.
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
