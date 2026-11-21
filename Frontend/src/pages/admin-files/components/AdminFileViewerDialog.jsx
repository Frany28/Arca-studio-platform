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
import { canLinkWarranties, describeRestoreResult, formatDisplayedVersionSuffix, getReplaceAvailability, getViewerKind } from "../utils/adminFileReview.js";
import { describeUploadResult } from "../utils/adminFileUpload.js";
import AdminFileReasonDialog from "./AdminFileReasonDialog.jsx";
import AdminFileUploadDialog from "./AdminFileUploadDialog.jsx";
import AdminFileVersionHistory from "./AdminFileVersionHistory.jsx";
import AdminFileVersionSurface from "./AdminFileVersionSurface.jsx";
import AdminFileWarrantyDialog from "./AdminFileWarrantyDialog.jsx";

const DEFAULT_VIEW = Object.freeze({ page: 1, zoom: 100 });

// Composición de Figma: escritorio 3727:682849 (modal 3727:682968 de 790 px centrado y drawer
// 3934:182047 de 312 px a la derecha, a toda altura), tablet 3952:187549 (el modal ocupa la columna
// izquierda con 24 px de margen y toda la altura) y móvil 3953:297003 (modal arriba y el historial
// como hoja inferior, todo con desplazamiento vertical). El margen izquierdo centra el modal en la
// ventana mientras cabe junto al drawer: (100% - 790) / 2, limitado por 100% - 312 - 790 - 16.
const VIEWER_LAYOUT = "flex h-dvh w-screen flex-col overflow-y-auto overscroll-contain min-[768px]:flex-row min-[768px]:overflow-hidden";
const MODAL_AREA = "flex shrink-0 p-[16px] min-[768px]:min-h-0 min-[768px]:min-w-0 min-[768px]:flex-1 min-[768px]:items-center min-[768px]:py-[24px] min-[768px]:pr-[16px] min-[768px]:pl-[max(24px,min(calc((100%_-_790px)_/_2),calc(100%_-_1118px)))] min-[768px]:max-[1279px]:items-stretch min-[768px]:max-[1279px]:pr-[24px]";
const MODAL_BOX = "flex w-[790px] max-w-full flex-col overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e2)] min-[768px]:max-h-full";
// Área del documento: 527 px en escritorio (Figma), 213 px en móvil y toda la altura libre en tablet.
const DOCUMENT_AREA = "h-[527px] min-h-[200px] max-[767px]:h-[213px] max-[767px]:min-h-0 min-[768px]:max-h-[calc(100dvh-211px)] min-[768px]:max-[1279px]:h-auto min-[768px]:max-[1279px]:max-h-none min-[768px]:max-[1279px]:flex-1";
const DRAWER = "flex w-full flex-1 flex-col rounded-t-[var(--radius-3)] bg-[var(--color-neutral-100)] p-[16px] shadow-[var(--shadow-e2)] min-[768px]:h-full min-[768px]:w-[312px] min-[768px]:flex-none min-[768px]:overflow-y-auto min-[768px]:overscroll-contain min-[768px]:rounded-t-none min-[768px]:rounded-l-[var(--radius-3)]";

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
 * Visor de una versión (modal Figma 3727:682968) con el drawer «Historial de versiones» (Figma
 * 3934:182047) en la misma capa modal. Se abre desde el ojo (consulta) o desde «Revisar» (versión
 * pendiente, variante 3727:683878 con X y «Rechazar»/«Aprobar»):
 *
 * - Cabecera con nombre, peso, fecha y autor de la versión mostrada (y «V3 · Aprobada» si no es la
 *   vigente); visor según su tipo. La consulta termina con «Cerrar» y «Reemplazar».
 * - Una versión pendiente ofrece «Rechazar» (motivo obligatorio) y «Aprobar». El aviso de éxito
 *   lo redacta la página con la respuesta confirmada; aprobar no comparte con el cliente.
 * - El drawer permite ver, descargar y restaurar versiones; su «+» abre el mismo reemplazo que
 *   «Reemplazar». Restaurar pide motivo, crea una versión nueva pendiente, conserva el historial y
 *   la muestra para revisarla.
 * - Los documentos de «Documentos › Garantías» ofrecen «Garantías» (vincular y desvincular, B8).
 * - Pulsar fuera del modal y del drawer, Escape o «Cerrar» cierran el visor (salvo con una
 *   operación en curso).
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

  const versionSuffix = formatDisplayedVersionSuffix(displayed);
  const uploadedAt = formatFileDate(displayed.createdAt);
  const header = {
    fileType: formatExtension(displayed.extension).replace(/^\./, "") || "Archivo",
    name: displayName,
    owner: displayed.uploadedBy?.name || "Sin autor",
    ownerAvatarSrc: "",
    size: displayed.size === null || displayed.size === undefined ? "—" : formatStorage(displayed.size, { maximumFractionDigits: 1 }),
    uploadedAt: versionSuffix ? `${uploadedAt} • ${versionSuffix}` : uploadedAt,
  };
  const closeIfIdle = () => {
    if (!busy) onClose();
  };
  /**
   * Cierra al pulsar el fondo de la composición (el overlay real queda debajo), no sus paneles.
   *
   * @param {import("react").MouseEvent} event - Clic.
   * @returns {void}
   */
  const closeOnBackdrop = (event) => {
    if (event.target === event.currentTarget) closeIfIdle();
  };

  return (
    <>
      <Modal visible showDialog overlayVariant="blurred" transitionPreset="fade-scale" dialogShellClassName="!pb-0" contentClassName="!p-0" onClose={busy ? undefined : onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-busy={busy || undefined}
          data-admin-file-viewer
          className={VIEWER_LAYOUT}
          onClick={closeOnBackdrop}
        >
          <h2 id={titleId} className="sr-only">{displayName}, versión {displayed.versionNumber}</h2>
          <div className={MODAL_AREA} onClick={closeOnBackdrop}>
            <div className={MODAL_BOX} data-admin-file-modal>
              <DocumentFileCard document={header} keepExtension variant="modal" closeIcon={<CloseIcon />} onClose={pending && !busy ? onClose : undefined} />
              <div className="flex min-h-0 flex-1 flex-col px-[16px] pb-[16px]">
                <div className={`${DOCUMENT_AREA} overflow-hidden rounded-[var(--radius-3)]`} aria-busy={content.status === "loading" || undefined} data-admin-file-document>
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
              {operations.error ? <p role="alert" className="text-body-3 m-0 border-t border-[var(--color-neutral-200)] px-[16px] py-[12px] text-[var(--color-danger-100)]">{operations.error}</p> : null}
              <footer className="flex w-full shrink-0 flex-wrap items-center gap-[16px] border-t border-[var(--color-neutral-200)] p-[16px]">
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
          </div>
          <aside className={DRAWER} aria-label="Historial de versiones" data-admin-file-history-drawer>
            <AdminFileVersionHistory
              history={history}
              displayedVersionId={displayed.id}
              actionsDisabled={busy}
              addVersion={{ ...replaceAvailability, onClick: () => setReplaceOpen(true) }}
              onView={(version) => {
                operations.clearError();
                setDisplayedVersionId(version.id);
              }}
              onDownload={downloadVersion}
              onRestore={(version) => setReasonDialog({ kind: "restore", version })}
            />
          </aside>
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
