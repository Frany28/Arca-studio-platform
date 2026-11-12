import { CloseCircle } from "iconsax-react";

import Button from "../ui/Button/Button.jsx";
import HintText from "../ui/HintText/HintText.jsx";
import IconContainer from "../ui/IconContainer.jsx";
import { ModalCloseButton } from "../ui/Modal/Modal.jsx";
import TextArea from "../ui/TextArea/TextArea.jsx";

const FOOTER_BUTTON_CLASS_NAME = "h-[41px] min-w-0 flex-1";
const HINT_ID = "project-request-rejection-hint";

/**
 * Modal administrativo «Rechazar solicitud». Figma ADMIN no dibuja este paso, así que replica el
 * modal de rechazo del arquitecto (3727:618488): 400 px, icono Danger sólido, título, descripción,
 * campo de motivo con ayuda permanente y pie «Cancelar» / «Rechazar». Es una decisión del
 * administrador: el texto nunca habla de recomendación y el motivo se comunica al cliente.
 * Solo presenta y notifica; la validación y el guardado los gestiona `ProjectRequestWorkflowModal`.
 *
 * @param {Object} props - Borrador, error, estado del envío y callbacks.
 * @param {import("react").RefObject<HTMLElement>} props.dialogRef - Contenedor del diálogo (teclado y foco).
 * @param {string} props.error - Error de validación o del servidor.
 * @param {string} props.note - Motivo escrito.
 * @param {() => void} props.onCancel - Cierra sin guardar.
 * @param {() => void} props.onConfirm - Valida y guarda el rechazo.
 * @param {(value: string) => void} props.onNoteChange - Cambia el motivo.
 * @param {boolean} props.submitting - Guardado en curso.
 * @returns {import("react").ReactElement} Diálogo.
 */
function ProjectRequestRejectionContent({ dialogRef, error = "", note, onCancel, onConfirm, onNoteChange, submitting }) {
  return (
    <section
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-request-rejection-title"
      aria-describedby="project-request-rejection-description"
      className="relative flex w-[400px] max-w-full flex-col overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e2)]"
      onClick={(event) => event.stopPropagation()}
    >
      <ModalCloseButton
        ariaLabel="Cerrar rechazo de solicitud"
        className="absolute right-[8px] top-[8px]"
        disabled={submitting}
        onClick={onCancel}
      />
      <div className="flex w-full flex-col items-center gap-[16px] p-[16px]">
        <IconContainer size="M" type="DangerSolid" icon={<CloseCircle size="20" variant="Linear" color="currentColor" />} />
        <div className="flex w-full flex-col items-center gap-[4px]">
          <h2 id="project-request-rejection-title" className="text-heading-6 text-balance px-[24px] text-center text-[var(--color-text-300)]">
            ¿Deseas rechazar la solicitud?
          </h2>
          <p id="project-request-rejection-description" className="text-body-3 w-full text-[var(--color-text-200)]">
            La solicitud quedará cerrada y el cliente recibirá el motivo del rechazo.
          </p>
          {/* Ayuda permanente fuera del campo: si apareciera y desapareciera con el foco, el diálogo
              centrado cambiaría de alto bajo el puntero y un clic en X o Cancelar se perdería. */}
          <div className="flex w-full flex-col gap-[8px]">
            <TextArea
              className="!max-w-full w-full"
              showLabel={false}
              showHint={false}
              aria-label="Motivo del rechazo"
              aria-describedby={HINT_ID}
              placeholder={"Ej. \"El presupuesto disponible no cubre el alcance solicitado.\""}
              value={note}
              rows={4}
              minHeight={102}
              maxLength={2000}
              disabled={submitting}
              state={error ? "Error" : "Default"}
              onChange={(event) => onNoteChange(event.target.value)}
            />
            <HintText
              id={HINT_ID}
              className="w-full"
              state={error ? "Error" : "Default"}
              hintText={error || "Explica al cliente por qué se rechaza su solicitud (mínimo 10 caracteres)."}
              role={error ? "alert" : undefined}
            />
          </div>
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
          onClick={onCancel}
        >
          Cancelar
        </Button>
        <Button
          theme="Danger"
          type="Solid"
          size="S"
          showLeftIcon={false}
          showRightIcon={false}
          className={FOOTER_BUTTON_CLASS_NAME}
          disabled={submitting}
          aria-busy={submitting || undefined}
          onClick={onConfirm}
        >
          {submitting ? "Rechazando..." : "Rechazar"}
        </Button>
      </footer>
    </section>
  );
}

export default ProjectRequestRejectionContent;
