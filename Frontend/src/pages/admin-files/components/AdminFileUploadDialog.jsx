import { useId, useState } from "react";

import { api } from "../../../api/http.js";
import Button from "../../../components/ui/Button/Button.jsx";
import { getFolderDestinationPath } from "../utils/adminFilesPresentation.js";
import AdminFileDestinationPath from "./AdminFileDestinationPath.jsx";
import FileUploadSection from "../../../components/ui/FileUploadSection/FileUploadSection.jsx";
import Input from "../../../components/ui/Input/Input.jsx";
import Modal, { ModalCloseButton } from "../../../components/ui/Modal/Modal.jsx";
import { MODAL_DARK_CONTRAST, MODAL_INSET_BORDER, MODAL_INSET_DIVIDER } from "../../../components/ui/Modal/modalConfig.js";
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
 * @param {() => void} [closeAfterRetry] - Cierra el reemplazo si se confirma en el reintento.
 * @returns {Object} Tarjeta.
 */
function toCard(item, queue, closeAfterRetry) {
  const status = item.status === "failed" ? "failed" : item.status;
  return {
    completedLabel: item.notice || "Subido · Pendiente de revisión",
    currentSizeLabel: formatStorage(item.status === "completed" ? item.file.size : item.loaded, { maximumFractionDigits: 1 }),
    errorMessage: item.error,
    id: item.id,
    name: item.file.name,
    onRemove: item.status === "completed" ? undefined : () => queue.remove(item.id),
    onRetryUpload: item.status === "failed" && item.retryable ? async () => {
      if (await queue.retry(item.id)) closeAfterRetry?.();
    } : undefined,
    progress: item.progress,
    removeWhenFailed: true,
    status: status === "uploading" ? "uploading" : status,
    totalSizeLabel: formatStorage(item.file.size, { maximumFractionDigits: 1 }),
    type: getUploadExtension(item.file.name).toUpperCase() || "PDF",
    validationMessage: item.validationMessage,
  };
}

// Placeholder literal del campo «Motivo del cambio» en Figma 3727:683111.
const CHANGE_NOTE_PLACEHOLDER = "Ej. “Falta firma del cliente, Datos actualizados, etc.”";

