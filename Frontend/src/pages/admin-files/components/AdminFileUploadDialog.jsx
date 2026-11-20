import { useId, useState } from "react";

import { api } from "../../../api/http.js";
import Button from "../../../components/ui/Button/Button.jsx";
import FileUploadSection from "../../../components/ui/FileUploadSection/FileUploadSection.jsx";
import Modal, { ModalCloseButton } from "../../../components/ui/Modal/Modal.jsx";
import TextArea from "../../../components/ui/TextArea/TextArea.jsx";
import { useDialogKeyboard } from "../../../hooks/useDialogKeyboard.js";
import { formatStorage } from "../../../utils/fileMetrics.js";
import { useAdminFileUploadQueue } from "../hooks/useAdminFileUploadQueue.js";
import { CHANGE_NOTE_MAX_LENGTH, getFormatsLabel, getUploadAccept, getUploadExtension, validateUploadFile } from "../utils/adminFileUpload.js";

const COPY = Object.freeze({
  replace: { close: "Cerrar reemplazo de archivo", dismiss: "Cancelar", title: "Reemplazar archivo" },
  upload: { close: "Cerrar nuevo archivo", dismiss: "Cerrar", title: "Nuevo archivo" },
});

/**
 * Tarjeta de FileUploadSection para un elemento de la cola.
 *
 * @param {Object} item - Elemento de useAdminFileUploadQueue.
 * @param {Object} queue - Cola (acciones).
 * @returns {Object} Tarjeta.
 */
function toCard(item, queue) {
  const status = item.status === "failed" ? "failed" : item.status;
  return {
    completedLabel: item.notice || "Subido · Pendiente de revisión",
    currentSizeLabel: formatStorage(item.status === "completed" ? item.file.size : item.loaded, { maximumFractionDigits: 1 }),
    errorMessage: item.error,
    id: item.id,
    name: item.file.name,
    onRemove: item.status === "completed" ? undefined : () => queue.remove(item.id),
    onRetryUpload: item.status === "failed" && item.retryable ? () => queue.retry(item.id) : undefined,
    progress: item.progress,
    removeWhenFailed: true,
    status: status === "uploading" ? "uploading" : status,
    totalSizeLabel: formatStorage(item.file.size, { maximumFractionDigits: 1 }),
    type: getUploadExtension(item.file.name).toUpperCase() || "PDF",
    validationMessage: item.validationMessage,
  };
}

/**
 * Diálogo de carga de U3 (Figma 3727:683875 «Nuevo archivo» y 3727:683876 «Reemplazar archivo»):
 * zona para elegir o arrastrar, tarjetas con progreso, error y reintento, y «Confirmar». El
 * reemplazo añade el motivo obligatorio (B4), que Figma no dibuja y la API exige. Todo archivo o
 * versión subida queda pendiente de revisión; el aviso lo da la página con la respuesta confirmada.
 * Mientras una carga está en curso no se cierra: se cancela desde su tarjeta, y la cola reconcilia
 * con lo guardado si la carga llegó a registrarse.
 *
 * @param {Object} props - Modo, destino y callbacks.
 * @param {"upload"|"replace"} props.mode - Operación.
 * @param {{ project: Object, folder: Object }} [props.target] - Destino de «Nuevo archivo».
 * @param {{ projectId: number, fileId: number, name: string, folderSystemKey: string|null }} [props.file] - Archivo a reemplazar.
 * @param {(result: Object, meta: Object) => void} props.onUploaded - Carga confirmada.
 * @param {() => void} props.onClose - Cierra el diálogo.
 * @returns {import("react").ReactElement} Modal en portal.
 */
