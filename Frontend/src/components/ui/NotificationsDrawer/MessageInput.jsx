import { useRef, useState } from "react";

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
 * Convierte un rechazo de envío en un mensaje visible y estable para reintentar.
 * @param {unknown} error Valor lanzado o rechazado por el callback externo.
 * @returns {string} Mensaje apto para presentar junto al compositor.
 */
function getSubmissionErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "No se pudo enviar el comentario.";
}

/**
 * Mantiene borrador, estado pending y error local de cada compositor.
 * Solo limpia el texto cuando el callback termina con éxito y utiliza una ref
 * síncrona para impedir envíos duplicados antes del siguiente render de React.
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState("");
  const submissionPendingRef = useRef(false);
  const trimmedValue = textAreaValue.trim();
  const submitDisabled = !trimmedValue || disabled || isSubmitting;

  /**
   * Envía una única solicitud por compositor y conserva el borrador mientras espera.
   * Admite callbacks síncronos, void o Promise; los errores quedan locales al
   * compositor actual para que otro compositor abierto no herede su fallo.
   * @returns {Promise<void>} Finaliza tras éxito o recuperación del rechazo.
   */
  async function handleSubmit() {
    if (!trimmedValue || disabled || submissionPendingRef.current) {
      return;
    }

    submissionPendingRef.current = true;
    setIsSubmitting(true);
    setSubmissionError("");

    try {
      await Promise.resolve(onSubmit?.(trimmedValue));
      setTextAreaValue("");
    } catch (error) {
      setSubmissionError(getSubmissionErrorMessage(error));
    } finally {
      submissionPendingRef.current = false;
      setIsSubmitting(false);
    }
  }

  const errorMessage = submissionError ? (
    <p
      role="alert"
      className="text-[12px] font-normal leading-[14px] tracking-[-0.5px] text-[var(--color-danger-100)]"
    >
      {submissionError}
    </p>
  ) : null;

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
      {errorMessage}
      <div className="flex justify-end">
        <ComposerSubmitButton
          ariaLabel="Enviar observación"
          disabled={submitDisabled}
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
          <Tooltip
            asChild
            portal
            showTip
            text="Enviar mensaje"
            tipPosition="Top right"
          >
            <button
              type="button"
              aria-label="Enviar mensaje"
              disabled={submitDisabled}
              className="flex cursor-pointer shrink-0 items-center justify-center text-[var(--color-neutral-300)] transition-colors duration-200 hover:text-[var(--color-text-300)] disabled:cursor-not-allowed disabled:opacity-40"
              onClick={handleSubmit}
            >
              <SendIcon />
            </button>
          </Tooltip>
        </div>
        {errorMessage}
      </div>
    </div>
  );
}
