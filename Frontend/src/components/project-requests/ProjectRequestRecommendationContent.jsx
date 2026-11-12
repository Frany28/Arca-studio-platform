import { useEffect } from "react";
import { CloseCircle, InfoCircle, TickCircle } from "iconsax-react";

import Button from "../ui/Button/Button.jsx";
import HintText from "../ui/HintText/HintText.jsx";
import IconContainer from "../ui/IconContainer.jsx";
import { ModalCloseButton } from "../ui/Modal/Modal.jsx";
import TextArea from "../ui/TextArea/TextArea.jsx";
import { PROJECT_REQUEST_RECOMMENDATIONS, RECOMMENDATION_NOTE_LIMITS } from "../../utils/projectRequestRecommendations.js";
import MeetingRecommendationField from "./MeetingRecommendationField.jsx";

const ICONS = { approve: TickCircle, info: InfoCircle, reject: CloseCircle };
const FOOTER_BUTTON_CLASS_NAME = "h-[41px] min-w-0 flex-1";

/**
 * Modal de recomendación técnica del arquitecto (Figma 3727:618261 / 618383 / 618488 / 618593):
 * contenedor de 400 px, icono sólido, título h6, descripción b3, campo de 130 px con ejemplo y
 * ayuda, X y pie «Cerrar» / «Siguiente». «Siguiente» valida y pasa a la recomendación de reunión
 * (paso propio con `MeetingRecommendationField`, que Figma no dibuja), donde se guarda.
 * Solo presenta y notifica: el estado y el guardado los gestiona `ProjectRequestWorkflowModal`.
 * Al montar cada paso enfoca su primer control.
 *
 * @param {Object} props - Paso, recomendación, borradores, errores y callbacks.
 * @param {"reason"|"meeting"} props.step - Paso visible.
 * @param {"approve"|"reject"|"changes_requested"} props.recommendation - Recomendación elegida.
 * @param {import("react").RefObject<HTMLElement>} props.dialogRef - Contenedor del diálogo (teclado y foco).
 * @param {string} props.note - Justificación escrita.
 * @param {string} props.noteError - Error de la justificación.
 * @param {string|null} props.meetingRecommendation - Reunión elegida.
 * @param {string} props.meetingError - Error de la reunión.
 * @param {string} props.submitError - Error del guardado (servidor).
 * @param {boolean} props.submitting - Guardado en curso.
 * @param {(value: string) => void} props.onNoteChange - Cambia la justificación.
 * @param {(value: string) => void} props.onMeetingChange - Cambia la reunión.
 * @param {() => void} props.onClose - Cierra la recomendación sin guardar.
 * @param {() => void} props.onNext - Valida la justificación y pasa a la reunión.
 * @param {() => void} props.onBack - Vuelve a la justificación conservándola.
 * @param {() => void} props.onSubmit - Guarda la recomendación.
 * @returns {import("react").ReactElement} Diálogo.
 */
function ProjectRequestRecommendationContent({
  dialogRef,
  meetingError,
  meetingRecommendation,
  note,
  noteError,
  onBack,
  onClose,
  onMeetingChange,
  onNext,
  onNoteChange,
  onSubmit,
  recommendation,
  step,
  submitError,
  submitting,
}) {
  const copy = PROJECT_REQUEST_RECOMMENDATIONS[recommendation];
  const Icon = ICONS[copy.icon];
  const titleId = `project-request-recommendation-${step}-title`;
  const descriptionId = `project-request-recommendation-${step}-description`;
  const hintId = "project-request-recommendation-hint";

  useEffect(() => {
    // Cada paso empieza en su primer control: el campo de texto o la primera opción de reunión.
    const container = dialogRef.current;
    const target = step === "reason"
      ? container?.querySelector("textarea")
      : container?.querySelector("[role='group'] button");
    target?.focus({ preventScroll: true });
  }, [dialogRef, step]);

  return (
    <section
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="relative flex w-[400px] max-w-full flex-col overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e2)]"
      onClick={(event) => event.stopPropagation()}
    >
      <ModalCloseButton
        ariaLabel="Cerrar recomendación"
        className="absolute right-[8px] top-[8px]"
        disabled={submitting}
        onClick={onClose}
      />
      <div className="flex w-full flex-col items-center gap-[16px] p-[16px]">
        <IconContainer size="M" type={copy.iconType} icon={<Icon size="20" variant="Linear" color="currentColor" />} />
        <div className="flex w-full flex-col items-center gap-[4px]">
          <h2 id={titleId} className="text-heading-6 text-balance px-[24px] text-center text-[var(--color-text-300)]">
            {step === "reason" ? copy.title : "¿Recomiendas agendar una reunión?"}
          </h2>
          <p id={descriptionId} className="text-body-3 w-full text-[var(--color-text-200)]">
            {step === "reason"
              ? copy.description
              : "Indica si el administrador debería reunirse con el cliente antes de su decisión final."}
          </p>
          {step === "reason" ? (
            // La ayuda de Figma es permanente: TextArea la oculta con el foco y, al reaparecer, el
            // diálogo centrado cambiaría de alto bajo el puntero (un clic en X o Cerrar se perdería).
            <div className="flex w-full flex-col gap-[8px]">
              <TextArea
                className="!max-w-full w-full"
                showLabel={false}
                showHint={false}
                aria-label={copy.title}
                aria-describedby={hintId}
                placeholder={copy.placeholder}
                value={note}
                rows={4}
                minHeight={102}
                maxLength={RECOMMENDATION_NOTE_LIMITS.max}
                disabled={submitting}
                state={noteError ? "Error" : "Default"}
                onChange={(event) => onNoteChange(event.target.value)}
              />
              <HintText
                id={hintId}
                className="w-full"
                state={noteError ? "Error" : "Default"}
                hintText={noteError || copy.hint}
                role={noteError ? "alert" : undefined}
              />
            </div>
          ) : (
            <div className="flex w-full flex-col gap-[8px] pt-[8px]">
              <MeetingRecommendationField
                disabled={submitting}
                error={meetingError}
                value={meetingRecommendation}
                onChange={onMeetingChange}
              />
              {submitError ? <HintText state="Error" hintText={submitError} role="alert" className="w-full" /> : null}
            </div>
          )}
        </div>
      </div>
      <footer className="flex w-full gap-[16px] border-t border-[var(--color-neutral-200)] p-[16px]">
        <Button
          theme="Primary"
          type="Outline"
          size="S"
          showLeftIcon={false}
          showRightIcon={false}
          className={FOOTER_BUTTON_CLASS_NAME}
          disabled={submitting}
          onClick={step === "reason" ? onClose : onBack}
        >
          {step === "reason" ? "Cerrar" : "Volver"}
        </Button>
        <Button
          theme="Primary"
          type="Solid"
          size="S"
          showLeftIcon={false}
          showRightIcon={false}
          className={FOOTER_BUTTON_CLASS_NAME}
          disabled={submitting}
          aria-busy={submitting || undefined}
          onClick={step === "reason" ? onNext : onSubmit}
        >
          {step === "reason" ? "Siguiente" : submitting ? "Enviando..." : "Enviar"}
        </Button>
      </footer>
    </section>
  );
}

export default ProjectRequestRecommendationContent;
