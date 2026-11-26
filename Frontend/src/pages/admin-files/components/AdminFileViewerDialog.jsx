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
import { canLinkWarranties, describeRestorePlan, describeRestoreResult, formatDisplayedVersionSuffix, getReplaceAvailability, getViewerKind, isMediaViewerKind } from "../utils/adminFileReview.js";
import { describeUploadResult } from "../utils/adminFileUpload.js";
import AdminFileReasonDialog from "./AdminFileReasonDialog.jsx";
import AdminFileUploadDialog from "./AdminFileUploadDialog.jsx";
import AdminFileVersionHistory from "./AdminFileVersionHistory.jsx";
import AdminFileVersionSurface from "./AdminFileVersionSurface.jsx";
import AdminFileWarrantyDialog from "./AdminFileWarrantyDialog.jsx";
import { DOCUMENT_AREA, DRAWER, getFittedMediaStyle, MEDIA_FRAME, MEDIA_STAGE_FITTED, MODAL_AREA, MODAL_BOX, VIEWER_LAYOUT } from "./adminFileViewerLayout.js";

const DEFAULT_VIEW = Object.freeze({ page: 1, zoom: 100 });

// Imágenes, vídeos y panorámicas (Figma 3941:671103, 3941:675497 y 3940:666189): el escenario de
// galería de Proyectos ocupa todo el espacio libre con 24 px de margen y el drawer 3940:666330 de
// 312 px queda pegado al borde derecho. Por debajo de 921 px se apilan como en los visores de
// Proyectos (escenario de 62 dvh, mínimo 360; 58 dvh y 300 en móvil, y el historial debajo), para
// que el drawer no reduzca el medio a un tamaño inútil.
const MEDIA_LAYOUT = "flex h-dvh w-screen flex-col overflow-y-auto overscroll-contain min-[921px]:flex-row min-[921px]:overflow-hidden";
const MEDIA_AREA = "flex shrink-0 p-[16px] min-[921px]:min-h-0 min-[921px]:min-w-0 min-[921px]:flex-1 min-[921px]:p-[24px]";
const MEDIA_STAGE = "flex h-[62dvh] min-h-[360px] w-full min-w-0 max-[520px]:h-[58dvh] max-[520px]:min-h-[300px] min-[921px]:h-full min-[921px]:min-h-0";
const MEDIA_DRAWER = "flex w-full flex-1 flex-col gap-[24px] rounded-t-[var(--radius-3)] bg-[var(--color-neutral-100)] p-[16px] shadow-[var(--shadow-e2)] min-[921px]:h-full min-[921px]:w-[312px] min-[921px]:flex-none min-[921px]:overflow-y-auto min-[921px]:overscroll-contain min-[921px]:rounded-t-none min-[921px]:rounded-l-[var(--radius-3)]";

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
 * @param {(action: "approve"|"reject") => void} props.onReviewed - Revisión confirmada.
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
  // Dimensiones naturales del recurso mostrado (imagen o vídeo), ligadas a su URL: una respuesta de
  // otra versión (cambio rápido) nunca ajusta el escenario de la actual.
  const [mediaSize, setMediaSize] = useState(null);
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
    if (outcome.ok) onReviewed("approve");
    else if (outcome.message) feedback.notify("danger", "No se pudo aprobar el archivo", outcome.message);
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
        onReviewed("reject");
      } else if (!outcome.fieldError && outcome.message) {
        // El diálogo conserva el borrador; la alerta es el único aviso para errores generales.
        feedback.notify("danger", "No se pudo rechazar el archivo", outcome.message);
        return { ok: false };
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

  const mediaLayout = isMediaViewerKind(kind);
  const mediaSrc = api.fileManager.getVersionContentUrl(versionRef);
  const fittedSize = (kind === "image" || kind === "video") && mediaSize?.src === mediaSrc ? mediaSize : null;
  const surface = (
    <AdminFileVersionSurface
      kind={kind}
      content={content}
      src={mediaSrc}
      title={displayName}
      view={view}
      onClose={closeIfIdle}
      onViewChange={(next) => setViews((current) => ({ ...current, [displayed.id]: next }))}
      onDownload={() => downloadVersion(displayed)}
      downloading={downloading}
      onMediaSize={setMediaSize}
    />
  );
  const historyPanel = (
    <AdminFileVersionHistory
      history={history}
      displayedVersionId={displayed.id}
      actionsDisabled={busy}
      addVersion={{ ...replaceAvailability, onClick: () => setReplaceOpen(true) }}
      onView={(version) => setDisplayedVersionId(version.id)}
      onDownload={downloadVersion}
      onRestore={(version) => setReasonDialog({ kind: "restore", version })}
    />
  );
  // Sin el modal de documentos, el drawer de medios recoge lo que su cabecera y su pie mostraban:
  // la versión que se ve si no es la vigente y las acciones de revisión
  // y de garantías. «Cerrar» es la X del escenario y «Reemplazar», el «+» del historial.
  const showWarranties = !pending && canLinkWarranties(item);
  const mediaPanel = versionSuffix || pending || showWarranties ? (
    <div className="mt-auto flex flex-col gap-[12px] border-t border-[var(--color-neutral-200)] pt-[16px]" data-admin-file-media-actions>
      {versionSuffix ? <p className="text-body-3 m-0 text-[var(--color-text-200)]" data-admin-file-viewer-status>Mostrando {versionSuffix}</p> : null}
      {pending || showWarranties ? (
        <div className="flex flex-wrap gap-[12px]">
          {pending ? (
            <>
              <Button theme="Danger" type="Outline" size="S" showLeftIcon={false} showRightIcon={false} disabled={busy} className="h-[41px] min-w-[120px] flex-1" onClick={() => setReasonDialog({ kind: "reject", version: displayed })}>
                Rechazar
              </Button>
              <Button theme="Primary" type="Solid" size="S" showLeftIcon={false} showRightIcon={false} disabled={busy} aria-busy={operations.pending === "approve" || undefined} className="h-[41px] min-w-[120px] flex-1" onClick={approve}>
                {operations.pending === "approve" ? "Aprobando..." : "Aprobar"}
              </Button>
            </>
          ) : (
            <Button theme="Primary" type="Outline" size="S" showLeftIcon={false} showRightIcon={false} disabled={busy} className="h-[41px] flex-1" onClick={() => setWarrantiesOpen(true)}>
              Garantías
            </Button>
          )}
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <>
      <Modal visible showDialog overlayVariant="blurred" transitionPreset="fade-scale" dialogShellClassName="!pb-0" contentClassName="!p-0" onClose={busy ? undefined : onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-busy={busy || undefined}
          data-admin-file-viewer
          className={mediaLayout ? MEDIA_LAYOUT : VIEWER_LAYOUT}
          data-admin-file-viewer-layout={mediaLayout ? "media" : "document"}
          onClick={closeOnBackdrop}
        >
          <h2 id={titleId} className="sr-only">{displayName}, versión {displayed.versionNumber}</h2>
          {mediaLayout ? (
            <>
              <div className={MEDIA_AREA} onClick={closeOnBackdrop}>
                <div className={MEDIA_FRAME} onClick={closeOnBackdrop}>
                  <div
                    className={fittedSize ? MEDIA_STAGE_FITTED : MEDIA_STAGE}
                    style={fittedSize ? getFittedMediaStyle(fittedSize) : undefined}
                    data-admin-file-media
                    data-media-fitted={fittedSize ? "true" : undefined}
                    aria-busy={busy || undefined}
                  >
                    {surface}
                  </div>
                </div>
              </div>
              <aside className={MEDIA_DRAWER} aria-label="Historial de versiones" data-admin-file-history-drawer>
                {historyPanel}
                {mediaPanel}
              </aside>
            </>
          ) : (
            <>
              <div className={MODAL_AREA} onClick={closeOnBackdrop}>
                <div className={MODAL_BOX} data-admin-file-modal>
                  <DocumentFileCard document={header} keepExtension variant="modal" closeIcon={<CloseIcon />} onClose={pending && !busy ? onClose : undefined} />
                  <div className="flex min-h-0 flex-1 flex-col px-[16px] pb-[16px]">
                    <div className={`${DOCUMENT_AREA} overflow-hidden rounded-[var(--radius-3)]`} aria-busy={content.status === "loading" || undefined} data-admin-file-document>
                      {surface}
                    </div>
                  </div>
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
                {historyPanel}
              </aside>
            </>
          )}
        </div>
      </Modal>
      {reasonDialog ? (
        <AdminFileReasonDialog
          key={`${reasonDialog.kind}-${reasonDialog.version.id}`}
          kind={reasonDialog.kind}
          subject={`${displayName} · V${reasonDialog.version.versionNumber}`}
          description={reasonDialog.kind === "restore" ? describeRestorePlan(reasonDialog.version, history.versions) : ""}
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
