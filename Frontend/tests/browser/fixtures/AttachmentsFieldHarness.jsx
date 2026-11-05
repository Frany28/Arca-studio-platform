import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import Button from "../../../src/components/ui/Button/Button.jsx";
import Modal from "../../../src/components/ui/Modal/Modal.jsx";
import { useInvalidFieldFocus } from "../../../src/hooks/useInvalidFieldFocus.js";
import ProjectRequestAttachmentsField from "../../../src/pages/project-request/components/ProjectRequestAttachmentsField.jsx";
import useProjectRequestFiles from "../../../src/pages/project-request/hooks/useProjectRequestFiles.js";
import { getProjectRequestFileErrors } from "../../../src/utils/projectRequestValidation.js";
import "../../../src/index.css";

// Arnés del campo de adjuntos real (useProjectRequestFiles + ProjectRequestAttachmentsField) con
// el mismo envío que ProjectRequestPage: valida los archivos y pide la navegación a errores.
// `layout=modal` lo monta en un Modal con el formulario como área desplazable; `draft=1` simula un
// borrador en curso, que admite agregar nuevas selecciones.
const params = new URLSearchParams(window.location.search);
const layout = params.get("layout") || "page";
const draftId = params.get("draft") === "1" ? 99 : null;
window.attachmentsHarness = { submissions: 0 };

/**
 * Campo y envío compartidos por ambas variantes.
 *
 * @param {{formId: string, getContainer: () => ParentNode|null, formRef?: Object, className: string}} props - Contenedor.
 * @returns {import("react").ReactElement} Formulario.
 */
function AttachmentsForm({ className, formId, formRef, getContainer }) {
  const [, setShowRequiredAlert] = useState(false);
  const files = useProjectRequestFiles({ currentFieldErrors: {}, draftId, hasAttemptedSubmit: false, setShowRequiredAlert });
  const focusInvalidField = useInvalidFieldFocus({ getContainer });

  /**
   * Mismo flujo que handleFrontendSubmit de la solicitud: valida y navega o «envía».
   *
   * @param {import("react").FormEvent} event - Envío.
   * @returns {void}
   */
  function submit(event) {
    event.preventDefault();
    const errors = getProjectRequestFileErrors(files.files);
    files.setFileErrors(errors);
    if (errors.length) {
      focusInvalidField();
      return;
    }
    window.attachmentsHarness.submissions += 1;
  }

  return (
    <form id={formId} ref={formRef} noValidate className={className} onSubmit={submit}>
      <h1 className="text-heading-5">Referencias</h1>
      <div aria-hidden="true" className="h-[700px] shrink-0" data-spacer />
      <ProjectRequestAttachmentsField
        disabled={false}
        fileErrors={files.fileErrors}
        files={files.files}
        onFilesSelected={files.handleFilesChange}
        onRemove={files.removeFile}
      />
      <p data-file-count>{`${files.files.length} archivos`}</p>
    </form>
  );
}

/** Formulario en la página: el documento es el área desplazable. */
export function PageLayout() {
  const formRef = useRef(null);
  return (
    <main className="mx-auto max-w-[720px] p-[16px]">
      <AttachmentsForm formId="attachments-form" formRef={formRef} getContainer={() => formRef.current} className="flex flex-col gap-[24px]" />
      <Button theme="Primary" type="Solid" size="M" htmlType="submit" form="attachments-form" showLeftIcon={false} showRightIcon={false}>Enviar</Button>
    </main>
  );
}

/** Formulario en Modal (portal y bloqueo de scroll) con scroll interno. */
export function ModalLayout() {
  return (
    <>
      <main className="p-[16px]"><div aria-hidden="true" className="h-[2400px]" data-page-spacer /></main>
      <Modal mount="viewport" visible className="z-[100]">
        <div role="dialog" aria-modal="true" aria-label="Adjuntos en modal" className="flex max-h-[calc(100dvh-32px)] w-full max-w-[560px] flex-col overflow-hidden rounded-[var(--radius-3)] border bg-[var(--color-neutral-100)]">
          <AttachmentsForm formId="attachments-form" getContainer={() => document.getElementById("attachments-form")} className="flex min-h-0 flex-col gap-[24px] overflow-y-auto p-[16px]" />
          <footer className="border-t p-[16px]">
            <Button theme="Primary" type="Solid" size="M" htmlType="submit" form="attachments-form" showLeftIcon={false} showRightIcon={false}>Enviar</Button>
          </footer>
        </div>
      </Modal>
    </>
  );
}

const Layout = layout === "modal" ? ModalLayout : PageLayout;
createRoot(document.getElementById("root")).render(<Layout />);
