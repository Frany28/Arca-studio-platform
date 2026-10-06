import { useState } from "react";

import Button from "../ui/Button/Button.jsx";
import { api } from "../../api/http.js";
import Modal from "../ui/Modal/Modal.jsx";
import TextArea from "../ui/TextArea/TextArea.jsx";
import { getProjectRequestStatus } from "../../utils/projectRequestStatus.js";

const OPTIONS = [
  { id: "changes_requested", label: "Solicitar correcciones" },
  { id: "reject", label: "Rechazar" },
  { id: "approve", label: "Aprobar" },
];

function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" className="size-3" aria-hidden="true">
      <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}

function ProjectRequestWorkflowModal({
  error = "",
  mode = "review",
  onClose,
  onSubmit,
  open,
  projectRequest,
  submitting = false,
}) {
  const [action, setAction] = useState("approve");
  const [note, setNote] = useState("");
  const [localError, setLocalError] = useState("");

  if (!projectRequest) return null;

  const status = getProjectRequestStatus(projectRequest.status);
  const requiresReason = mode === "review" || action !== "approve";
  const submit = async () => {
    const normalizedNote = note.trim();
    if (requiresReason && normalizedNote.length < 10) {
      setLocalError("Explica la recomendación o decisión con al menos 10 caracteres.");
      return;
    }
    setLocalError("");
    await onSubmit?.({ action, note: normalizedNote });
  };

  return (
    <Modal
      mount="viewport"
      visible={open}
      onClose={submitting ? undefined : onClose}
      contentClassName="max-h-dvh overflow-y-auto"
    >
      <section
        className="relative flex w-full max-w-[620px] flex-col gap-[20px] rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] p-[24px] shadow-[var(--shadow-e2)]"
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
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-[8px] min-[600px]:grid-cols-3" role="group" aria-label="Resultado de la revisión">
          {OPTIONS.map((option) => (
            <Button
              key={option.id}
              theme={option.id === "reject" ? "Danger" : "Primary"}
              type={action === option.id ? "Solid" : "Outline"}
              size="S"
              showLeftIcon={false}
              showRightIcon={false}
              disabled={submitting}
              onClick={() => setAction(option.id)}
            >
              {option.label}
            </Button>
          ))}
        </div>

        <TextArea
          label={mode === "decision" && action === "approve" ? "Nota interna (opcional)" : "Motivo"}
          required={requiresReason}
          showLabelInfo={false}
          showHint={Boolean(localError || error)}
          hintText={localError || error}
          state={localError || error ? "Error" : "Default"}
          value={note}
          disabled={submitting}
          maxLength={mode === "decision" ? 4000 : 2000}
          onChange={(event) => setNote(event.target.value)}
        />

        <footer className="flex flex-col-reverse gap-[8px] min-[480px]:flex-row min-[480px]:justify-end">
          <Button theme="Primary" type="Outline" size="M" fitContent disabled={submitting} onClick={onClose}>
            Cancelar
          </Button>
          <Button
            theme={action === "reject" ? "Danger" : "Primary"}
            type="Solid"
            size="M"
            fitContent
            disabled={submitting}
            onClick={submit}
          >
            {submitting ? "Guardando..." : mode === "decision" ? "Confirmar decisión" : "Guardar revisión"}
          </Button>
        </footer>
      </section>
    </Modal>
  );
}

export default ProjectRequestWorkflowModal;
