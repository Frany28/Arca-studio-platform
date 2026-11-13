import { useEffect, useRef, useState } from "react";

import Button from "../ui/Button/Button.jsx";
import { api } from "../../api/http.js";
import { DIALOG_FOCUSABLE_SELECTOR, useDialogKeyboard } from "../../hooks/useDialogKeyboard.js";
import { useInvalidFieldFocus } from "../../hooks/useInvalidFieldFocus.js";
import { TickCircle } from "iconsax-react";

import Modal, { ModalDialog } from "../ui/Modal/Modal.jsx";
import { ProjectDocumentViewerModal } from "../../pages/projects/components/ProjectDocumentPreview.jsx";
import { isPdfAttachment, toAttachmentViewerDocument } from "../../utils/projectRequestAttachments.js";
import { getProjectRequestStatus } from "../../utils/projectRequestStatus.js";
import {
  PROJECT_REQUEST_RECOMMENDATIONS,
  PROJECT_REQUEST_RECOMMENDATION_ORDER,
  describeRecommendationNoteError,
} from "../../utils/projectRequestRecommendations.js";
import { PROJECT_REQUEST_CHANGES_REQUESTED_REASON } from "../../utils/projectRequestContactLinks.js";
import { hasOutdatedReviews } from "../../utils/projectRequestOutdatedReviews.js";
import ProjectRequestClientContactContent from "./ProjectRequestClientContactContent.jsx";
import ProjectRequestOutdatedApprovalContent from "./ProjectRequestOutdatedApprovalContent.jsx";
import ProjectRequestRecommendationContent from "./ProjectRequestRecommendationContent.jsx";
import ProjectRequestRejectionContent from "./ProjectRequestRejectionContent.jsx";

// Mismo orden, textos y estilos que la barra de acciones de la consulta administrativa.
const OPTIONS = [
  { id: "reject", label: "Rechazar", theme: "Danger", type: "Outline" },
  { id: "changes_requested", label: "Solicitar más información", theme: "Info", type: "Outline" },
  { id: "approve", label: "Aprobar", theme: "Primary", type: "Solid" },
];

function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" className="size-3" aria-hidden="true">
      <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Modal de revisión técnica o decisión administrativa de una solicitud.
 * Decisión: «Solicitar más información» (Figma 3727:677375) muestra `ProjectRequestClientContactContent`
 * con el contacto real y «Finalizar» como mutación; «Aprobar» pide confirmación con el diálogo
 * estándar centrado en verde (`ModalDialog`, Figma 2061:24296) y, aprobada la solicitud
 * (`completedAction`), muestra «Solicitud Aprobada» (3727:677374) con el contacto del cliente;
 * «Rechazar» muestra `ProjectRequestRejectionContent`. Si las revisiones técnicas son anteriores a los
 * últimos cambios relevantes (`hasOutdatedReviews`), «Aprobar» muestra
 * `ProjectRequestOutdatedApprovalContent`, que exige confirmación explícita y justificación.
 * La reunión exige selección explícita en revisión y nunca se envía desde una decisión administrativa.
 * Revisión del arquitecto (Figma Dashboard ARQ 3727:618270): el detalle ofrece «Recomendar rechazo»,
 * «Recomendar solicitar más información» y «Recomendar aprobación»; cada una abre su modal
 * (`ProjectRequestRecommendationContent`): justificación → reunión → guardado de la recomendación.
 * Cerrar o X vuelve al detalle sin guardar; un error del guardado conserva el borrador.
 * `initialAction` solo preselecciona la opción al montar; el consumidor debe cambiar
 * la `key` del modal para reiniciar la selección entre aperturas.
 * Teclado (`useDialogKeyboard`): enfoca el motivo, mantiene Tab dentro del diálogo, cierra con
 * Escape salvo durante el guardado y devuelve el foco al disparador. Mientras el visor de PDF
 * está abierto, el visor gestiona su propio teclado.
 *
 * @param {Object} props - Solicitud, modo, estado del envío y callbacks.
 * @param {string} [props.initialAction] - approve, reject o changes_requested. Sin valor, el modal
 * de decisión muestra el detalle con las tres acciones; cada una abre su modal propio.
 * @param {string|null} [props.completedAction] - Decisión ya confirmada que el modal sigue mostrando
 * («approve» → «Solicitud Aprobada»).
 * @returns {import("react").ReactElement|null} Modal o null sin solicitud.
 */