function AdminFileUploadDialog({ file, mode, onClose, onUploaded, target }) {
  const replacing = mode === "replace";
  const copy = COPY[mode];
  const formId = useId();
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState("");
  const folder = replacing ? { systemKey: file.folderSystemKey } : target.folder;
  const projectId = replacing ? file.projectId : target.project.id;
  const location = replacing ? `Archivo: ${file.name}` : `Dentro de: ${target.project.name} › ${target.folder.name}`;

  const queue = useAdminFileUploadQueue({
    onUploaded: (result, uploaded, meta) => onUploaded(result, { ...meta, file: uploaded }),
    reconcile: replacing ? reconcileReplacement : reconcileUpload,
    single: replacing,
    upload: (chosen, options) => (replacing
      ? api.fileManager.replaceVersion({ ...options, changeNote: note.trim(), file: chosen, fileId: file.fileId, projectId })
      : api.fileManager.uploadFile({ ...options, file: chosen, folderId: target.folder.id, projectId })),
    validate: (chosen, takenNames) => validateUploadFile(chosen, { folder, takenNames }),
  });

  /**
   * Comprueba si un archivo nuevo quedó registrado pese a la cancelación o a perder la respuesta.
   *
   * @param {File} chosen - Archivo.
   * @returns {Promise<Object|null>} `{file}` con la forma de la respuesta de subida, o null.
   */
  async function reconcileUpload(chosen) {
    const page = await api.fileManager.listItems({ folderId: target.folder.id, limit: 10, projectId, search: chosen.name, tab: "pending" });
    const saved = (page?.items || []).find((item) => item.name === chosen.name && item.versionNumber === 1);
    return saved ? { file: { id: saved.fileId, reviewStatus: saved.review.status, title: saved.name, versionId: saved.versionId } } : null;
  }

  /**
   * Comprueba si la versión nueva quedó registrada: la más reciente, pendiente y con este motivo.
   * Antes de la carga el archivo no tenía otra pendiente (la API la habría rechazado con 409).
   *
   * @returns {Promise<Object|null>} `{version}` o null.
   */
  async function reconcileReplacement() {
    const page = await api.fileManager.listVersions({ fileId: file.fileId, limit: 1, projectId });
    const latest = page?.versions?.[0];
    return latest?.review?.status === "pending" && latest.changeNote === note.trim() ? { version: latest } : null;
  }

  useDialogKeyboard({
    open: true,
    getContainer: () => document.querySelector(`[data-admin-file-upload="${mode}"]`),
    onEscape: () => {
      if (!queue.busy) onClose();
    },
  });

  /**
   * Inicia las cargas válidas; el reemplazo exige antes su motivo. Si todas quedan guardadas, el
   * diálogo se cierra (el aviso lo da la página); si alguna falla, sigue abierto con su error.
   *
   * @param {import("react").FormEvent} event - Envío.
   * @returns {Promise<void>}
   */
  async function handleSubmit(event) {
    event.preventDefault();
    if (queue.busy) return;
    if (replacing && !note.trim()) {
      setNoteError("Escribe el motivo del cambio.");
      document.getElementById(`${formId}-note`)?.focus();
      return;
    }
    if (await queue.start()) onClose();
  }

  const cards = queue.items.map((item) => toCard(item, queue));
  const done = queue.items.length > 0 && queue.items.every((item) => item.status === "completed");

  return (
    <Modal mount="viewport" visible onClose={queue.busy ? undefined : onClose} className="z-[110]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${formId}-title`}
        aria-describedby={`${formId}-location`}
        aria-busy={queue.busy || undefined}
        data-admin-file-upload={mode}
        className="flex max-h-[calc(100dvh-32px)] w-full max-w-[400px] flex-col overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e2)]"
        onClick={(event) => event.stopPropagation()}
      >
        <form id={formId} className="relative flex min-h-0 flex-col gap-[12px] overflow-y-auto p-[16px]" onSubmit={handleSubmit} noValidate>
          <div className="absolute right-0 top-0">
            <ModalCloseButton disabled={queue.busy} ariaLabel={copy.close} onClick={onClose} />
          </div>
          <div className="flex flex-col gap-[4px] pr-[28px]">
            <h2 id={`${formId}-title`} className="text-heading-6 m-0 text-[var(--color-text-300)]">{copy.title}</h2>
            <p id={`${formId}-location`} className="text-body-4 m-0 [overflow-wrap:anywhere] text-[var(--color-text-100)]">{location}</p>
          </div>
          {replacing ? (
            <div className="flex flex-col gap-[8px]">
              <TextArea
                id={`${formId}-note`}
                label="Motivo del cambio"
                required
                showLabel
                showLabelInfo={false}
                showHint={false}
                value={note}
                placeholder="Ej. «Se añade la firma del cliente.»"
                state={noteError ? "Error" : "Default"}
                disabled={queue.busy}
                maxLength={CHANGE_NOTE_MAX_LENGTH}
                rows={3}
                minHeight={88}
                className="max-w-none"
                aria-describedby={noteError ? `${formId}-note-error ${formId}-note-hint` : `${formId}-note-hint`}
                onChange={(event) => {
                  setNote(event.target.value);
                  setNoteError("");
                }}
              />
              {/* Ayuda y error fuera del TextArea: su ayuda aparece al perder el foco y desplazaría el pie. */}
              <p id={`${formId}-note-hint`} className="text-body-4 m-0 text-[var(--color-text-100)]">Máximo {CHANGE_NOTE_MAX_LENGTH} caracteres. Se muestra en el historial.</p>
              {noteError ? <p id={`${formId}-note-error`} className="text-body-3 m-0 text-[var(--color-danger-100)]" role="alert">{noteError}</p> : null}
            </div>
          ) : null}
          <FileUploadSection
            className="w-full"
            // Sin `disabled`: deshabilitaría también el botón que cancela la carga en curso. Lo que se
            // añade durante una carga entra en la misma cola (el reemplazo admite un solo archivo).
            files={cards}
            title={replacing ? "Archivo de la versión nueva" : "Archivos nuevos"}
            chooseFileLabel="Elige un archivo"
            separatorLabel="O"
            dropLabel="Arrastra y suelta"
            formatsLabel={getFormatsLabel(folder)}
            fileInputAccept={getUploadAccept(folder)}
            viewportHeight={null}
            fileListViewportHeight={220}
            showUploadedFiles={cards.length > 0}
            onFilesSelected={queue.add}
            aria-label={replacing ? "Elegir el archivo de la versión nueva" : "Elegir archivos para subir"}
          />
        </form>
        <footer className="flex items-center gap-[16px] border-t border-[var(--color-neutral-200)] p-[16px]">
          <Button theme="Primary" type="Outline" size="M" showLeftIcon={false} showRightIcon={false} disabled={queue.busy} className="!h-[41px] !w-full min-w-0 flex-1" onClick={onClose}>
            {done ? "Listo" : copy.dismiss}
          </Button>
          <Button theme="Primary" type="Solid" size="M" showLeftIcon={false} showRightIcon={false} disabled={queue.busy || !queue.uploadable} className="!h-[41px] !w-full min-w-0 flex-1" htmlType="submit" form={formId}>
            {queue.busy ? "Subiendo..." : "Confirmar"}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}

export default AdminFileUploadDialog;
