import { useState } from "react";

import ComposerSubmitButton from "../ComposerSubmitButton.jsx";
import TextArea from "../TextArea/TextArea.jsx";
import Tooltip from "../Tooltip/Tooltip.jsx";
import { ReplyArrowIcon, SendIcon } from "./NotificationsDrawerIcons.jsx";

/**
 * Envuelve el input de respuesta con el marcador protegido por el listener global.
 * Es una exportación interna del módulo del drawer y no mueve el foco al montarse.
 * @param {Object} props Bloqueo, placeholder y callback local de envío.
 * @returns {import("react").ReactElement} Compositor de respuesta.
 */
export function ReplyComposer({
  disabled = false,
  onSubmit,
  placeholder = "Escribe tu mensaje...",
}) {
  return (
    <div data-reply-interaction="true">
      <MessageInput
        disabled={disabled}
        placeholder={placeholder}
        onSubmit={onSubmit}
      />
    </div>
  );
}

/**
 * Mantiene el borrador y presenta las variantes de observación general y respuesta.
 * Recorta el texto, bloquea vacío o disabled y conserva los atajos originales;
 * no coordina peticiones, errores ni estado pending del callback externo.
 * @param {Object} props Configuración visual y callbacks del compositor.
 * @returns {import("react").ReactElement} Campo y acción de envío.
 */
export default function MessageInput({
  disabled = false,
  id,
  multiline = false,
  onFocus,
  onSubmit,
  placeholder,
}) {
  const [textAreaValue, setTextAreaValue] = useState("");
  const trimmedValue = textAreaValue.trim();

  /**
   * Invoca el callback con el texto recortado y limpia el borrador inmediatamente.
   * No espera su promesa ni bloquea otra solicitud pendiente; ese comportamiento
   * se conserva deliberadamente durante la extracción estructural.
   * @returns {void} Envía si existe texto y el control está habilitado.
   */
  function handleSubmit() {
    if (!trimmedValue || disabled) {
      return;
    }

    onSubmit?.(trimmedValue);
    setTextAreaValue("");
  }

  return multiline ? (
    <div className="flex flex-col gap-[8px]">
      <TextArea
        id={id}
        label="Observación general"
        placeholder={placeholder}
        value={textAreaValue}
        disabled={disabled}
        showHint={false}
        showLabelInfo={false}
        minHeight={104}
        rows={4}
        className="!max-w-none"
        onFocus={onFocus}
        onChange={(event) => setTextAreaValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            handleSubmit();
          }
        }}
      />
      <div className="flex justify-end">
        <ComposerSubmitButton
          ariaLabel="Enviar observación"
          disabled={!trimmedValue || disabled}
          onClick={handleSubmit}
        />
      </div>
    </div>
  ) : (
    <div className="flex w-full items-start gap-[4px]">
      <ReplyArrowIcon />
      <div className="flex flex-1 flex-col gap-[8px]">
        <div className="flex w-full items-center rounded-[8px] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] px-[12px] py-[8px]">
          <input
            type="text"
            placeholder={placeholder}
            value={textAreaValue}
            disabled={disabled}
            className="min-w-0 flex-1 border-0 bg-transparent text-[14px] font-normal leading-[17px] tracking-[-0.5px] text-[var(--color-text-300)] outline-none placeholder:text-[var(--color-text-100)]"
            onFocus={onFocus}
            onChange={(event) => setTextAreaValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleSubmit();
              }
            }}
          />
          <Tooltip asChild portal showTip text="Enviar mensaje" tipPosition="Top right">
            <button
              type="button"
              aria-label="Enviar mensaje"
              disabled={!trimmedValue || disabled}
              className="flex cursor-pointer shrink-0 items-center justify-center text-[var(--color-neutral-300)] transition-colors duration-200 hover:text-[var(--color-text-300)] disabled:cursor-not-allowed disabled:opacity-40"
              onClick={handleSubmit}
            >
              <SendIcon />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
