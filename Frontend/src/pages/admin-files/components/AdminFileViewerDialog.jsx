import { useId, useState } from "react";

import { api } from "../../../api/http.js";
import DocumentFileCard from "../../../components/document-viewer/DocumentFileCard.jsx";
import { CloseIcon } from "../../../components/document-viewer/DocumentViewerControls.jsx";
import Button from "../../../components/ui/Button/Button.jsx";
import Modal from "../../../components/ui/Modal/Modal.jsx";
import { useDialogKeyboard } from "../../../hooks/useDialogKeyboard.js";
import { formatStorage } from "../../../utils/fileMetrics.js";
import { useAdminFileReviewOperations } from "../hooks/useAdminFileReviewOperations.js";
import { useAdminFileVersionContent } from "../hooks/useAdminFileVersionContent.js";
import { useAdminFileVersions } from "../hooks/useAdminFileVersions.js";
import { formatExtension, formatFileDate } from "../utils/adminFilesPresentation.js";
import { canLinkWarranties, describeRestoreResult, formatReviewStatus, getReplaceAvailability, getViewerKind } from "../utils/adminFileReview.js";
import { describeUploadResult } from "../utils/adminFileUpload.js";
import AdminFileReasonDialog from "./AdminFileReasonDialog.jsx";
import AdminFileUploadDialog from "./AdminFileUploadDialog.jsx";
import AdminFileVersionHistory from "./AdminFileVersionHistory.jsx";
import AdminFileVersionSurface from "./AdminFileVersionSurface.jsx";
import AdminFileWarrantyDialog from "./AdminFileWarrantyDialog.jsx";

const DEFAULT_VIEW = Object.freeze({ page: 1, zoom: 100 });

/**
 * Versión mostrada a partir de la fila de la tabla, mientras el historial no la trae.
 *
 * @param {Object} item - Fila (FileManagerItem).
 * @returns {Object} Versión con la forma del historial.
 */
function versionFromItem(item) {
  return {
    contentType: item.contentType,
    createdAt: item.createdAt,
    extension: item.extension,
    id: item.versionId,
    isCurrent: item.isCurrent,
    originalName: item.name,
    review: item.review,
    size: item.size,
    uploadedBy: item.uploadedBy,
    versionNumber: item.versionNumber,
  };
}

/**
 * Visor de una versión con revisión e historial (Figma 3727:683878 y 3952:187549). Se abre desde
 * el ojo (consulta) o desde «Revisar» (versión pendiente):
 *
 * - Cabecera con nombre, peso, fecha y autor de la versión mostrada; visor según su tipo.
 * - Una versión pendiente ofrece «Rechazar» (motivo obligatorio) y «Aprobar». El aviso de éxito
 *   lo redacta la página con la respuesta confirmada; aprobar no comparte con el cliente.
 * - El historial permite ver, descargar y restaurar versiones. Restaurar pide motivo, crea una
 *   versión nueva pendiente, conserva el historial y la muestra para revisarla.
 * - Los documentos de «Documentos › Garantías» ofrecen «Garantías» (vincular y desvincular, B8).
 *
 * Un conflicto que deja la vista desactualizada (versión ya revisada, otra pendiente) recarga tabla
 * e historial sin cerrar el visor y mantiene la versión mostrada.
 *
 * @param {Object} props - Fila abierta, modo y callbacks.
 * @param {Object} props.item - Fila de la tabla (FileManagerItem).
 * @param {HTMLElement|null} [props.returnFocusTo] - Control que abrió el visor.
 * @param {() => void} props.onClose - Cierra el visor.
 * @param {(review: { action: "approve"|"reject", result: Object, name: string }) => void} props.onReviewed - Revisión confirmada.
 * @param {() => void} props.onChanged - Recarga tabla y métricas.
 * @param {{ notify: Function }} props.feedback - Avisos de la página.
 * @param {{ download: Function, downloadingVersionId: number|null }} props.downloads - Descargas (useAdminFileVersionDownload).
 * @returns {import("react").ReactElement} Modal en portal.
 */
