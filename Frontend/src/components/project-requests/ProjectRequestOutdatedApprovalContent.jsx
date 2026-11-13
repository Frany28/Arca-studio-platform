import { useState } from "react";
import { Warning2 } from "iconsax-react";

import Button from "../ui/Button/Button.jsx";
import Checkbox from "../ui/Checkbox.jsx";
import HintText from "../ui/HintText/HintText.jsx";
import IconContainer from "../ui/IconContainer.jsx";
import { ModalCloseButton } from "../ui/Modal/Modal.jsx";
import TextArea from "../ui/TextArea/TextArea.jsx";
import { describeOutdatedReviews, OUTDATED_JUSTIFICATION_MIN_LENGTH } from "../../utils/projectRequestOutdatedReviews.js";

const FOOTER_BUTTON_CLASS_NAME = "h-[41px] min-w-0 flex-1";
const CONFIRM_LABEL = "Confirmo que apruebo sin una revisión técnica actualizada";
const HINT_ID = "project-request-outdated-approval-hint";

/**
 * Aprobación de una solicitud cuyas revisiones técnicas son anteriores a los últimos cambios
 * relevantes de la solicitud. Sustituye a la confirmación simple de «Aprobar»: explica el riesgo
 * y solo habilita «Aprobar de todos modos» con la confirmación explícita y una justificación de
 * 10–2000 caracteres, que el backend exige y audita junto con la decisión. «Cancelar» cierra sin
 * aprobar (el camino recomendado es pedir una revisión actualizada). Mismo armazón de 400 px que
 * `ProjectRequestRejectionContent`; solo presenta y notifica, sin llamar a la API.
 *
 * @param {Object} props - Solicitud, error, envío y callbacks.
 * @param {import("react").RefObject<HTMLElement>} props.dialogRef - Contenedor del diálogo (teclado y foco).
 * @param {string} [props.error=""] - Error del servidor.
 * @param {() => void} props.onCancel - Cierra sin aprobar.
 * @param {(justification: string) => void} props.onConfirm - Aprueba con la excepción justificada.
 * @param {Object} props.projectRequest - Solicitud con `reviews[].outdated`.
 * @param {boolean} props.submitting - Guardado en curso.
 * @returns {import("react").ReactElement} Diálogo.
 */
function ProjectRequestOutdatedApprovalContent({ dialogRef, error = "", onCancel, onConfirm, projectRequest, submitting }) {
  const [confirmed, setConfirmed] = useState(false);
  const [justification, setJustification] = useState("");
  const [localError, setLocalError] = useState("");
  const shownError = localError || error;

  /**
   * Valida la confirmación y la justificación antes de aprobar.
   *
   * @returns {void}
   */
  const confirm = () => {
    const normalized = justification.trim();
    if (normalized.length < OUTDATED_JUSTIFICATION_MIN_LENGTH) {
      setLocalError(`Justifica la aprobación con al menos ${OUTDATED_JUSTIFICATION_MIN_LENGTH} caracteres.`);
      dialogRef.current?.querySelector("textarea")?.focus();
      return;
    }
    setLocalError("");
    onConfirm(normalized);
  };

  return (
    <section
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-request-outdated-approval-title"
      aria-describedby="project-request-outdated-approval-description"
      aria-busy={submitting || undefined}
      className="relative flex w-[400px] max-w-full flex-col overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e2)]"
      onClick={(event) => event.stopPropagation()}
    >
      <ModalCloseButton
        ariaLabel="Cerrar aprobación de solicitud"
        className="absolute right-[8px] top-[8px]"
        disabled={submitting}
        onClick={onCancel}
      />
      <div className="flex w-full flex-col items-center gap-[16px] p-[16px]">
        <IconContainer size="M" type="Outline" icon={<Warning2 size="20" color="currentColor" className="text-[var(--color-warning-200)]" />} />
        <div className="flex w-full flex-col items-center gap-[8px]">
          <h2 id="project-request-outdated-approval-title" className="text-heading-6 text-balance px-[24px] text-center text-[var(--color-text-300)]">
            Las revisiones técnicas están desactualizadas
          </h2>
          <p id="project-request-outdated-approval-description" className="text-body-3 w-full text-center text-[var(--color-text-200)]">
            {describeOutdatedReviews(projectRequest)} Lo recomendable es pedir una revisión actualizada antes de aprobar.
          </p>
          <label className="flex w-full items-start gap-[12px] text-left">
            <Checkbox
              checked={confirmed ? "Yes" : "No"}
              size="S"
              interactive
              disabled={submitting}
              aria-label={CONFIRM_LABEL}
              onCheckedChange={(next) => setConfirmed(next === "Yes")}
            />
            <span className="text-body-3 text-[var(--color-text-300)]">{CONFIRM_LABEL}</span>
          </label>
          <div className="flex w-full flex-col gap-[8px]">
            <TextArea
              className="!max-w-full w-full"
              showLabel={false}
              showHint={false}
              aria-label="Justificación de la aprobación"
              aria-describedby={HINT_ID}
              placeholder={"Ej. \"El cliente confirmó el nuevo presupuesto en la reunión.\""}
              value={justification}
              rows={3}
              minHeight={84}
              maxLength={2000}
              disabled={submitting || !confirmed}
              state={shownError ? "Error" : "Default"}
              onChange={(event) => {
                setJustification(event.target.value);
                setLocalError("");
              }}
            />
            <HintText
              id={HINT_ID}
              className="w-full"
              state={shownError ? "Error" : "Default"}
              hintText={shownError || "La justificación queda registrada en la auditoría de la decisión."}
              role={shownError ? "alert" : undefined}
            />
          </div>
        </div>
      </div>
      <footer className="flex w-full gap-[16px] border-t border-[var(--color-neutral-200)] p-[16px]">
        <Button theme="Primary" type="Outline" size="S" showLeftIcon={false} showRightIcon={false} className={FOOTER_BUTTON_CLASS_NAME} disabled={submitting} onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          theme="Success"
          type="Solid"
          size="S"
          showLeftIcon={false}
          showRightIcon={false}
          className={FOOTER_BUTTON_CLASS_NAME}
          disabled={submitting || !confirmed}
          aria-busy={submitting || undefined}
          onClick={confirm}
        >
          {submitting ? "Aprobando..." : "Aprobar de todos modos"}
        </Button>
      </footer>
    </section>
  );
}

export default ProjectRequestOutdatedApprovalContent;
