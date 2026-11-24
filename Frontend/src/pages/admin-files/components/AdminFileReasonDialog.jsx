import { useId, useState } from "react";

import Button from "../../../components/ui/Button/Button.jsx";
import Modal, { ModalCloseButton } from "../../../components/ui/Modal/Modal.jsx";
import TextArea from "../../../components/ui/TextArea/TextArea.jsx";
import { useDialogKeyboard } from "../../../hooks/useDialogKeyboard.js";
import { useInvalidFieldFocus } from "../../../hooks/useInvalidFieldFocus.js";
import { REJECT_REASON_MAX_LENGTH, RESTORE_NOTE_MAX_LENGTH } from "../utils/adminFileReview.js";

const COPY = Object.freeze({
  reject: {
    close: "Cerrar motivo del rechazo",
    empty: "Escribe el motivo del rechazo.",
    label: "Motivo del rechazo",
    maxLength: REJECT_REASON_MAX_LENGTH,
    placeholder: "Ej. \"Falta firma del cliente, El plano corresponde a una versión anterior, Archivo corrupto o Documento incompleto.\"",
    submit: "Enviar",
    submitting: "Enviando...",
  },
  restore: {
    close: "Cerrar motivo de la restauración",
    empty: "Escribe el motivo de la restauración.",
    label: "Motivo de la restauración",
    maxLength: RESTORE_NOTE_MAX_LENGTH,
    placeholder: "Ej. \"Se vuelve a la versión aprobada por el cliente en la reunión del lunes.\"",
    submit: "Restaurar",
    submitting: "Restaurando...",
  },
});

/**
 * Motivo obligatorio de una operación (Figma 3727:683879, «Motivo del rechazo»): rechazar una
 * versión pendiente o restaurar una aprobada. Conserva lo escrito ante un error, lo señala junto al
 * campo (motivo inválido) o bajo el formulario (conflictos) y bloquea el envío mientras la petición
 * está en curso. Escape y «Volver» cierran sin enviar.
 *
 * @param {Object} props - Operación, contexto y callbacks.
 * @param {"reject"|"restore"} props.kind - Operación.
 * @param {string} props.subject - Versión afectada («Acta.pdf · V3»).
 * @param {string} [props.description] - Consecuencia de la operación, visible antes de confirmar
 *   (la restauración explica qué versión se crea y que el historial se conserva).
 * @param {() => void} props.onClose - Cierra sin enviar.
 * @param {(reason: string) => Promise<{ok: boolean, message?: string, fieldError?: string}>} props.onSubmit - Envía.
 * @returns {import("react").ReactElement} Modal en portal.
 */
function AdminFileReasonDialog({ description = "", kind, onClose, onSubmit, subject }) {
  const copy = COPY[kind];
  const formId = useId();
  const titleId = `${formId}-title`;
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const focusInvalidField = useInvalidFieldFocus({ getContainer: () => document.getElementById(formId) });

  useDialogKeyboard({
    open: true,
    getContainer: () => document.querySelector(`[data-admin-file-reason="${kind}"]`),
    onEscape: () => {
      if (!submitting) onClose();
    },
    getInitialFocus: (elements) => elements.find((element) => element.matches("textarea")),
  });

  /**
   * Valida y envía el motivo recortado.
   *
   * @param {import("react").FormEvent} event - Envío.
   * @returns {Promise<void>}
   */
  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      setFieldError(copy.empty);
      focusInvalidField();
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    const result = await onSubmit(trimmed);
    if (result?.ok) return;
    setSubmitting(false);
    setFieldError(result?.fieldError || "");
    if (result?.fieldError) focusInvalidField();
    else setSubmitError(result?.message || "");
  }

  return (
    <Modal mount="viewport" visible onClose={submitting ? undefined : onClose} className="z-[110]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-admin-file-reason={kind}
        className="flex max-h-[calc(100dvh-32px)] w-full max-w-[400px] flex-col overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e2)]"
        onClick={(event) => event.stopPropagation()}
      >
        <form id={formId} className="relative flex min-h-0 flex-col gap-[8px] overflow-y-auto p-[16px]" onSubmit={handleSubmit} noValidate>
          <div className="absolute right-0 top-0">
            <ModalCloseButton disabled={submitting} ariaLabel={copy.close} onClick={onClose} />
          </div>
          <p id={titleId} className="sr-only">{copy.label}: {subject}</p>
          <TextArea
            label={copy.label}
            required
            showLabel
            showLabelInfo={false}
            value={reason}
            placeholder={copy.placeholder}
            state={fieldError ? "Error" : "Default"}
            showHint={false}
            aria-describedby={[fieldError ? `${formId}-error` : "", `${formId}-hint`, description ? `${formId}-description` : ""].filter(Boolean).join(" ")}
            disabled={submitting}
            maxLength={copy.maxLength}
            rows={kind === "reject" ? 4 : 5}
            // Rechazo (Figma 3727:683721): el modal mide 400 × 260 (cuerpo 187 y pie 73).
            minHeight={kind === "reject" ? 99 : undefined}
            className="max-w-none pr-[24px]"
            onChange={(event) => {
              setReason(event.target.value);
              setFieldError("");
              setSubmitError("");
            }}
          />
          {/* TextArea oculta su ayuda mientras tiene el foco y la muestra al perderlo: al pulsar
              «Enviar» el pie se desplazaba entre mousedown y mouseup y el clic no llegaba. La ayuda y el
              error, que recibe el foco, se muestran aquí con un alto estable y asociados al campo. */}
          {/* Rechazo (Figma 3727:683721): solo el campo; el archivo y el límite quedan para lectores de
              pantalla. La restauración, sin diseño propio, los muestra. */}
          <p id={`${formId}-hint`} className={kind === "reject" ? "sr-only" : "text-body-4 m-0 [overflow-wrap:anywhere] text-[var(--color-text-100)]"}>{subject} · Máximo {copy.maxLength} caracteres.</p>
          {description ? <p id={`${formId}-description`} className="text-body-3 m-0 text-[var(--color-text-200)]" data-admin-file-reason-description>{description}</p> : null}
          {fieldError ? <p id={`${formId}-error`} className="text-body-3 m-0 text-[var(--color-danger-100)]" role="alert">{fieldError}</p> : null}
          {submitError ? <p className="text-body-3 m-0 text-[var(--color-danger-100)]" role="alert">{submitError}</p> : null}
        </form>
        <footer className="flex items-center gap-[16px] border-t border-[var(--color-neutral-200)] p-[16px]">
          <Button theme="Primary" type="Outline" size="M" showLeftIcon={false} showRightIcon={false} disabled={submitting} className="!h-[41px] !w-full min-w-0 flex-1" onClick={onClose}>Volver</Button>
          <Button theme="Primary" type="Solid" size="M" showLeftIcon={false} showRightIcon={false} disabled={submitting} className="!h-[41px] !w-full min-w-0 flex-1" htmlType="submit" form={formId}>
            {submitting ? copy.submitting : copy.submit}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}

export default AdminFileReasonDialog;