function AdminFileViewerDialog({ downloads, feedback, item, onChanged, onClose, onReviewed, returnFocusTo }) {
  const titleId = useId();
  const file = { fileId: item.fileId, projectId: item.project.id };
  const history = useAdminFileVersions(file);
  const [displayedVersionId, setDisplayedVersionId] = useState(item.versionId);
  const [views, setViews] = useState({});
  const [reasonDialog, setReasonDialog] = useState(null);
  const [warrantiesOpen, setWarrantiesOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const operations = useAdminFileReviewOperations({
    onStale: () => {
      history.reload();
      onChanged();
    },
  });

  const displayed = history.versions.find((version) => version.id === displayedVersionId)
    ?? (displayedVersionId === item.versionId ? versionFromItem(item) : history.versions[0] ?? versionFromItem(item));
  const kind = getViewerKind({ ...displayed, fileCategory: item.fileCategory });
  const versionRef = { ...file, name: displayed.originalName || item.name, versionId: displayed.id };
  const content = useAdminFileVersionContent(versionRef, kind);
  const view = views[displayed.id] || DEFAULT_VIEW;
  const pending = displayed.review?.status === "pending";
  const busy = Boolean(operations.pending);
  // El historial cargado decide si hay otra versión pendiente; mientras carga, se usa la fila.
  const replaceAvailability = getReplaceAvailability(displayed, history.versions);
  const downloading = downloads.downloadingVersionId === displayed.id;
  const displayName = displayed.originalName || item.name;

  useDialogKeyboard({
    open: !reasonDialog && !warrantiesOpen && !replaceOpen,
    getContainer: () => document.querySelector("[data-admin-file-viewer]"),
    onEscape: () => {
      if (!busy) onClose();
    },
    getInitialFocus: (elements) => elements.find((element) => ["Aprobar", "Cerrar"].includes(element.textContent?.trim())),
    getReturnFocus: returnFocusTo ? () => returnFocusTo : undefined,
  });

  /**
   * Descarga una versión: la mostrada reutiliza los bytes ya recibidos.
   *
   * @param {Object} version - Versión del historial.
   * @returns {void}
   */
  function downloadVersion(version) {
    const cached = version.id === displayed.id && content.blob ? { blob: content.blob, fileName: content.fileName } : null;
    downloads.download({ ...file, name: version.originalName || item.name, versionId: version.id }, cached);
  }

  /**
   * Aprueba la versión pendiente mostrada y entrega el resultado confirmado a la página.
   *
   * @returns {Promise<void>}
   */
  async function approve() {
    const outcome = await operations.approve({ ...file, versionId: displayed.id });
    if (!outcome.ok) return;
    onChanged();
    onReviewed({ action: "approve", name: displayName, result: outcome.result });
  }

  /**
   * Envía el motivo del diálogo abierto (rechazo o restauración).
   *
   * @param {string} reason - Motivo recortado.
   * @returns {Promise<{ok: boolean, message?: string, fieldError?: string}>} Resultado para el diálogo.
   */
  async function submitReason(reason) {
    const target = reasonDialog.version;
    if (reasonDialog.kind === "reject") {
      const outcome = await operations.reject({ ...file, versionId: target.id }, reason);
      if (outcome.ok) {
        setReasonDialog(null);
        onChanged();
        onReviewed({ action: "reject", name: displayName, result: outcome.result });
      }
      return outcome;
    }
    const outcome = await operations.restore({ ...file, versionId: target.id }, reason);
    if (outcome.ok) {
      const created = outcome.result?.version;
      setReasonDialog(null);
      history.reload();
      onChanged();
      if (created?.id) setDisplayedVersionId(created.id);
      feedback.notify("success", "Versión restaurada", describeRestoreResult(created, target), displayName);
    }
    return outcome;
  }

  /**
   * Versión nueva confirmada (o reconciliada): recarga historial, tabla y métricas, muestra la
   * versión creada (pendiente, con «Rechazar» y «Aprobar») y avisa de que queda pendiente.
   *
   * @param {{ version: Object }} result - Respuesta de la API.
   * @returns {void}
   */
  function handleReplaced(result) {
    const created = result?.version;
    history.reload();
    onChanged();
    if (created?.id) setDisplayedVersionId(created.id);
    const texts = describeUploadResult("replace", { name: item.name, versionNumber: created?.versionNumber });
    feedback.notify("success", texts.title, texts.description, item.name);
  }

  const header = {
    fileType: formatExtension(displayed.extension).replace(/^\./, "") || "Archivo",
    name: displayName,
    owner: displayed.uploadedBy?.name || "Sin autor",
    ownerAvatarSrc: "",
    size: displayed.size === null || displayed.size === undefined ? "—" : formatStorage(displayed.size, { maximumFractionDigits: 1 }),
    uploadedAt: formatFileDate(displayed.createdAt),
  };

  return (
    <>
      <Modal visible showDialog overlayVariant="blurred" transitionPreset="fade-scale" onClose={busy ? undefined : onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-busy={busy || undefined}
          data-admin-file-viewer
          className="@container flex max-h-[calc(100dvh-32px)] w-[1120px] max-w-full flex-col overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e2)]"
          onClick={(event) => event.stopPropagation()}
        >
          <h2 id={titleId} className="sr-only">{displayName}, versión {displayed.versionNumber}</h2>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto @min-[880px]:flex-row @min-[880px]:overflow-hidden">
            <div className="flex min-w-0 flex-1 flex-col">
              <DocumentFileCard document={header} keepExtension variant="modal" closeIcon={<CloseIcon />} onClose={busy ? undefined : onClose} />
              <p className="text-body-4 m-0 px-[16px] pb-[8px] text-[var(--color-text-100)]" data-admin-file-viewer-status>
                V{displayed.versionNumber} · {formatReviewStatus(displayed.review?.status)}
                {displayed.review?.status === "rejected" && displayed.review?.reason ? ` · Motivo: ${displayed.review.reason}` : ""}
              </p>
              <div className="px-[16px] pb-[16px]">
                <div className="h-[min(527px,calc(100dvh-280px))] min-h-[320px] overflow-hidden rounded-[var(--radius-3)]" aria-busy={content.status === "loading" || undefined}>
                  <AdminFileVersionSurface
                    kind={kind}
                    content={content}
                    src={api.fileManager.getVersionContentUrl(versionRef)}
                    title={displayName}
                    view={view}
                    onViewChange={(next) => setViews((current) => ({ ...current, [displayed.id]: next }))}
                    onDownload={() => downloadVersion(displayed)}
                    downloading={downloading}
                  />
                </div>
              </div>
            </div>
            <aside className="flex max-h-[360px] min-h-0 w-full shrink-0 flex-col border-t border-[var(--color-neutral-200)] p-[16px] @min-[880px]:max-h-none @min-[880px]:w-[312px] @min-[880px]:border-l @min-[880px]:border-t-0">
              <AdminFileVersionHistory
                history={history}
                displayedVersionId={displayed.id}
                actionsDisabled={busy}
                onView={(version) => {
                  operations.clearError();
                  setDisplayedVersionId(version.id);
                }}
                onDownload={downloadVersion}
                onRestore={(version) => setReasonDialog({ kind: "restore", version })}
              />
            </aside>
          </div>
          {operations.error ? <p role="alert" className="text-body-3 m-0 border-t border-[var(--color-neutral-200)] px-[16px] py-[12px] text-[var(--color-danger-100)]">{operations.error}</p> : null}
          <footer className="flex w-full flex-wrap items-center gap-[16px] border-t border-[var(--color-neutral-200)] p-[16px]">
            {pending ? (
              <>
                <Button theme="Danger" type="Outline" size="S" showLeftIcon={false} showRightIcon={false} disabled={busy} className="h-[41px] min-w-[140px] flex-1" onClick={() => setReasonDialog({ kind: "reject", version: displayed })}>
                  Rechazar
                </Button>
                <Button theme="Primary" type="Solid" size="S" showLeftIcon={false} showRightIcon={false} disabled={busy} aria-busy={operations.pending === "approve" || undefined} className="h-[41px] min-w-[140px] flex-1" onClick={approve}>
                  {operations.pending === "approve" ? "Aprobando..." : "Aprobar"}
                </Button>
              </>
            ) : (
              <>
                <Button theme="Primary" type="Outline" size="S" showLeftIcon={false} showRightIcon={false} disabled={busy} className="h-[41px] min-w-[140px] flex-1" onClick={onClose}>
                  Cerrar
                </Button>
                <Button
                  theme="Primary"
                  type="Solid"
                  size="S"
                  showLeftIcon={false}
                  showRightIcon={false}
                  disabled={busy || !replaceAvailability.allowed}
                  tooltip={replaceAvailability.allowed ? "Subir una versión nueva" : replaceAvailability.reason}
                  aria-label={replaceAvailability.allowed ? "Reemplazar" : `Reemplazar. ${replaceAvailability.reason}`}
                  className="h-[41px] min-w-[140px] flex-1"
                  onClick={() => setReplaceOpen(true)}
                >
                  Reemplazar
                </Button>
                {canLinkWarranties(item) ? (
                  <Button theme="Primary" type="Solid" size="S" showLeftIcon={false} showRightIcon={false} disabled={busy} className="h-[41px] min-w-[140px] flex-1" onClick={() => setWarrantiesOpen(true)}>
                    Garantías
                  </Button>
                ) : null}
              </>
            )}
          </footer>
        </div>
      </Modal>
      {reasonDialog ? (
        <AdminFileReasonDialog
          key={`${reasonDialog.kind}-${reasonDialog.version.id}`}
          kind={reasonDialog.kind}
          subject={`${displayName} · V${reasonDialog.version.versionNumber}`}
          onClose={() => setReasonDialog(null)}
          onSubmit={submitReason}
        />
      ) : null}
      {replaceOpen ? (
        <AdminFileUploadDialog
          mode="replace"
          file={{ ...file, folderSystemKey: item.folder?.section === "cover" ? "cover" : null, name: item.name }}
          onUploaded={handleReplaced}
          onClose={() => setReplaceOpen(false)}
        />
      ) : null}
      {warrantiesOpen ? <AdminFileWarrantyDialog file={{ ...file, name: displayName }} onClose={() => setWarrantiesOpen(false)} /> : null}
    </>
  );
}

export default AdminFileViewerDialog;
