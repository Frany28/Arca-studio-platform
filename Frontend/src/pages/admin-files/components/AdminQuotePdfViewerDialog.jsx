import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import DocumentFileCard from "../../../components/document-viewer/DocumentFileCard.jsx";
import Button from "../../../components/ui/Button/Button.jsx";
import Modal from "../../../components/ui/Modal/Modal.jsx";
import { useDialogKeyboard } from "../../../hooks/useDialogKeyboard.js";
import { formatStorage } from "../../../utils/fileMetrics.js";
import { useQuotePdfDocument } from "../../admin-services-quotes/quotes/hooks/useQuotePdfDocument.js";
import { getQuoteEditorPath } from "../../admin-services-quotes/utils/servicesQuotesTabs.js";
import { useAdminQuotePdfVersions } from "../hooks/useAdminQuotePdfVersions.js";
import { useAdminQuoteRestore } from "../hooks/useAdminQuoteRestore.js";
import { formatFileDate } from "../utils/adminFilesPresentation.js";
import {
  describeQuotePdfStatus,
  describeQuoteRestorePlan,
  describeQuoteRestoreResult,
  getQuoteVersionActions,
  QUOTE_REPLACE_REASON,
  toQuoteHistoryVersion,
} from "../utils/adminQuoteDocuments.js";
import AdminFileReasonDialog from "./AdminFileReasonDialog.jsx";
import AdminFileVersionHistory from "./AdminFileVersionHistory.jsx";
import AdminFileVersionSurface from "./AdminFileVersionSurface.jsx";
import { DOCUMENT_AREA, DRAWER, MODAL_AREA, MODAL_BOX, VIEWER_LAYOUT } from "./adminFileViewerLayout.js";

const DEFAULT_VIEW = Object.freeze({ page: 1, zoom: 100 });
const NO_NEW_VERSION = Object.freeze({ allowed: false, onClick: () => {}, reason: QUOTE_REPLACE_REASON });

/**
 * Versión mostrada a partir de la fila de la tabla, mientras el historial no la trae.
 *
 * @param {Object} item - Fila de cotización (FileManagerItem con `quote`).
 * @returns {Object} Versión con la forma del drawer.
 */
function versionFromItem(item) {
  return {
    createdAt: item.createdAt,
    fileName: item.name,
    id: item.versionNumber,
    isCurrent: true,
    note: describeQuotePdfStatus(item.quote.pdf).label,
    pdf: { ...item.quote.pdf, fileName: item.name, size: item.size },
    size: item.size,
    uploadedBy: item.uploadedBy,
    versionNumber: item.versionNumber,
  };
}

/**
 * Visor del PDF de una cotización dentro del administrador de archivos, con la misma composición
 * que el visor de archivos (modal 3727:682968 y drawer «Historial de versiones» 3934:182047):
 *
 * - Muestra el PDF almacenado de la versión elegida con el visor PDF.js de la aplicación. Si no está
 *   disponible, `useQuotePdfDocument` pide una única recuperación idempotente (sin versión nueva) y,
 *   si vuelve a fallar, informa el error con «Reintentar»; nunca muestra un documento ficticio.
 * - El historial es el de las versiones comerciales de Cotizaciones (no hay otro): ver y descargar
 *   cada PDF original y «Restaurar versión» en las históricas. La restauración comercial pide un
 *   motivo, crea la versión vigente siguiente con los datos de la elegida y su propio PDF, sin
 *   aprobación posterior; el visor sigue abierto y muestra la versión nueva. No se reemplaza ni
 *   revisa aquí; «Editar cotización» abre el editor.
 * - Una recuperación o restauración recarga el historial y la tabla.
 *
 * @param {Object} props - Fila abierta, descargas y callbacks.
 * @param {Object} props.item - Fila de cotización (FileManagerItem con `quote`).
 * @param {HTMLElement|null} [props.returnFocusTo] - Control que abrió el visor.
 * @param {{ download: Function, downloadingKey: string|null }} props.downloads - Descargas (useAdminQuotePdfDownload).
 * @param {{ notify: Function }} props.feedback - Avisos de la página (resultado de la restauración).
 * @param {() => void} props.onChanged - Recarga tabla y métricas.
 * @param {() => void} props.onClose - Cierra el visor.
 * @returns {import("react").ReactElement} Modal en portal.
 */
