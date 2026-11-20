import { useState } from "react";

import Button from "../../../components/ui/Button/Button.jsx";
import Input from "../../../components/ui/Input/Input.jsx";
import Modal, { ModalCloseButton } from "../../../components/ui/Modal/Modal.jsx";
import { useDialogKeyboard } from "../../../hooks/useDialogKeyboard.js";
import { useInvalidFieldFocus } from "../../../hooks/useInvalidFieldFocus.js";

// Mismo límite que la API (validation/fileManagerSchemas.js).
export const FOLDER_NAME_MAX_LENGTH = 120;
const FORM_ID = "admin-file-folder-form";
const COPY = {
  create: { close: "Cerrar formulario de nueva carpeta", submit: "Crear", submitting: "Creando...", title: "Nueva carpeta" },
  rename: { close: "Cerrar formulario para renombrar la carpeta", submit: "Guardar", submitting: "Guardando...", title: "Renombrar carpeta" },
};

/**
 * Formulario de carpeta del árbol: crear una subcarpeta o renombrar una personalizada. Figma no
 * diseña este modal; reutiliza el patrón Modal + Input de «Nueva unidad de medida». Conserva lo
 * escrito ante un error, lo señala junto al campo (nombre repetido) o bajo el formulario
 * (conflictos) y bloquea el envío mientras la petición está en curso.
 *
 * @param {Object} props - Diálogo abierto y callbacks.
 * @param {{mode: "create"|"rename", project: Object, parent: Object|null, folder: Object|null}} props.dialog - Contexto.
 * @param {() => void} props.onClose - Cierra sin guardar.
 * @param {(name: string) => Promise<{ok: boolean, message?: string, fieldError?: string}>} props.onSubmit - Envía.
 * @returns {import("react").ReactElement} Modal en portal.
 */
function AdminFileFolderDialog({ dialog, onClose, onSubmit }) {
  const renaming = dialog.mode === "rename";
  const copy = COPY[renaming ? "rename" : "create"];
  const [name, setName] = useState(renaming ? dialog.folder.name : "");
  const [fieldError, setFieldError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const focusInvalidField = useInvalidFieldFocus({ getContainer: () => document.getElementById(FORM_ID) });
  const location = renaming ? dialog.project.name : `${dialog.project.name} › ${dialog.parent.name}`;

  useDialogKeyboard({
    open: true,
    getContainer: () => document.querySelector("[data-admin-file-folder-dialog]"),
    onEscape: () => {
      if (!submitting) onClose();
    },
    getInitialFocus: (elements) => elements.find((element) => element.matches("input[type='text']")),
  });

  /**
   * Valida y envía el nombre recortado.
   *
   * @param {import("react").FormEvent} event - Envío del formulario.
   * @returns {Promise<void>}
   */
  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setFieldError("Escribe el nombre de la carpeta.");
      focusInvalidField();
      return;
    }
    if (renaming && trimmed === dialog.folder.name) {
      onClose();
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
    <Modal mount="viewport" visible onClose={submitting ? undefined : onClose} className="z-[100]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-file-folder-title"
        aria-describedby="admin-file-folder-location"
        data-admin-file-folder-dialog
        className="flex max-h-[calc(100dvh-32px)] w-full max-w-[400px] flex-col overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e2)]"
        onClick={(event) => event.stopPropagation()}
      >
        <form id={FORM_ID} className="relative flex min-h-0 flex-col gap-[16px] overflow-y-auto p-[16px]" onSubmit={handleSubmit} noValidate>
          <div className="absolute right-0 top-0">
            <ModalCloseButton disabled={submitting} ariaLabel={copy.close} onClick={onClose} />
          </div>
          <div className="flex flex-col gap-[4px] pr-[28px]">
            <h2 id="admin-file-folder-title" className="text-heading-6 m-0 text-[var(--color-text-300)]">{copy.title}</h2>
            <p id="admin-file-folder-location" className="text-body-4 m-0 truncate text-[var(--color-text-100)]" title={location}>
              {renaming ? `Proyecto: ${location}` : `Dentro de: ${location}`}
            </p>
          </div>
          <Input
            type="Default input"
            size="M"
            label="Nombre de la carpeta"
            required
            showLabel
            showLabelInfo={false}
            showLeftIcon={false}
            showRightIcon={false}
            value={name}
            placeholder="Ej. Planos aprobados"
            state={fieldError ? "Error" : "Default"}
            showHint
            hintText={fieldError || `Máximo ${FOLDER_NAME_MAX_LENGTH} caracteres.`}
            disabled={submitting}
            maxLength={FOLDER_NAME_MAX_LENGTH}
            onChange={(event) => {
              setName(event.target.value);
              setFieldError("");
              setSubmitError("");
            }}
            className="max-w-none"
            autoComplete="off"
          />
          {submitError ? <p className="text-body-3 m-0 text-[var(--color-danger-100)]" role="alert">{submitError}</p> : null}
        </form>

        <footer className="flex items-center gap-[16px] border-t border-[var(--color-neutral-200)] p-[16px]">
          <Button theme="Primary" type="Outline" size="M" showLeftIcon={false} showRightIcon={false} disabled={submitting} className="!h-[41px] !w-full min-w-0 flex-1" onClick={onClose}>Cancelar</Button>
          <Button theme="Primary" type="Solid" size="M" showLeftIcon={false} showRightIcon={false} disabled={submitting} className="!h-[41px] !w-full min-w-0 flex-1" htmlType="submit" form={FORM_ID}>
            {submitting ? copy.submitting : copy.submit}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}

export default AdminFileFolderDialog;