/**
 * Diálogo de carga de U3 (Figma 3727:683875 «Nuevo archivo» y 3727:683111 «Reemplazar archivo»):
 * zona para elegir o arrastrar, tarjetas con progreso, error y reintento, y «Confirmar». El
 * reemplazo sigue Figma: título, zona de carga y, debajo, el campo de una línea «Motivo del
 * cambio *» (obligatorio, ≤255, lo exige la API), con 4 px entre bloques; el archivo que se
 * reemplaza se anuncia a los lectores de pantalla en la descripción del diálogo. Lo abren
 * «Reemplazar» del visor, el «+» del drawer «Historial de versiones» y «Más opciones» de la tabla.
 * Todo archivo o versión subida queda pendiente de revisión; el aviso lo da la página con la
 * respuesta confirmada.
 * Mientras una carga está en curso no se cierra: se cancela desde su tarjeta, y la cola reconcilia
 * con lo guardado si la carga llegó a registrarse.
 *
 * @param {Object} props - Modo, destino y callbacks.
 * @param {"upload"|"replace"} props.mode - Operación.
 * @param {{ project: Object, folder: Object|null }} [props.target] - Destino fijo de «Nuevo archivo»: la
 *   ubicación abierta al abrir el diálogo (`folder` null: raíz del proyecto). No se puede cambiar.
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
  // Destino de una subida nueva: la ubicación abierta en el árbol (la raíz del proyecto o la carpeta
  // abierta), fijada por la página al abrir el diálogo en `target`. No hay selector: el diálogo no
  // la cambia, un cambio posterior del árbol no la altera y nunca se reubica por formato.
  const destinationFolder = replacing ? null : target.folder ?? null;
  // «Proyecto/Carpeta/Subcarpeta»: la misma ruta que muestra el diálogo (AdminFileDestinationPath).
  const destinationPath = replacing ? "" : getFolderDestinationPath(target.project, destinationFolder);
  const folder = replacing ? { systemKey: file.folderSystemKey } : destinationFolder;
  const projectId = replacing ? file.projectId : target.project.id;

  const queue = useAdminFileUploadQueue({
    // El nombre es único por carpeta: un conflicto se explica con la ubicación de destino.
    location: replacing ? "" : destinationFolder ? `«${destinationPath}»` : `la raíz de «${target.project.name}»`,
    // `destination`: ubicación de destino para el aviso (la ruta o la raíz del proyecto).
    onUploaded: (result, uploaded, meta) => onUploaded(result, {
      ...meta,
      destination: destinationFolder ? destinationPath : `${target?.project?.name ?? ""} (raíz del proyecto)`,
      file: uploaded,
    }),
    reconcile: replacing ? reconcileReplacement : reconcileUpload,
    single: replacing,
    upload: (chosen, options) => (replacing
      ? api.fileManager.replaceVersion({ ...options, changeNote: note.trim(), file: chosen, fileId: file.fileId, projectId })
      : api.fileManager.uploadFile({ ...options, file: chosen, folderId: destinationFolder?.id ?? null, projectId })),
    validate: (chosen, takenNames) => validateUploadFile(chosen, { folder, takenNames }),
  });

  /**
   * Comprueba si un archivo nuevo quedó registrado pese a la cancelación o a perder la respuesta.
   *
   * @param {File} chosen - Archivo.
   * @returns {Promise<Object|null>} `{file}` con la forma de la respuesta de subida, o null.
   */
  async function reconcileUpload(chosen) {
    const page = await api.fileManager.listItems({ folderId: destinationFolder?.id ?? null, limit: 10, projectId, search: chosen.name, tab: "pending" });
    const saved = (page?.items || []).find((item) => item.name === chosen.name && item.versionNumber === 1);
    return saved ? { file: { id: saved.fileId, reviewStatus: saved.review.status, title: saved.name, versionId: saved.versionId } } : null;
  }

  /**
   * Comprueba si la versión más reciente y pendiente coincide con el archivo y el motivo.
   * Antes de la carga el archivo no tenía otra pendiente (la API la habría rechazado con 409).
   *
   * @param {File} chosen - Archivo de la transferencia que perdió la respuesta.
   * @returns {Promise<Object|null>} `{version}` o null.
   */
  async function reconcileReplacement(chosen) {
    const page = await api.fileManager.listVersions({ fileId: file.fileId, limit: 1, projectId });
    const latest = page?.versions?.[0];
    const matches = latest?.review?.status === "pending" && latest.changeNote === note.trim()
      && latest.originalName === chosen.name.trim() && latest.size === chosen.size;
    return matches ? { version: latest } : null;
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

  const cards = queue.items.map((item) => toCard(item, queue, replacing ? onClose : undefined));
  const done = queue.items.length > 0 && queue.items.every((item) => item.status === "completed");

  return (
    <Modal mount="viewport" visible onClose={queue.busy ? undefined : onClose} className="z-[110]" dialogShellClassName={replacing ? "!pb-0" : undefined}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${formId}-title`}
        aria-describedby={`${formId}-location`}
        aria-busy={queue.busy || undefined}
        data-admin-file-upload={mode}
        className={`flex max-h-[calc(100dvh-32px)] w-full max-w-[400px] flex-col overflow-hidden rounded-[var(--radius-3)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e2)] ${replacing
          ? `${MODAL_INSET_BORDER} ${MODAL_DARK_CONTRAST}`
          : "border border-[var(--color-neutral-200)]"}`}
        onClick={(event) => event.stopPropagation()}
      >
        <form id={formId} className={`relative flex min-h-0 flex-col overflow-y-auto p-[16px] ${replacing ? "gap-[4px]" : "gap-[12px]"}`} onSubmit={handleSubmit} noValidate>
          <div className="absolute right-0 top-0">
            <ModalCloseButton className={replacing ? "[&>svg]:size-[18px]" : undefined} disabled={queue.busy} ariaLabel={copy.close} onClick={onClose} />
          </div>
          <div className="flex flex-col gap-[4px] pr-[28px]">
            <h2 id={`${formId}-title`} className="text-heading-6 m-0 text-[var(--color-text-300)]">{copy.title}</h2>
            {/* Figma 3727:683111 no muestra el archivo reemplazado: queda en la descripción accesible. */}
            {replacing
              ? <p id={`${formId}-location`} className="sr-only">{`Archivo: ${file.name}`}</p>
              : <AdminFileDestinationPath id={`${formId}-location`} project={target.project} folder={destinationFolder} />}
          </div>
          <FileUploadSection
            className={replacing ? "w-full shrink-0 [&_[data-file-upload-dropzone]]:pt-[30px]" : "w-full"}
            // Sin `disabled`: deshabilitaría también el botón que cancela la carga en curso. Lo que se
            // añade durante una carga entra en la misma cola (el reemplazo admite un solo archivo).
            files={cards}
            title={replacing ? "Archivo de la versión nueva" : "Archivos nuevos"}
            chooseFileLabel="Elige un archivo"
            separatorLabel="O"
            dropLabel="Arrastra y suelta"
            formatsLabel={getFormatsLabel(folder, { compact: replacing })}
            fileInputAccept={getUploadAccept(folder)}
            singleFile={replacing}
            fitContent={replacing}
            dropzoneVariant={replacing ? "project" : undefined}
            viewportHeight={null}
            fileListViewportHeight={replacing ? null : 220}
            showUploadedFiles={cards.length > 0}
            onFilesSelected={queue.add}
            aria-label={replacing ? "Elegir el archivo de la versión nueva" : "Elegir archivos para subir"}
          />
          {replacing ? (
            <div className="flex flex-col gap-[8px]">
              <Input
                id={`${formId}-note`}
                type="Default input"
                size="S"
                label="Motivo del cambio"
                required
                showLabel
                showLabelInfo={false}
                showHint={false}
                showLeftIcon={false}
                showRightIcon={false}
                value={note}
                placeholder={CHANGE_NOTE_PLACEHOLDER}
                state={noteError ? "Error" : "Default"}
                disabled={queue.busy}
                maxLength={CHANGE_NOTE_MAX_LENGTH}
                // El campo de Figma mide 35 px. El borde interior de Input cuenta dentro de su padding.
                className="w-full max-w-none [&_[data-input-shell]]:min-h-0 [&_[data-input-shell]>div]:min-h-0 [&_[data-input-shell]>div]:py-[7px]"
                aria-invalid={noteError ? true : undefined}
                aria-describedby={noteError ? `${formId}-note-error` : undefined}
                onChange={(event) => {
                  setNote(event.target.value);
                  setNoteError("");
                }}
              />
              {/* El error va fuera del Input para no desplazar el pie mientras se escribe. */}
              {noteError ? <p id={`${formId}-note-error`} className="text-body-3 m-0 text-[var(--color-danger-100)]" role="alert">{noteError}</p> : null}
            </div>
          ) : null}
        </form>
        <footer className={`flex shrink-0 items-center gap-[16px] p-[16px] ${replacing ? MODAL_INSET_DIVIDER : "border-t border-[var(--color-neutral-200)]"}`}>
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