function AdminQuotePdfViewerDialog({ downloads, feedback, item, onChanged, onClose, returnFocusTo }) {
  const titleId = useId();
  const navigate = useNavigate();
  const quoteId = item.quote.id;
  const history = useAdminQuotePdfVersions(quoteId);
  const [displayedNumber, setDisplayedNumber] = useState(item.versionNumber);
  // Versión creada por la última restauración, mostrada mientras el historial recargado no la trae.
  const [restoredVersion, setRestoredVersion] = useState(null);
  const [views, setViews] = useState({});
  const displayed = history.versions.find((version) => version.versionNumber === displayedNumber)
    ?? (restoredVersion?.versionNumber === displayedNumber ? restoredVersion : null)
    ?? (displayedNumber === item.versionNumber ? versionFromItem(item) : history.versions[0] ?? versionFromItem(item));
  const currentVersionNumber = history.versions.find((version) => version.isCurrent)?.versionNumber ?? null;
  const restoration = useAdminQuoteRestore({
    currentVersionNumber,
    onRestored: ({ quote, source }) => {
      setRestoredVersion(toQuoteHistoryVersion({
        createdAt: quote.version?.createdAt, createdBy: quote.version?.createdBy, isCurrent: true,
        pdf: quote.pdf, restoredFrom: quote.version?.restoredFrom, versionNumber: quote.currentVersion,
      }));
      setDisplayedNumber(quote.currentVersion);
      history.reload();
      onChanged();
      const texts = describeQuoteRestoreResult(quote, source);
      feedback.notify("success", texts.title, texts.description, quote.pdf?.fileName || item.name);
    },
    onStale: history.reload,
    quoteId,
  });
  const pdf = useQuotePdfDocument({ currentVersion: displayed.versionNumber, id: quoteId });
  const view = views[displayed.versionNumber] || DEFAULT_VIEW;
  const fileName = displayed.fileName || item.name;
  const downloading = downloads.downloadingKey === `${quoteId}:${displayed.versionNumber}`;

  // Si el visor recuperó un PDF que figuraba como no disponible, el historial y la tabla lo reflejan.
  const refreshed = useRef(new Set());
  const recovered = pdf.status === "ready" && displayed.pdf?.status !== "available";
  useEffect(() => {
    if (!recovered || refreshed.current.has(displayed.versionNumber)) return;
    refreshed.current.add(displayed.versionNumber);
    history.reload();
    onChanged();
  }, [displayed.versionNumber, history, onChanged, recovered]);

  useDialogKeyboard({
    // Con el motivo de la restauración abierto, Escape y el foco pertenecen a ese diálogo.
    open: !restoration.target,
    getContainer: () => document.querySelector("[data-admin-quote-viewer]"),
    onEscape: onClose,
    getInitialFocus: (elements) => elements.find((element) => element.textContent?.trim() === "Cerrar"),
    getReturnFocus: returnFocusTo ? () => returnFocusTo : undefined,
  });

  /**
   * Descarga una versión: la mostrada reutiliza los bytes ya recibidos.
   *
   * @param {Object} version - Versión del historial.
   * @returns {void}
   */
  function downloadVersion(version) {
    const cached = version.versionNumber === displayed.versionNumber && pdf.blob ? pdf.blob : null;
    downloads.download({ name: version.fileName || fileName, quoteId, versionNumber: version.versionNumber }, cached);
  }

  const size = pdf.size || displayed.size;
  const uploadedAt = formatFileDate(displayed.createdAt);
  const header = {
    fileType: "pdf",
    name: fileName,
    owner: displayed.uploadedBy?.name || "Sin autor",
    ownerAvatarSrc: "",
    size: size ? formatStorage(size, { maximumFractionDigits: 1 }) : "—",
    uploadedAt: displayed.isCurrent ? uploadedAt : `${uploadedAt} • V${displayed.versionNumber} · Versión anterior`,
  };
  /**
   * Cierra al pulsar el fondo de la composición (el overlay real queda debajo), no sus paneles.
   *
   * @param {import("react").MouseEvent} event - Clic.
   * @returns {void}
   */
  const closeOnBackdrop = (event) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <>
      <Modal visible showDialog overlayVariant="blurred" transitionPreset="fade-scale" dialogShellClassName="!pb-0" contentClassName="!p-0" onClose={onClose}>
        <div role="dialog" aria-modal="true" aria-labelledby={titleId} data-admin-quote-viewer className={VIEWER_LAYOUT} onClick={closeOnBackdrop}>
          <h2 id={titleId} className="sr-only">{fileName}, cotización {item.quote.code}, versión {displayed.versionNumber}</h2>
          <div className={MODAL_AREA} onClick={closeOnBackdrop}>
            <div className={MODAL_BOX} data-admin-file-modal>
              <DocumentFileCard document={header} keepExtension variant="modal" />
              <div className="flex min-h-0 flex-1 flex-col px-[16px] pb-[16px]">
                <div className={`${DOCUMENT_AREA} overflow-hidden rounded-[var(--radius-3)]`} aria-busy={pdf.status === "loading" || undefined} data-admin-file-document>
                  <AdminFileVersionSurface
                    kind="pdf"
                    content={pdf}
                    src=""
                    title={fileName}
                    view={view}
                    onClose={onClose}
                    onViewChange={(next) => setViews((current) => ({ ...current, [displayed.versionNumber]: next }))}
                    onDownload={() => downloadVersion(displayed)}
                    downloading={downloading}
                  />
                </div>
              </div>
              <footer className="flex w-full shrink-0 flex-wrap items-center gap-[16px] border-t border-[var(--color-neutral-200)] p-[16px]">
                <Button theme="Primary" type="Outline" size="S" showLeftIcon={false} showRightIcon={false} className="h-[41px] min-w-[140px] flex-1" onClick={onClose}>
                  Cerrar
                </Button>
                <Button theme="Primary" type="Solid" size="S" showLeftIcon={false} showRightIcon={false} tooltip="Las versiones nuevas se crean editando la cotización" className="h-[41px] min-w-[140px] flex-1" onClick={() => navigate(getQuoteEditorPath(quoteId))}>
                  Editar cotización
                </Button>
              </footer>
            </div>
          </div>
          <aside className={DRAWER} aria-label="Historial de versiones" data-admin-file-history-drawer>
            <AdminFileVersionHistory
              history={history}
              displayedVersionId={displayed.versionNumber}
              actionsDisabled={false}
              addVersion={NO_NEW_VERSION}
              getVersionActions={getQuoteVersionActions}
              onView={(version) => setDisplayedNumber(version.versionNumber)}
              onRestore={restoration.open}
              onDownload={downloadVersion}
            />
          </aside>
        </div>
      </Modal>
      {restoration.target ? (
        <AdminFileReasonDialog
          key={restoration.target.requestId}
          kind="quoteRestore"
          subject={`${item.quote.code} · V${restoration.target.version.versionNumber}`}
          description={describeQuoteRestorePlan(restoration.target.version, currentVersionNumber ?? restoration.target.expectedVersion)}
          onClose={restoration.close}
          onSubmit={restoration.submit}
        />
      ) : null}
    </>
  );
}

export default AdminQuotePdfViewerDialog;
