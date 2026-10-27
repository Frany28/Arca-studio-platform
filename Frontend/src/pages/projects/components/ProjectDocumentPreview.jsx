import { useCallback, useEffect, useRef, useState } from "react";

import EmptyState from "../../../components/ui/EmptyState/EmptyState.jsx";
import Loader from "../../../components/ui/Loader/Loader.jsx";
import { getFileDisplayName } from "../../../utils/fileDisplayName.js";
import { getToggledCommentId } from "../../../utils/commentSelection.js";
import GeneralCommentsDrawer from "../../../components/ui/Gallery/GeneralCommentsDrawer.jsx";
import { useDocumentComments } from "../../../hooks/useDocumentComments.js";
import { useProjectReadOnly } from "../../../contexts/ProjectReadOnlyContext.jsx";
import DocumentFileCard from "../../../components/document-viewer/DocumentFileCard.jsx";
import DocumentFullscreenModal from "./document-preview/DocumentFullscreenModal.jsx";
import PdfViewerSurface from "../../../components/document-viewer/PdfViewerSurface.jsx";
import OfficeViewerSurface from "./document-preview/OfficeViewerSurface.jsx";
import { fetchDocumentBytes, openPdfDocument } from "../../../components/document-viewer/pdfDocumentLoader.js";
import { ViewerButton, ExpandIcon, CloseIcon, MIN_ZOOM, MAX_ZOOM } from "../../../components/document-viewer/DocumentViewerControls.jsx";

function getDocumentKind(document) {
  const extension = String(document?.fileType || document?.extension || "")
    .trim()
    .toLowerCase();
  const mime = String(document?.mimeType || "").toLowerCase();

  if (extension === "pdf" || mime === "application/pdf") return "pdf";
  if (extension === "docx" || mime.includes("wordprocessingml")) return "docx";
  if (extension === "xlsx" || mime.includes("spreadsheetml")) return "xlsx";
  return "unsupported";
}

