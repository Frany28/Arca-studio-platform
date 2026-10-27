import { useId, useState } from "react";

import DocumentFileCard from "../../../../components/document-viewer/DocumentFileCard.jsx";
import PdfViewerSurface from "../../../../components/document-viewer/PdfViewerSurface.jsx";
import Button from "../../../../components/ui/Button/Button.jsx";
import EmptyState from "../../../../components/ui/EmptyState/EmptyState.jsx";
import Loader from "../../../../components/ui/Loader/Loader.jsx";
import Modal from "../../../../components/ui/Modal/Modal.jsx";
import { formatShortDay, toDayKey } from "../../../../components/ui/DateRangePicker/dateRangeCalendar.js";
import { useDialogKeyboard } from "../../../../hooks/useDialogKeyboard.js";
import { formatFileSize } from "../../../../utils/fileSize.js";
import { useQuoteDetail } from "../../hooks/useQuoteDetail.js";
import { useQuotePdfDocument } from "../hooks/useQuotePdfDocument.js";

/**
 * Datos del encabezado del documento: nombre del PDF, peso real recibido, fecha de la versión
 * vigente y su autor con su foto. Mientras el detalle carga se muestran solo los datos del listado.
 *
 * @param {Object} quote - Fila del listado.
 * @param {Object|null} detail - Detalle con la versión vigente.
 * @param {number} size - Peso del PDF en bytes (0 mientras no se recibe).
 * @returns {Object} Documento para DocumentFileCard.
 */
function toViewerDocument(quote, detail, size) {
  const version = detail?.version;
  return {
    fileType: "PDF",
    name: `${quote.code}.pdf`,
    owner: version?.createdBy?.name || " ",
    ownerAvatarSrc: version?.createdBy?.profilePhotoUrl || "",
    size: size ? formatFileSize(size) : "—",
    uploadedAt: version ? formatShortDay(toDayKey(new Date(version.createdAt))) : "",
  };
}

/**
 * Visor del PDF de una cotización (Figma 5812:280752; tablet 5925:476589 y móvil 5925:478671):
 * encabezado con el archivo y su autor, el documento generado por el backend en el visor PDF.js
 * de la aplicación, y «Cerrar» y «Editar». El documento se descarga solo mientras el visor está
 * abierto y se libera al cerrarlo. Escape y el overlay cierran; el foco vuelve a la fila.
 *
 * @param {Object} props - Cotización abierta y callbacks.
 * @param {Object|null} props.quote - Fila del listado; null cierra el visor.
 * @param {() => void} props.onClose - Cierra el visor.
 * @param {(quote: Object) => void} props.onEdit - Abre la edición de la cotización.
 * @param {HTMLElement|null} [props.returnFocusTo] - Control que abrió el visor.
 * @returns {import("react").ReactElement} Modal en portal.
 */
function QuotePdfViewerModal({ onClose, onEdit, quote, returnFocusTo }) {
  const titleId = useId();
  // La salida animada de Modal conserva la última cotización mostrada sin repintar otra.
  const [shown, setShown] = useState(quote);
  if (quote && quote !== shown) setShown(quote);
  const displayed = quote ?? shown;
  const pdf = useQuotePdfDocument(quote);
  const detail = useQuoteDetail(quote?.id ?? null);
  const [view, setView] = useState({ page: 1, quoteKey: null, zoom: 100 });
  const viewKey = quote ? `${quote.id}:${quote.currentVersion}` : null;
  const { page, zoom } = view.quoteKey === viewKey ? view : { page: 1, zoom: 100 };

  useDialogKeyboard({
    open: Boolean(quote),
    getContainer: () => document.querySelector("[data-quote-pdf-viewer]"),
    onEscape: onClose,
    getInitialFocus: (elements) => elements.find((element) => element.textContent?.trim() === "Cerrar"),
    getReturnFocus: returnFocusTo ? () => returnFocusTo : undefined,
  });

  let viewer;
  if (pdf.status === "error") {
    viewer = (
      <div className="flex size-full items-center justify-center bg-[var(--color-primary-300)] p-[24px]">
        <EmptyState
          title="No se pudo cargar la cotización"
          description={pdf.error}
          size="S"
          showFeaturedIcon
          showActions
          showSecondaryAction={false}
          primaryActionLabel="Reintentar"
          onPrimaryAction={pdf.retry}
        />
      </div>
    );
  } else if (pdf.status === "ready") {
    viewer = (
      <PdfViewerSurface
        className="size-full rounded-[var(--radius-3)]"
        documentProxy={pdf.documentProxy}
        expandable={false}
        page={page}
        pageCount={pdf.pageCount}
        title={`Cotización ${displayed?.code ?? ""}`}
        updatePage={(next) => setView({ page: next, quoteKey: viewKey, zoom })}
        updateZoom={(next) => setView({ page, quoteKey: viewKey, zoom: next })}
        zoom={zoom}
      />
    );
  } else {
    viewer = <Loader preset="documentPreview" label="Cargando cotización" className="h-full overflow-hidden" />;
  }

  return (
    <Modal visible={Boolean(quote)} showDialog overlayVariant="blurred" transitionPreset="fade-scale" onClose={onClose}>
      {displayed ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="flex w-[781px] max-w-full flex-col overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e2)]"
          data-quote-pdf-viewer
          onClick={(event) => event.stopPropagation()}
        >
          <h2 id={titleId} className="sr-only">Cotización {displayed.code}</h2>
          <DocumentFileCard document={toViewerDocument(displayed, detail.quote, pdf.size)} keepExtension />
          <div className="px-[16px] pb-[16px]">
            <div className="h-[min(527px,calc(100dvh-260px))] min-h-[320px] overflow-hidden rounded-[var(--radius-3)]" aria-busy={pdf.status === "loading" || undefined}>
              {viewer}
            </div>
          </div>
          <div className="flex w-full items-center gap-[16px] border-t border-[var(--color-neutral-200)] p-[16px]">
            <Button theme="Primary" type="Outline" size="S" showLeftIcon={false} showRightIcon={false} className="h-[41px] min-w-0 flex-1" onClick={onClose}>
              Cerrar
            </Button>
            <Button theme="Primary" type="Solid" size="S" showLeftIcon={false} showRightIcon={false} className="h-[41px] min-w-0 flex-1" onClick={() => onEdit(displayed)}>
              Editar
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

export default QuotePdfViewerModal;