/**
 * Control que recibe el foco al abrir o cambiar de modal: el motivo cuando existe; si no,
 * «Cancelar», la opción segura de las confirmaciones (como `StatusConfirmationModal`).
 *
 * @param {HTMLElement[]} elements - Controles enfocables del diálogo.
 * @returns {HTMLElement|undefined} Control preferido, o undefined para usar el primero.
 */
function getPreferredFocus(elements) {
  return elements.find((element) => element.tagName === "TEXTAREA")
    ?? elements.find((element) => element.textContent?.trim() === "Cancelar");
}

function ProjectRequestWorkflowModal({
  completedAction = null,
  error = "",
  initialAction,
  mode = "review",
  onClose,
  onSubmit,
  open,
  projectRequest,
  submitting = false,
}) {
  // Decisión sin acción explícita: null muestra el selector. La revisión parte de «approve» y
  // `openRecommendation` fija la recomendación elegida.
  const [action, setAction] = useState(
    OPTIONS.some((option) => option.id === initialAction) ? initialAction : mode === "review" ? "approve" : null,
  );
  const [note, setNote] = useState("");
  const [localError, setLocalError] = useState("");
  const [meetingRecommendation, setMeetingRecommendation] = useState(null);
  const [meetingError, setMeetingError] = useState("");
  // Revisión del arquitecto: null (detalle), "reason" (justificación) o "meeting" (reunión).
  const [reviewStep, setReviewStep] = useState(null);
  // El documento se conserva al cerrar para que el visor complete su animación de salida.
  const [pdfViewer, setPdfViewer] = useState({ document: null, open: false });
  const pdfTriggerRef = useRef(null);
  // El contenido del Modal es el área desplazable (contentClassName); el diálogo es el contenedor.
  const dialogRef = useRef(null);
  const focusInvalidField = useInvalidFieldFocus({ getContainer: () => dialogRef.current });
  /**
   * Cierra el modal de recomendación sin guardar y vuelve al detalle de la solicitud.
   *
   * @returns {void}
   */
  const closeRecommendation = () => {
    setReviewStep(null);
    setNote("");
    setLocalError("");
    setMeetingRecommendation(null);
    setMeetingError("");
  };
  useEffect(() => {
    // Al cambiar de modal (desde el selector o al completar la aprobación) el botón pulsado
    // desaparece: el foco pasa al control preferido del modal nuevo. Las aperturas directas las
    // enfoca el hook de teclado.
    if (mode !== "decision" || !action || (initialAction && !completedAction)) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const elements = Array.from(dialogRef.current?.querySelectorAll(DIALOG_FOCUSABLE_SELECTOR) ?? []);
      (getPreferredFocus(elements) ?? elements[0])?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [action, completedAction, initialAction, mode]);
  useDialogKeyboard({
    getContainer: () => dialogRef.current,
    getInitialFocus: getPreferredFocus,
    onEscape: () => {
      if (submitting) return;
      // Escape retrocede un paso dentro de la recomendación antes de cerrar la revisión.
      if (reviewStep === "meeting") setReviewStep("reason");
      else if (reviewStep === "reason") closeRecommendation();
      else onClose?.();
    },
    open: Boolean(open && projectRequest) && !pdfViewer.open,
  });

  if (!projectRequest) return null;

  const openPdfViewer = (event, file) => {
    pdfTriggerRef.current = event.currentTarget;
    setPdfViewer({ document: toAttachmentViewerDocument(file, projectRequest.id), open: true });
  };
  const closePdfViewer = () => setPdfViewer((current) => ({ ...current, open: false }));

  const status = getProjectRequestStatus(projectRequest.status);

  /**
   * Abre el modal de la recomendación elegida en el detalle, con su borrador vacío.
   *
   * @param {"approve"|"reject"|"changes_requested"} recommendation - Recomendación del arquitecto.
   * @returns {void}
   */
  const openRecommendation = (recommendation) => {
    setAction(recommendation);
    setReviewStep("reason");
  };

  /**
   * Valida la justificación (10–2000 caracteres, como el backend) y pasa a la reunión.
   *
   * @returns {void}
   */
  const goToMeeting = () => {
    const noteError = describeRecommendationNoteError(note);
    setLocalError(noteError);
    if (noteError) {
      dialogRef.current?.querySelector("textarea")?.focus();
      return;
    }
    setReviewStep("meeting");
  };

  /**
   * Guarda la recomendación con el contrato de revisión existente. No cambia el estado de la
   * solicitud: el backend solo registra la revisión del arquitecto asignado.
   *
   * @returns {Promise<void>}
   */
  const submitRecommendation = async () => {
    if (submitting) return;
    if (!meetingRecommendation) {
      setMeetingError("Selecciona una recomendación de reunión.");
      // La navegación a errores enfoca la primera opción del grupo inválido.
      focusInvalidField();
      return;
    }
    await onSubmit?.({ action, meetingRecommendation, note: note.trim() });
  };

  const handleModalClose = () => {
    if (submitting) return;
    if (reviewStep) closeRecommendation();
    else onClose?.();
  };
  // Decisión administrativa: el rechazo exige el motivo escrito; aprobar no lleva nota y «Solicitar
  // más información» envía el motivo estándar (el administrador contacta al cliente desde el modal).
  // La revisión del arquitecto se guarda con `submitRecommendation` y nunca usa esta ruta.
  const requiresReason = action !== "approve";
  const submit = async (noteOverride) => {
    if (submitting) return;
    const normalizedNote = (typeof noteOverride === "string" ? noteOverride : note).trim();
    if (requiresReason && normalizedNote.length < 10) {
      // Solo el administrador llega aquí: el texto habla de su decisión, nunca de una recomendación.
      setLocalError("Explica el motivo de tu decisión con al menos 10 caracteres.");
      focusInvalidField();
      return;
    }
    setLocalError("");
    await onSubmit?.({ action, note: normalizedNote });
    // El error del guardado se muestra en el campo «Motivo» (prop `error`): se navega a él. Tras un
    // guardado correcto el modal se cierra y no queda contenedor, así que no ocurre nada.
    focusInvalidField();
  };

  return (
    <Modal
      mount="viewport"
      visible={open}
      onClose={submitting ? undefined : handleModalClose}
      contentClassName="max-h-dvh overflow-y-auto"
    >
      {mode === "review" && reviewStep ? (
        <ProjectRequestRecommendationContent
          key={reviewStep}
          dialogRef={dialogRef}
          step={reviewStep}
          recommendation={action}
          note={note}
          noteError={localError}
          meetingRecommendation={meetingRecommendation}
          meetingError={meetingError}
          submitError={error}
          submitting={submitting}
          onNoteChange={(value) => {
            setNote(value);
            setLocalError("");
          }}
          onMeetingChange={(value) => {
            setMeetingRecommendation(value);
            setMeetingError("");
          }}
          onClose={closeRecommendation}
          onNext={goToMeeting}
          onBack={() => setReviewStep("reason")}
          onSubmit={submitRecommendation}
        />
      ) : mode === "decision" && completedAction === "approve" ? (
        // Figma 3727:677374: la solicitud ya está aprobada; el contacto ayuda a coordinar la reunión
        // inicial. Ambas acciones solo cierran: la decisión ya se guardó.
        <ProjectRequestClientContactContent
          dialogRef={dialogRef}
          onCancel={onClose}
          onFinalize={onClose}
          open={open}
          projectRequest={projectRequest}
          purpose="approve"
          submitting={false}
        />
      ) : mode === "decision" && action === "changes_requested" ? (
        // Figma 3727:677375: solo contacto; «Finalizar» envía el motivo estándar.
        <ProjectRequestClientContactContent
          dialogRef={dialogRef}
          error={error}
          onCancel={onClose}
          onFinalize={() => submit(PROJECT_REQUEST_CHANGES_REQUESTED_REASON)}
          open={open}
          projectRequest={projectRequest}
          purpose="changes_requested"
          submitting={submitting}
        />
      ) : mode === "decision" && action === "approve" && hasOutdatedReviews(projectRequest) ? (
        // Revisiones anteriores a los últimos cambios: aprobar es una excepción explícita, justificada y auditada.
        <ProjectRequestOutdatedApprovalContent
          dialogRef={dialogRef}
          error={error}
          onCancel={onClose}
          onConfirm={(justification) => onSubmit?.({
            acknowledgeOutdatedReviews: true,
            action: "approve",
            note: "",
            outdatedReviewsJustification: justification,
          })}
          projectRequest={projectRequest}
          submitting={submitting}
        />
      ) : mode === "decision" && action === "approve" ? (
        // Confirmación con el diálogo estándar de Modal (Figma 2061:24296, Centered) en verde, como
        // `StatusConfirmationModal`. Al confirmar se aprueba y se muestra «Solicitud Aprobada».
        <ModalDialog
          dialogRef={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="project-request-approval-title"
          aria-describedby="project-request-approval-description"
          aria-busy={submitting || undefined}
          alignment="Centered"
          closeButtonAriaLabel="Cerrar aprobación de solicitud"
          icon={<TickCircle size="20" color="currentColor" className="size-5 text-[var(--color-success-200)]" aria-hidden="true" />}
          title={<span id="project-request-approval-title">¿Deseas aprobar la solicitud?</span>}
          description={(
            <span id="project-request-approval-description">
              Se creará el borrador interno del proyecto {projectRequest.projectName ? `«${projectRequest.projectName}» ` : ""}y
              el cliente verá su solicitud aprobada. Luego podrás coordinar el primer contacto.
              {error ? (
                <span role="alert" className="mt-[4px] block text-[var(--color-danger-100)] [overflow-wrap:anywhere]">
                  {error}
                </span>
              ) : null}
            </span>
          )}
          secondaryActionLabel="Cancelar"
          primaryActionLabel={submitting ? "Aprobando..." : "Aprobar"}
          secondaryActionTheme="Success"
          primaryActionTheme="Success"
          actionsDisabled={submitting}
          primaryActionBusy={submitting}
          onClose={onClose}
          onSecondaryAction={onClose}
          onPrimaryAction={() => submit("")}
        />
      ) : mode === "decision" && action === "reject" ? (
        <ProjectRequestRejectionContent
          dialogRef={dialogRef}
          error={localError || error}
          note={note}
          onCancel={onClose}
          onConfirm={submit}
          onNoteChange={(value) => {
            setNote(value);
            setLocalError("");
          }}
          submitting={submitting}
        />
      ) : (
      // La revisión del arquitecto mide 680 px para que sus tres recomendaciones quepan en una fila (Figma).
      // overflow-wrap se hereda: nombre, descripción, ubicación, notas y archivos largos se cortan dentro del diálogo.
      <section
        ref={dialogRef}
        className={`relative flex w-full ${mode === "review" ? "max-w-[680px]" : "max-w-[620px]"} flex-col gap-[20px] [overflow-wrap:anywhere] rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] p-[24px] shadow-[var(--shadow-e2)]`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-request-workflow-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Cerrar revisión de solicitud"
          disabled={submitting}
          onClick={onClose}
          className="absolute right-[16px] top-[16px] inline-flex size-9 items-center justify-center rounded-[var(--radius-2)] text-[var(--color-text-100)] hover:bg-[var(--color-neutral-200)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-300)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CloseIcon />
        </button>

        <header className="flex flex-col gap-[4px] pr-[40px]">
          <span className="text-body-4 text-[var(--color-text-100)]">{status.label}</span>
          <h2 id="project-request-workflow-title" className="text-heading-5 text-[var(--color-text-300)]">
            {projectRequest.projectName}
          </h2>
          <p className="text-body-3 text-[var(--color-text-200)]">
            {projectRequest.description || "La solicitud no incluye una descripción."}
          </p>
          <p className="text-body-4 text-[var(--color-text-100)]">
            {projectRequest.location}
          </p>
        </header>

        {projectRequest.reviews?.length ? (
          <div className="flex flex-col gap-[8px] rounded-[var(--radius-2)] bg-[var(--color-neutral-200)]/40 p-[12px]">
            <h3 className="text-body-3 text-[var(--color-text-300)]">Revisiones registradas</h3>
            {projectRequest.reviews.map((review) => (
              <p key={`${review.reviewer?.id}-${review.updatedAt}`} className="text-body-4 text-[var(--color-text-200)]">
                {review.reviewer?.name}: {review.note}
              </p>
            ))}
          </div>
        ) : null}

        {projectRequest.files?.length ? (
          <div className="flex flex-col gap-[8px]">
            <h3 className="text-body-3 text-[var(--color-text-300)]">Archivos adjuntos</h3>
            <ul className="flex flex-col gap-[4px]">
              {projectRequest.files.map((file) => (
                <li key={file.id}>
                  {isPdfAttachment(file) ? (
                    // Los PDF se ven dentro de ARCA Studio; el backend los sirve como descarga.
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      onClick={(event) => openPdfViewer(event, file)}
                      className="text-left text-body-4 text-[var(--color-primary-300)] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-300)]"
                    >
                      {file.name}
                    </button>
                  ) : (
                    <a
                      href={api.projectRequests.getFileContentUrl({
                        fileId: file.id,
                        projectRequestId: projectRequest.id,
                      })}
                      target="_blank"
                      rel="noreferrer"
                      className="text-body-4 text-[var(--color-primary-300)] underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-300)]"
                    >
                      {file.name}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {mode === "review" ? (
          // Figma 3727:618270: Rechazo (Danger Outline), Más información (Info Outline), Aprobación (Primary Solid).
          <footer className="flex flex-col-reverse gap-[8px] min-[640px]:flex-row min-[640px]:flex-wrap min-[640px]:justify-end" role="group" aria-label="Recomendación técnica">
            {PROJECT_REQUEST_RECOMMENDATION_ORDER.map((recommendation) => {
              const option = PROJECT_REQUEST_RECOMMENDATIONS[recommendation];
              return (
                <Button
                  key={recommendation}
                  theme={option.buttonTheme}
                  type={option.buttonType}
                  size="M"
                  fitContent
                  showLeftIcon={false}
                  showRightIcon={false}
                  className="max-[639px]:w-full"
                  disabled={submitting}
                  aria-haspopup="dialog"
                  onClick={() => openRecommendation(recommendation)}
                >
                  {option.buttonLabel}
                </Button>
              );
            })}
          </footer>
        ) : null}

        {mode === "review" ? null : (
        // Selector de decisión (se abre sin acción, p. ej. desde el aviso de inicio de sesión): cada
        // acción abre su modal propio, igual que la barra de la consulta. No hay campos aquí.
        <div className="grid grid-cols-1 gap-[8px] min-[600px]:grid-cols-3" role="group" aria-label="Decisión de la solicitud">
          {OPTIONS.map((option) => (
            <Button
              key={option.id}
              theme={option.theme}
              type={option.type}
              size="S"
              showLeftIcon={false}
              showRightIcon={false}
              disabled={submitting}
              aria-haspopup="dialog"
              onClick={() => setAction(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        )}

        {mode === "review" ? null : (
        <footer className="flex justify-end">
          <Button theme="Primary" type="Outline" size="M" fitContent disabled={submitting} onClick={onClose}>
            Cancelar
          </Button>
        </footer>
        )}

        {/* Dentro de la sección: los eventos del portal no llegan a la capa del modal y no lo cierran. */}
        {pdfViewer.document ? (
          <ProjectDocumentViewerModal
            commentsEnabled={false}
            document={pdfViewer.document}
            open={pdfViewer.open}
            onClose={closePdfViewer}
            triggerRef={pdfTriggerRef}
          />
        ) : null}
      </section>
      )}
    </Modal>
  );
}

export default ProjectRequestWorkflowModal;
