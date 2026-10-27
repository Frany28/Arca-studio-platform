import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import clsx from "clsx";

import DocumentMarker from "./DocumentMarker.jsx";
import { PdfToolbar } from "./DocumentViewerControls.jsx";

function PdfPageCanvas({ annotations, documentProxy, focusedId, onPointCreate, onPointSelect, page, pageCount, pendingSelection, title, zoom }) {
  const canvasRef = useRef(null);
  const [renderedKey, setRenderedKey] = useState("");
  const renderKey = `${page}-${zoom}`;

  useEffect(() => {
    if (!documentProxy || !canvasRef.current) return undefined;

    let cancelled = false;
    let renderTask;
    documentProxy.getPage(page).then((pdfPage) => {
      if (cancelled || !canvasRef.current) return;

      const canvas = canvasRef.current;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = pdfPage.getViewport({ scale: (zoom / 100) * 1.35 });
      const context = canvas.getContext("2d", { alpha: false });

      canvas.width = Math.floor(viewport.width * pixelRatio);
      canvas.height = Math.floor(viewport.height * pixelRatio);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      renderTask = pdfPage.render({
        canvas,
        canvasContext: context,
        transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        viewport,
      });

      renderTask.promise
        .then(() => {
          if (!cancelled) setRenderedKey(renderKey);
        })
        .catch(() => {});

    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [documentProxy, page, renderKey, zoom]);

  return (
    <div
      className={clsx("relative shrink-0", onPointCreate && "cursor-crosshair")}
      data-pdf-page={page}
      onClick={(event) => {
        if (!onPointCreate || event.target.closest("[data-document-marker]")) return;
        const rect = event.currentTarget.getBoundingClientRect();
        onPointCreate({
          kind: "document-point",
          normalizedX: (event.clientX - rect.left) / rect.width,
          normalizedY: (event.clientY - rect.top) / rect.height,
          pageNumber: page,
          pageCount,
        });
      }}
    >
      {renderedKey !== renderKey ? (
        <div className="pointer-events-none absolute inset-0 z-[1] skeleton-shimmer" aria-hidden="true" />
      ) : null}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`${title}, página ${page}`}
        className="block max-w-none bg-white shadow-[0_2px_12px_rgba(0,0,0,0.18)]"
      />
      {[...annotations, ...(pendingSelection?.pageNumber === page ? [{ id: "pending", pointNumber: "", selection: pendingSelection }] : [])].map((comment) => (
        <DocumentMarker
          key={comment.id}
          comment={comment}
          focused={String(comment.id) === String(focusedId)}
          onSelect={onPointSelect}
          style={{ left: `${comment.selection.normalizedX * 100}%`, top: `${comment.selection.normalizedY * 100}%` }}
        />
      ))}
    </div>
  );
}

const PdfPages = forwardRef(function PdfPages(
  { annotations, documentProxy, focusedId, onPointCreate, onPointSelect, pageCount, pendingSelection, title, zoom },
  ref,
) {
  const viewportRef = useRef(null);

  useImperativeHandle(ref, () => ({
    scrollToComment(commentId) {
      viewportRef.current
        ?.querySelector(`[data-document-marker][data-comment-id="${commentId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    },
    scrollToPage(nextPage) {
      viewportRef.current
        ?.querySelector(`[data-pdf-page="${nextPage}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
  }), []);

  return (
    <div
      ref={viewportRef}
      className="flex min-h-0 flex-1 flex-col items-center gap-[12px] overflow-auto bg-[#d8d8d8] p-[12px] max-[520px]:gap-[8px] max-[520px]:p-[8px]"
      onContextMenu={(event) => event.preventDefault()}
    >
      {Array.from({ length: pageCount }, (_, index) => {
        const pageNumber = index + 1;
        return (
          <PdfPageCanvas
            annotations={annotations.filter((comment) => comment.selection?.pageNumber === pageNumber && !comment.parentCommentId)}
            key={pageNumber}
            documentProxy={documentProxy}
            focusedId={focusedId}
            onPointCreate={onPointCreate}
            onPointSelect={onPointSelect}
            page={pageNumber}
            pageCount={pageCount}
            pendingSelection={pendingSelection}
            requireSelectionForRoot
            title={title}
            zoom={zoom}
          />
        );
      })}
    </div>
  );
});

function PdfViewerSurface({
  annotations = [],
  className,
  documentProxy,
  expandButtonRef,
  fullscreen = false,
  onClose,
  onExpand,
  onPointCreate,
  onPointSelect,
  page,
  pageCount,
  title,
  focusedId,
  pendingSelection,
  updatePage,
  updateZoom,
  zoom,
}) {
  const pagesRef = useRef(null);
  const handlePageChange = (nextPage) => {
    const normalizedPage = Math.min(Math.max(Number(nextPage) || 1, 1), pageCount);
    updatePage(normalizedPage);
    pagesRef.current?.scrollToPage(normalizedPage);
  };

  useEffect(() => {
    if (!focusedId) return undefined;
    const frameId = window.requestAnimationFrame(() => {
      pagesRef.current?.scrollToComment(focusedId);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [focusedId, zoom]);

  return (
    <div
      className={clsx(
        "flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-primary-300)]",
        className,
      )}
      onContextMenu={(event) => event.preventDefault()}
    >
      <PdfToolbar
        expandButtonRef={expandButtonRef}
        fullscreen={fullscreen}
        onClose={onClose}
        onExpand={onExpand}
        page={page}
        pageCount={pageCount}
        updatePage={handlePageChange}
        updateZoom={updateZoom}
        zoom={zoom}
      />
      <PdfPages
        annotations={annotations}
        ref={pagesRef}
        documentProxy={documentProxy}
        focusedId={focusedId}
        onPointCreate={onPointCreate}
        onPointSelect={onPointSelect}
        pageCount={pageCount}
        pendingSelection={pendingSelection}
        title={title}
        zoom={zoom}
      />
    </div>
  );
}

export default PdfViewerSurface;
