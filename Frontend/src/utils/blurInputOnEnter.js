const editableInputTypes = new Set([
  "text", "search", "email", "tel", "url", "password", "number",
]);

/**
 * Finaliza la edición del campo y cancela el envío implícito con Enter.
 * Escucha el evento en el formulario después de los manejadores del campo.
 * @param {import("react").KeyboardEvent<HTMLFormElement>} event Evento del formulario.
 */
export function blurInputOnEnter(event) {
  if (event.key !== "Enter" || event.defaultPrevented || event.nativeEvent.isComposing) {
    return;
  }

  const input = event.target;
  if (input.tagName !== "INPUT" || input.form !== event.currentTarget || !editableInputTypes.has(input.type)) {
    return;
  }

  event.preventDefault();
  input.blur();
}