function OfficeInlineDocumentPreview({
  annotations,
  document,
  expandButtonRef,
  focusedId,
  kind,
  onExpand,
  onPointCreate,
  onPointSelect,
  pendingSelection,
}) {
  const source = document?.fileUrl || "";
  const title = getFileDisplayName(document?.name);
  const [state, setState] = useState({
    data: null,
    error: "",
    source,
    status: "loading",
  });

  useEffect(() => {
    if (!source) return undefined;

    const controller = new AbortController();
    let cancelled = false;

    fetch(source, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("DOCUMENT_LOAD_FAILED");
        return response.arrayBuffer();
      })
      .then((data) => {
        if (!cancelled) {
          setState({ data, error: "", source, status: "ready" });
        }
      })
      .catch((error) => {
        if (!cancelled && error.name !== "AbortError") {
          setState({
            data: null,
            error: "Comprueba tu conexión e inténtalo nuevamente.",
            source,
            status: "error",
          });
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [source]);

  if (state.status === "loading" || state.source !== source) {
    return <Loader preset="documentPreview" label="Cargando documento" />;
  }

  if (state.status === "error") {
    return (
      <div className="flex min-h-[554px] items-center justify-center rounded-b-[var(--radius-3)] bg-[var(--color-primary-300)] px-[24px]">
        <EmptyState
          title="No se pudo cargar el documento"
          description={state.error}
          size="S"
          showFeaturedIcon
          showActions={false}
        />
      </div>
    );
  }

  return (
    <div className="flex h-[554px] min-h-[554px] max-h-[554px] min-w-0 flex-col overflow-hidden rounded-b-[var(--radius-3)]">
      <div className="flex h-[34px] shrink-0 items-center justify-between bg-[#333] px-[12px] text-[var(--color-neutral-100-uniform)]">
        <span className="min-w-0 truncate text-[11px]">{title}</span>
        <ViewerButton
          ref={expandButtonRef}
          label="Ver en pantalla completa"
          onClick={onExpand}
        >
          <ExpandIcon />
        </ViewerButton>
      </div>
      <div className="min-h-0 flex-1">
        <OfficeViewerSurface kind={kind} annotations={annotations} data={state.data} focusedId={focusedId} onPointCreate={onPointCreate} onPointSelect={onPointSelect} pendingSelection={pendingSelection} title={title} />
      </div>
    </div>
  );
}

/**
 * Visor de documentos a pantalla completa (PDF, DOCX y XLSX) que descarga el archivo con fetch.
 * Con `commentsEnabled` muestra las observaciones del proyecto; sin ellas (por ejemplo, adjuntos de
 * solicitudes) no consulta comentarios, no permite crear puntos y el documento ocupa todo el ancho.
 *
 * @param {Object} props - Propiedades del visor.
 * @param {Object} props.document - Documento con fileUrl, name, fileType o mimeType e identificadores.
 * @param {boolean} [props.commentsEnabled=true] - Si se cargan y permiten observaciones del proyecto.
 * @param {string|number|null} [props.initialFocusedCommentId=null] - Observación que se enfoca al abrir.
 * @param {Function} props.onClose - Cierra el visor.
 * @param {boolean} [props.open=false] - Visibilidad del visor.
 * @param {string|number} [props.projectId] - Proyecto de las observaciones.
 * @param {import("react").RefObject<HTMLElement>} [props.triggerRef] - Elemento que recupera el foco al cerrar.
 * @returns {import("react").ReactElement|null} Visor o null mientras no se renderiza.
 */
export function ProjectDocumentViewerModal({
  commentsEnabled = true,
  document,
  initialFocusedCommentId = null,
  onClose,
  open = false,
  projectId,
  triggerRef,
}) {
  const { readOnly: projectReadOnly } = useProjectReadOnly();
  // Sin observaciones no hay puntos que crear: el visor queda en modo de solo lectura.
  const readOnly = projectReadOnly || !commentsEnabled;
  const kind = getDocumentKind(document);
  const source = document?.fileUrl || "";
  const documentName = getFileDisplayName(document?.name);
  const [loadState, setLoadState] = useState({
    data: null,
    documentProxy: null,
    error: "",
    pageCount: 1,
    source,
    status: open ? "loading" : "idle",
  });
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [pendingSelection, setPendingSelection] = useState(null);
  const [focusedCommentId, setFocusedCommentId] = useState(null);
  const [replyRequest, setReplyRequest] = useState(null);
  const { addComment, comments, error: commentsError, isSubmitting } = useDocumentComments({
    enabled: open && commentsEnabled && kind !== "unsupported",
    fileId: document?.id,
    fileVersionId: document?.currentVersionId,
    projectId,
  });

  useEffect(() => {
    if (!open || !initialFocusedCommentId) return;
    const comment = comments.find(
      (item) => String(item.id) === String(initialFocusedCommentId),
    );
    if (!comment) return;
    queueMicrotask(() => {
      setFocusedCommentId(comment.id);
      if (comment.selection?.kind === "document-point") {
        setPage(comment.selection.pageNumber);
      }
    });
  }, [comments, initialFocusedCommentId, open]);

  useEffect(() => {
    if (!open || !source || kind === "unsupported") return undefined;

    // Abortar cancela la descarga y destruye el documento de PDF.js (openPdfDocument).
    const controller = new AbortController();
    const { signal } = controller;

    queueMicrotask(() => {
      if (signal.aborted) return;
      setLoadState({
        data: null,
        documentProxy: null,
        error: "",
        pageCount: 1,
        source,
        status: "loading",
      });
      setPage(1);
      setZoom(100);
      setPendingSelection(null);
      setFocusedCommentId(null);
      setReplyRequest(null);
    });

    fetchDocumentBytes(source, signal)
      .then(async (buffer) => {
        // DOCX y XLSX se presentan con sus propios visores a partir de los bytes.
        if (kind !== "pdf") return { buffer };
        return { buffer, documentProxy: await openPdfDocument(buffer, signal) };
      })
      .then(({ buffer, documentProxy = null }) => {
        if (signal.aborted) return;
        setLoadState({
          data: buffer,
          documentProxy,
          error: "",
          pageCount: documentProxy?.numPages || 1,
          source,
          status: "ready",
        });
      })
      .catch((error) => {
        if (signal.aborted || error.name === "AbortError") return;
        setLoadState({
          data: null,
          documentProxy: null,
          error: "Comprueba tu conexión e inténtalo nuevamente.",
          pageCount: 1,
          source,
          status: "error",
        });
      });

    return () => controller.abort();
  }, [kind, open, source]);

  const handleSubmitComment = async ({
    message,
    parentCommentId,
    selection,
  }) => {
    const comment = await addComment({ message, parentCommentId, selection });
    if (comment && !parentCommentId) setPendingSelection(null);
  };

  const handleSelectionChange = (selection) => {
    setFocusedCommentId(null);
    setReplyRequest(null);
    setPendingSelection(selection);
  };

  const handlePointSelect = (commentId, options = {}) => {
    const restoreCommentLocation = () => {
      const comment = comments.find(
        (item) => String(item.id) === String(commentId),
      );
      if (comment?.selection?.kind === "document-point") {
        setPage(comment.selection.pageNumber);
      }
    };

    if (options.reply) {
      restoreCommentLocation();
      setFocusedCommentId(commentId);
      setReplyRequest({ commentId, requestId: Date.now() });
      return;
    }

    const nextCommentId = getToggledCommentId(focusedCommentId, commentId);
    if (nextCommentId) restoreCommentLocation();
    setFocusedCommentId(nextCommentId);
  };

  let viewer = null;
  if (kind === "unsupported") {
    viewer = (
      <div className="flex size-full items-center justify-center bg-[var(--color-primary-300)] p-[24px]">
        <EmptyState
          title="Vista previa no disponible"
          description="Este formato no puede visualizarse dentro del navegador."
          size="S"
          showFeaturedIcon
          showActions={false}
        />
      </div>
    );
  } else if (loadState.status === "loading" || loadState.source !== source) {
    viewer = <Loader preset="documentPreview" label="Cargando documento" />;
  } else if (loadState.status === "error") {
    viewer = (
      <div className="flex size-full items-center justify-center bg-[var(--color-primary-300)] p-[24px]">
        <EmptyState
          title="No se pudo cargar el documento"
          description={loadState.error}
          size="S"
          showFeaturedIcon
          showActions={false}
        />
      </div>
    );
  } else if (kind === "pdf") {
    viewer = (
      <PdfViewerSurface
        annotations={comments}
        className="size-full rounded-[var(--radius-3)]"
        documentProxy={loadState.documentProxy}
        focusedId={focusedCommentId}
        fullscreen
        onClose={onClose}
        onPointCreate={readOnly ? undefined : handleSelectionChange}
        onPointSelect={handlePointSelect}
        page={page}
        pageCount={loadState.pageCount}
        pendingSelection={pendingSelection}
        title={`Vista completa de ${documentName}`}
        updatePage={setPage}
        updateZoom={setZoom}
        zoom={zoom}
      />
    );
  } else {
    viewer = <OfficeViewerSurface kind={kind} annotations={comments} data={loadState.data} focusedId={focusedCommentId} onPointCreate={readOnly ? undefined : handleSelectionChange} onPointSelect={handlePointSelect} pendingSelection={pendingSelection} title={documentName} />;
  }

  return (
    <DocumentFullscreenModal
      documentName={documentName}
      onClose={onClose}
      triggerRef={triggerRef}
      visible={open}
    >
      <div className="flex size-full min-h-0 min-w-0 gap-[12px] max-[767px]:flex-col">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-3)] bg-[var(--color-neutral-100)] max-[767px]:min-h-[52dvh]">
          <DocumentFileCard
            closeIcon={<CloseIcon />}
            document={document}
            onClose={onClose}
            variant="modal"
          />
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {viewer}
          </div>
        </div>
        {commentsEnabled ? (
          <div className="w-[296px] shrink-0 max-[767px]:h-[36dvh] max-[767px]:w-full">
            <GeneralCommentsDrawer
              composerDisabled={isSubmitting}
              composerDisabledMessage={isSubmitting ? "Guardando observación..." : ""}
              composerFocusSignal={pendingSelection ? JSON.stringify(pendingSelection) : ""}
              comments={comments}
              commentsError={commentsError}
              focusedSelectionCommentId={focusedCommentId}
              mediaItem={document}
              mediaType="document"
              pendingSelection={pendingSelection}
              replyRequest={replyRequest}
              requireSelectionForRoot
              onClearSelection={() => setPendingSelection(null)}
              onSelectionPreviewClick={handlePointSelect}
              onSubmitComment={handleSubmitComment}
            />
          </div>
        ) : null}
      </div>
    </DocumentFullscreenModal>
  );
}

export default function ProjectDocumentPreview({ document, focusedCommentId = null, onLoadingChange, projectId }) {
  const source = document?.fileUrl || "";
  const documentKind = getDocumentKind(document);
  const isPdf = documentKind === "pdf";
  const [loadState, setLoadState] = useState({
    pageCount: 1,
    documentProxy: null,
    source,
    status: source && isPdf ? "loading" : "unsupported",
  });
  const [viewState, setViewState] = useState({ page: 1, source, zoom: 100 });
  const [retryKey, setRetryKey] = useState(0);
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const expandButtonRef = useRef(null);

  useEffect(() => {
    if (focusedCommentId) queueMicrotask(() => setIsFullscreenOpen(true));
  }, [focusedCommentId]);
  const status = loadState.source === source
    ? loadState.status
    : source && isPdf
      ? "loading"
      : "unsupported";
  const pageCount = loadState.source === source ? loadState.pageCount : 1;
  const documentProxy = loadState.source === source
    ? loadState.documentProxy
    : null;
  const page = viewState.source === source ? viewState.page : 1;
  const zoom = viewState.source === source ? viewState.zoom : 100;
  const documentName = getFileDisplayName(document?.name);
  const { comments } = useDocumentComments({
    enabled: Boolean(projectId && document?.id && document?.currentVersionId),
    fileId: document?.id,
    fileVersionId: document?.currentVersionId,
    projectId,
  });
  useEffect(() => {
    onLoadingChange?.(status === "loading");

    return () => onLoadingChange?.(false);
  }, [onLoadingChange, status]);

  useEffect(() => {
    if (!source || !isPdf) return undefined;

    // Abortar cancela la descarga y destruye el documento de PDF.js (openPdfDocument).
    const controller = new AbortController();
    const { signal } = controller;

    fetchDocumentBytes(source, signal)
      .then((buffer) => openPdfDocument(buffer, signal))
      .then((pdfDocument) => {
        if (signal.aborted) return;
        setLoadState({
          documentProxy: pdfDocument,
          pageCount: pdfDocument.numPages,
          source,
          status: "loaded",
        });
      })
      .catch((error) => {
        if (!signal.aborted && error.name !== "AbortError") {
          setLoadState({
            documentProxy: null,
            pageCount: 1,
            source,
            status: "error",
          });
        }
      });

    return () => controller.abort();
  }, [isPdf, retryKey, source]);

  const updatePage = (nextPage) => {
    const normalizedPage = Math.min(Math.max(Number(nextPage) || 1, 1), pageCount);
    setViewState({ page: normalizedPage, source, zoom });
  };
  const updateZoom = (nextZoom) => {
    const normalizedZoom = Math.min(Math.max(nextZoom, MIN_ZOOM), MAX_ZOOM);
    setViewState({ page, source, zoom: normalizedZoom });
  };
  const closeFullscreen = useCallback(() => setIsFullscreenOpen(false), []);

  useEffect(() => {
    const preventDocumentExport = (event) => {
      if ((event.ctrlKey || event.metaKey) && ["p", "s"].includes(event.key.toLowerCase())) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", preventDocumentExport, true);
    return () => window.removeEventListener("keydown", preventDocumentExport, true);
  }, []);

  if (documentKind === "docx" || documentKind === "xlsx") {
    return (
      <>
        <div className="h-[554px]">
          <div className="min-w-0 flex-1 max-[767px]:h-[52dvh]">
            <OfficeInlineDocumentPreview annotations={comments} document={document} expandButtonRef={expandButtonRef}
              focusedId={null} kind={documentKind} onExpand={() => setIsFullscreenOpen(true)} />
          </div>
        </div>
        <ProjectDocumentViewerModal
          document={document}
          initialFocusedCommentId={focusedCommentId}
          onClose={closeFullscreen}
          open={isFullscreenOpen}
          projectId={projectId}
          triggerRef={expandButtonRef}
        />
      </>
    );
  }

  if (status === "loading") {
    return <Loader preset="documentPreview" label="Cargando documento" />;
  }

  if (status === "error") {
    return (
      <div className="flex min-h-[554px] items-center justify-center rounded-b-[var(--radius-3)] bg-[var(--color-primary-300)] px-[24px]">
        <EmptyState
          title="No se pudo cargar el documento"
          description="Comprueba tu conexión e inténtalo nuevamente."
          size="S"
          showFeaturedIcon
          showActions
          showSecondaryAction={false}
          primaryActionLabel="Reintentar"
          onPrimaryAction={() => {
            setLoadState({
              documentProxy: null,
              pageCount: 1,
              source,
              status: "loading",
            });
            setRetryKey((current) => current + 1);
          }}
        />
      </div>
    );
  }

  if (status === "unsupported") {
    return (
      <div className="flex min-h-[554px] items-center justify-center rounded-b-[var(--radius-3)] bg-[var(--color-primary-300)] px-[24px]">
        <EmptyState
          title="Vista previa no disponible"
          description="Este formato no puede visualizarse dentro del navegador."
          size="S"
          showFeaturedIcon
          showActions={false}
        />
      </div>
    );
  }

  return (
    <>
      <div className="h-[554px]">
      <PdfViewerSurface
        annotations={comments}
        className="h-[554px] min-h-[554px] max-h-[554px] rounded-b-[var(--radius-3)]"
        documentProxy={documentProxy}
        expandButtonRef={expandButtonRef}
        focusedId={null}
        onExpand={() => setIsFullscreenOpen(true)}
        page={page}
        pageCount={pageCount}
        title={`Vista previa de ${documentName}`}
        updatePage={updatePage}
        updateZoom={updateZoom}
        zoom={zoom}
      />
      </div>

      <ProjectDocumentViewerModal
        document={document}
        initialFocusedCommentId={focusedCommentId}
        onClose={closeFullscreen}
        open={isFullscreenOpen}
        projectId={projectId}
        triggerRef={expandButtonRef}
      />
    </>
  );
}
