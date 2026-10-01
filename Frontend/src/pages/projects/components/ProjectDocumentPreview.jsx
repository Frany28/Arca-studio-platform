import Input from "../../../components/ui/Input/Input.jsx";
import Button from "../../../components/ui/Button/Button.jsx";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { renderAsync as renderDocx } from "docx-preview";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import * as XLSX from "xlsx";

import EmptyState from "../../../components/ui/EmptyState/EmptyState.jsx";
import Avatar from "../../../components/ui/Avatar/Avatar.jsx";
import AvatarGroup from "../../../components/ui/AvatarGroup/AvatarGroup.jsx";
import Loader from "../../../components/ui/Loader/Loader.jsx";
import Tooltip from "../../../components/ui/Tooltip/Tooltip.jsx";
import ObservationTooltip from "../../../components/ui/ObservationTooltip/ObservationTooltip.jsx";
import { getFileDisplayName } from "../../../utils/fileDisplayName.js";
import { getToggledCommentId } from "../../../utils/commentSelection.js";
import { GeneralCommentsDrawer } from "../../../components/ui/Gallery/Model3DViewerModal.jsx";
import { useDocumentComments } from "../../../hooks/useDocumentComments.js";
import { useProjectReadOnly } from "../../../contexts/ProjectReadOnlyContext.jsx";
import ProjectDocumentCard from "./ProjectDocumentCard.jsx";

const MIN_ZOOM = 75;
const MAX_ZOOM = 200;
const ZOOM_STEP = 25;
const MODAL_TRANSITION_MS = 320;
const MODAL_EASING = "ease-in-out";
GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function DocumentMarker({ comment, focused, onSelect, style }) {
  const markerRef = useRef(null);
  const tooltipCloseTimerRef = useRef(null);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [tooltipClosing, setTooltipClosing] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState(null);
  const isPending = comment.id === "pending";
  const authorName = comment.authorName || comment.name || comment.author?.name || "Usuario";
  const avatarSrc = comment.avatarSrc || "";
  const replyCount = Number(comment.replyCount || comment.replies?.length || 0);
  const participants = Array.isArray(comment.threadParticipants)
    ? comment.threadParticipants
    : [];
  const visibleParticipants = participants.slice(0, 3);
  const hasMultipleParticipants = participants.length > 1;

  useEffect(() => () => window.clearTimeout(tooltipCloseTimerRef.current), []);

  const openTooltip = () => {
    if (isPending || !markerRef.current) return;
    window.clearTimeout(tooltipCloseTimerRef.current);
    setTooltipClosing(false);
    const rect = markerRef.current.getBoundingClientRect();
    setTooltipPosition({
      anchorLeft: rect.left,
      anchorRight: rect.right,
      anchorBottom: rect.bottom,
      anchorTop: rect.top,
      anchorX: rect.left + rect.width / 2,
      replaceAnchor: true,
    });
    setTooltipOpen(true);
  };
  const scheduleTooltipClose = () => {
    window.clearTimeout(tooltipCloseTimerRef.current);
    tooltipCloseTimerRef.current = window.setTimeout(() => {
      setTooltipClosing(true);
      tooltipCloseTimerRef.current = window.setTimeout(() => {
        setTooltipOpen(false);
        setTooltipClosing(false);
      }, 180);
    }, 120);
  };

  useEffect(() => {
    if (!tooltipOpen) return undefined;
    let frameId;
    const followMarker = () => {
      const rect = markerRef.current?.getBoundingClientRect();
      if (rect) {
        setTooltipPosition({
          anchorLeft: rect.left,
          anchorRight: rect.right,
          anchorBottom: rect.bottom,
          anchorTop: rect.top,
          anchorX: rect.left + rect.width / 2,
          replaceAnchor: true,
        });
      }
      frameId = window.requestAnimationFrame(followMarker);
    };
    frameId = window.requestAnimationFrame(followMarker);
    return () => window.cancelAnimationFrame(frameId);
  }, [tooltipOpen]);

  return (
    <>
      <Button layout="content"
        ref={markerRef}
        htmlType="button"
        data-document-marker
        data-comment-id={isPending ? undefined : comment.id}
        aria-label={isPending ? "Ubicación de observación pendiente" : `Observación de ${authorName}`}
        className={clsx(
          "absolute z-[3] flex h-[40px] min-w-[40px] -translate-y-full items-center justify-center border border-[var(--color-neutral-400)] bg-[var(--color-neutral-bg)] transition-[border-color,box-shadow,opacity] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-300)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-neutral-bg)] motion-reduce:transition-none",
          hasMultipleParticipants
            ? "w-auto rounded-[var(--radius-full)] px-[8px]"
            : "w-[40px] rounded-br-[var(--radius-full)] rounded-tl-[var(--radius-full)] rounded-tr-[var(--radius-full)] p-[8px]",
          isPending ? "pointer-events-none animate-pulse" : "cursor-pointer",
          tooltipOpen && !isPending ? "opacity-0" : "opacity-100",
          focused && "border-[var(--color-accent-300)] ring-2 ring-[var(--color-accent-300)] ring-offset-2 ring-offset-[var(--color-neutral-bg)]",
        )}
        style={style}
        onMouseEnter={openTooltip}
        onMouseLeave={scheduleTooltipClose}
        onFocus={openTooltip}
        onBlur={scheduleTooltipClose}
        onClick={(event) => { event.stopPropagation(); if (!isPending) onSelect?.(comment.id); }}
      >
        {hasMultipleParticipants ? (
          <AvatarGroup
            aria-label={`Participantes: ${participants.map((participant) => participant.name).join(", ")}`}
            items={visibleParticipants}
            moreCount={participants.length > visibleParticipants.length
              ? participants.length - visibleParticipants.length
              : null}
            size="S"
          />
        ) : (
          <Avatar
            size="S"
            theme="Brand 1"
            content={avatarSrc ? "Image" : "Icon"}
            name={authorName}
            src={avatarSrc}
            alt={authorName}
            decorative={isPending}
          />
        )}
      </Button>
      <ObservationTooltip
        authorName={authorName}
        avatarSrc={avatarSrc}
        message={comment.message || comment.content}
        closing={tooltipClosing}
        replyCount={replyCount}
        open={tooltipOpen}
        onOpenChange={(nextOpen) => nextOpen ? openTooltip() : scheduleTooltipClose()}
        onReply={onSelect ? () => { setTooltipOpen(false); onSelect(comment.id, { reply: true }); } : undefined}
        position={tooltipOpen ? tooltipPosition : null}
      />
    </>
  );
}

const ViewerButton = forwardRef(function ViewerButton(
  {
    children,
    className,
    disabled,
    label,
    onClick,
    showTooltip = true,
    tooltipPosition = "Top center",
  },
  ref,
) {
  const button = (
    <Button layout="content"
      ref={ref}
      htmlType="button"
      disabled={disabled}
      aria-label={label}
      onClick={onClick}
      className={clsx(
        "flex size-[22px] items-center justify-center rounded-[var(--radius-1)] text-[12px] text-[var(--color-neutral-100-uniform)] transition-colors hover:bg-black/25 disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
    >
      {children}
    </Button>
  );

  return showTooltip ? (
    <Tooltip
      asChild
      portal
      showTip
      text={label}
      tipPosition={tooltipPosition}
    >
      {button}
    </Tooltip>
  ) : (
    button
  );
});

function ExpandIcon({ contracted = false }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="size-[14px]" aria-hidden="true">
      {contracted ? (
        <>
          <path d="M8 3V8H3M12 17V12H17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3.5 7.5L8 3M16.5 12.5L12 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M7 3H3V7M13 17H17V13M17 7V3H13M3 13V17H7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3.5 6.5L7 3M13 17L16.5 13.5M13 3L16.5 6.5M3.5 13.5L7 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="size-[14px]" aria-hidden="true">
      <path d="M4 4L16 16M16 4L4 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PdfToolbar({
  expandButtonRef,
  fullscreen = false,
  onClose,
  onExpand,
  page,
  pageCount,
  updatePage,
  updateZoom,
  zoom,
}) {
  return (
    <div className="flex h-[34px] shrink-0 items-center justify-center overflow-x-auto bg-[#333] px-[12px] text-[10px] text-[var(--color-neutral-100-uniform)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-max items-center gap-[8px]">
        <Input presentation="control"
          htmlType="number"
          min="1"
          max={pageCount}
          value={page}
          aria-label="Página actual"
          onChange={(event) => updatePage(event.target.value)}
          className="h-[18px] w-[30px] rounded-[2px] bg-[#111] px-[4px] text-center outline-none"
        />
        <span>/</span>
        <span>{pageCount}</span>
        <span className="mx-[4px] text-[var(--color-neutral-300)]">|</span>
        <ViewerButton label="Alejar" disabled={zoom <= MIN_ZOOM} onClick={() => updateZoom(zoom - ZOOM_STEP)}>−</ViewerButton>
        <span className="min-w-[42px] rounded-[2px] bg-[#111] px-[4px] py-[2px] text-center">{zoom}%</span>
        <ViewerButton label="Acercar" disabled={zoom >= MAX_ZOOM} onClick={() => updateZoom(zoom + ZOOM_STEP)}>+</ViewerButton>
        <span className="mx-[4px] text-[var(--color-neutral-300)]">|</span>

        {fullscreen ? (
          <ViewerButton
            label="Contraer visor"
            onClick={onClose}
            tooltipPosition="Bottom center"
          >
            <ExpandIcon contracted />
          </ViewerButton>
        ) : (
          <ViewerButton
            ref={expandButtonRef}
            label="Ver en pantalla completa"
            onClick={onExpand}
          >
            <ExpandIcon />
          </ViewerButton>
        )}

        {fullscreen ? (
          <ViewerButton
            label="Cerrar visor"
            onClick={onClose}
            showTooltip={false}
            tooltipPosition="Bottom center"
          >
            <CloseIcon />
          </ViewerButton>
        ) : null}
      </div>
    </div>
  );
}

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

function DocumentFullscreenModal({ children, documentName, onClose, triggerRef, visible }) {
  const [shouldRender, setShouldRender] = useState(visible);
  const [isActive, setIsActive] = useState(false);
  const closeTimeoutRef = useRef(null);
  const frameRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    window.clearTimeout(closeTimeoutRef.current);
    window.cancelAnimationFrame(frameRef.current);

    if (visible) {
      queueMicrotask(() => {
        if (cancelled) return;
        setShouldRender(true);
        setIsActive(false);
        frameRef.current = window.requestAnimationFrame(() => {
          frameRef.current = window.requestAnimationFrame(() => setIsActive(true));
        });
      });
    } else {
      queueMicrotask(() => {
        if (cancelled) return;
        setIsActive(false);
        closeTimeoutRef.current = window.setTimeout(() => {
          setShouldRender(false);
          triggerRef.current?.focus();
        }, MODAL_TRANSITION_MS);
      });
    }

    return () => {
      cancelled = true;
      window.clearTimeout(closeTimeoutRef.current);
      window.cancelAnimationFrame(frameRef.current);
    };
  }, [triggerRef, visible]);

  useEffect(() => {
    if (!visible) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, visible]);

  if (!shouldRender || typeof document === "undefined") return null;

  const transitionStyle = {
    transitionDuration: `${MODAL_TRANSITION_MS}ms`,
    transitionTimingFunction: MODAL_EASING,
  };

  return createPortal(
    <div
      className={clsx(
        "fixed inset-0 z-[60] overflow-hidden bg-[rgba(0,0,0,0.42)] backdrop-blur-[10px] transition-opacity",
        isActive ? "opacity-100" : "opacity-0",
      )}
      style={transitionStyle}
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Vista completa de ${documentName}`}
        className={clsx(
          "flex h-dvh w-dvw p-[16px] transition-[opacity,transform] transform-gpu will-change-transform will-change-opacity max-[1024px]:p-[12px] max-[520px]:p-[8px] motion-reduce:transform-none motion-reduce:transition-none",
          isActive
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-[12px] scale-[0.985] opacity-0",
        )}
        style={transitionStyle}
      >
        <div
          className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-[var(--radius-3)] shadow-[var(--shadow-e2)]"
          onClick={(event) => event.stopPropagation()}
        >
          {children}
        </div>
      </section>
    </div>,
    document.body,
  );
}

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

function DocxViewerSurface({ annotations = [], data, focusedId, onPointCreate, onPointSelect, pendingSelection, title }) {
  const containerRef = useRef(null);
  const [error, setError] = useState("");
  const [sectionBoxes, setSectionBoxes] = useState([]);

  useEffect(() => {
    if (!data || !containerRef.current) return undefined;

    let cancelled = false;
    containerRef.current.replaceChildren();
    queueMicrotask(() => {
      if (!cancelled) setError("");
    });

    renderDocx(data, containerRef.current, undefined, {
      breakPages: true,
      className: "arca-docx",
      ignoreFonts: false,
      inWrapper: true,
      renderFooters: true,
      renderHeaders: true,
    }).then(() => {
      if (cancelled) return;
      const sections = [...containerRef.current.querySelectorAll(".arca-docx")];
      setSectionBoxes(sections.map((section, sectionIndex) => ({
        height: section.offsetHeight,
        left: section.offsetLeft,
        sectionIndex,
        top: section.offsetTop,
        width: section.offsetWidth,
      })));
    }).catch(() => {
      if (!cancelled) setError("No se pudo interpretar el documento Word.");
    });

    return () => {
      cancelled = true;
    };
  }, [data]);

  useEffect(() => {
    const comment = annotations.find((item) => String(item.id) === String(focusedId));
    if (comment?.selection?.kind !== "document-section-point") return;
    const marker = containerRef.current?.parentElement
      ?.querySelector(`[data-document-marker][data-comment-id="${comment.id}"]`);
    (marker || containerRef.current?.querySelectorAll(".arca-docx")?.[comment.selection.sectionIndex])
      ?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }, [annotations, focusedId, sectionBoxes]);

  if (error) {
    return (
      <div className="flex size-full items-center justify-center bg-[var(--color-primary-300)] p-[24px]">
        <EmptyState
          title="No se pudo abrir el documento"
          description={error}
          size="S"
          showFeaturedIcon
          showActions={false}
        />
      </div>
    );
  }

  return (
    <div
      role="document"
      aria-label={`Vista de ${title}`}
      className="size-full overflow-auto bg-[var(--color-neutral-200)] p-[16px] text-[var(--color-text-300)] max-[520px]:p-[8px]"
    >
      <div
        className="relative min-h-full [&_.docx-wrapper]:!bg-transparent [&_.docx-wrapper]:!p-0 [&_.docx]:!mb-[16px] [&_.docx]:!max-w-full [&_.docx]:shadow-[var(--shadow-e1)]"
        onClick={(event) => {
          if (!onPointCreate || event.target.closest("[data-document-marker]")) return;
          const section = event.target.closest(".arca-docx");
          if (!section) return;
          const sections = [...containerRef.current.querySelectorAll(".arca-docx")];
          const sectionIndex = sections.indexOf(section);
          const rect = section.getBoundingClientRect();
          onPointCreate({
            kind: "document-section-point",
            normalizedX: (event.clientX - rect.left) / rect.width,
            normalizedY: (event.clientY - rect.top) / rect.height,
            sectionIndex,
            sectionCount: sections.length,
          });
        }}
      >
        <div ref={containerRef} />
        {[...annotations.filter((comment) => comment.selection?.kind === "document-section-point"),
          ...(pendingSelection?.kind === "document-section-point" ? [{ id: "pending", pointNumber: "", selection: pendingSelection }] : [])].map((comment) => {
          const box = sectionBoxes[comment.selection.sectionIndex];
          if (!box) return null;
          return <DocumentMarker key={comment.id} comment={comment} focused={String(comment.id) === String(focusedId)} onSelect={onPointSelect}
            style={{ left: box.left + comment.selection.normalizedX * box.width, top: box.top + comment.selection.normalizedY * box.height }} />;
        })}
      </div>
    </div>
  );
}

function XlsxViewerSurface({ annotations = [], data, focusedId, onPointCreate, onPointSelect, pendingSelection, title }) {
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const tableRef = useRef(null);
  const [cellBoxes, setCellBoxes] = useState({});
  const workbook = useMemo(() => {
    try {
      return data ? XLSX.read(data, { type: "array" }) : null;
    } catch {
      return null;
    }
  }, [data]);

  const safeSheetIndex = Math.min(activeSheetIndex, Math.max((workbook?.SheetNames?.length || 1) - 1, 0));
  const activeSheetName = workbook?.SheetNames?.[safeSheetIndex] || "";
  const tableHtml = activeSheetName
    ? XLSX.utils.sheet_to_html(workbook.Sheets[activeSheetName], { id: "project-document-workbook" })
    : "";

  useEffect(() => {
    const root = tableRef.current;
    if (!root) return;
    const boxes = {};
    [...root.querySelectorAll("tr")].forEach((row, rowIndex) => {
      [...row.querySelectorAll("td")].forEach((cell, columnIndex) => {
        const address = XLSX.utils.encode_cell({ c: columnIndex, r: rowIndex });
        cell.dataset.cell = address;
        boxes[address] = { height: cell.offsetHeight, left: cell.offsetLeft, top: cell.offsetTop, width: cell.offsetWidth };
      });
    });
    const frameId = window.requestAnimationFrame(() => setCellBoxes(boxes));
    return () => window.cancelAnimationFrame(frameId);
  }, [activeSheetName, tableHtml]);

  useEffect(() => {
    const comment = annotations.find((item) => String(item.id) === String(focusedId));
    const sheetName = comment?.selection?.sheetName;
    if (!sheetName || !workbook?.SheetNames) return;
    const nextIndex = workbook.SheetNames.indexOf(sheetName);
    if (nextIndex >= 0 && nextIndex !== activeSheetIndex) {
      queueMicrotask(() => setActiveSheetIndex(nextIndex));
    }
  }, [activeSheetIndex, annotations, focusedId, workbook]);

  useEffect(() => {
    const comment = annotations.find((item) => String(item.id) === String(focusedId));
    if (comment?.selection?.kind !== "document-cell-point" || comment.selection.sheetName !== activeSheetName) return;
    const marker = tableRef.current
      ?.querySelector(`[data-document-marker][data-comment-id="${comment.id}"]`);
    (marker || tableRef.current?.querySelector(`[data-cell="${comment.selection.cell}"]`))
      ?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }, [activeSheetName, annotations, cellBoxes, focusedId]);

  if (!workbook?.SheetNames?.length) {
    return (
      <div className="flex size-full items-center justify-center bg-[var(--color-primary-300)] p-[24px]">
        <EmptyState title="No se pudo abrir el libro" description="El archivo Excel está dañado o no contiene hojas visibles."
          size="S" showFeaturedIcon showActions={false} />
      </div>
    );
  }

  return (
    <div className="flex size-full min-w-0 flex-col overflow-hidden bg-[var(--color-neutral-100)]">
      <div
        role="tablist"
        aria-label={`Hojas de ${title}`}
        className="flex shrink-0 gap-[4px] overflow-x-auto border-b border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] p-[8px]"
      >
        {workbook.SheetNames.map((sheetName, index) => (
          <Button layout="content"
            key={sheetName}
            htmlType="button"
            role="tab"
            aria-selected={index === safeSheetIndex}
            className={clsx(
              "shrink-0 rounded-[var(--radius-2)] px-[12px] py-[8px] text-body-4",
              index === safeSheetIndex
                ? "bg-[var(--color-neutral-200)] text-[var(--color-text-300)]"
                : "text-[var(--color-text-100)] hover:bg-[var(--color-neutral-10)]",
            )}
            onClick={() => setActiveSheetIndex(index)}
          >
            {sheetName}
          </Button>
        ))}
      </div>
      <div
        ref={tableRef}
        role="region"
        aria-label={`Hoja ${activeSheetName}`}
        className="relative min-h-0 flex-1 overflow-auto p-[12px] [&_table]:relative [&_table]:border-collapse [&_td]:max-w-[360px] [&_td]:break-words [&_td]:border [&_td]:border-[var(--color-neutral-200)] [&_td]:p-[8px] [&_td]:align-top [&_th]:border [&_th]:border-[var(--color-neutral-200)] [&_th]:bg-[var(--color-neutral-10)] [&_th]:p-[8px]"
        onClick={(event) => {
          if (!onPointCreate || event.target.closest("[data-document-marker]")) return;
          const cell = event.target.closest("td[data-cell]");
          if (!cell) return;
          const rect = cell.getBoundingClientRect();
          onPointCreate({ kind: "document-cell-point", sheetName: activeSheetName, cell: cell.dataset.cell,
            normalizedX: (event.clientX - rect.left) / rect.width, normalizedY: (event.clientY - rect.top) / rect.height });
        }}
      >
        <div dangerouslySetInnerHTML={{ __html: tableHtml }} />
        {[...annotations.filter((comment) => comment.selection?.kind === "document-cell-point" && comment.selection.sheetName === activeSheetName),
          ...(pendingSelection?.kind === "document-cell-point" && pendingSelection.sheetName === activeSheetName ? [{ id: "pending", pointNumber: "", selection: pendingSelection }] : [])].map((comment) => {
          const box = cellBoxes[comment.selection.cell];
          if (!box) return null;
          return <DocumentMarker key={comment.id} comment={comment} focused={String(comment.id) === String(focusedId)} onSelect={onPointSelect}
            style={{ left: 12 + box.left + comment.selection.normalizedX * box.width, top: 12 + box.top + comment.selection.normalizedY * box.height }} />;
        })}
      </div>
    </div>
  );
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
        {kind === "docx" ? (
          <DocxViewerSurface annotations={annotations} data={state.data} focusedId={focusedId} onPointCreate={onPointCreate} onPointSelect={onPointSelect} pendingSelection={pendingSelection} title={title} />
        ) : (
          <XlsxViewerSurface annotations={annotations} data={state.data} focusedId={focusedId} onPointCreate={onPointCreate} onPointSelect={onPointSelect} pendingSelection={pendingSelection} title={title} />
        )}
      </div>
    </div>
  );
}

export function ProjectDocumentViewerModal({
  document,
  initialFocusedCommentId = null,
  onClose,
  open = false,
  projectId,
  triggerRef,
}) {
  const { readOnly } = useProjectReadOnly();
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
    enabled: open && kind !== "unsupported",
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

    const controller = new AbortController();
    let cancelled = false;
    let loadingTask;

    queueMicrotask(() => {
      if (cancelled) return;
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

    fetch(source, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("DOCUMENT_LOAD_FAILED");
        return response.arrayBuffer();
      })
      .then((buffer) => {
        if (kind !== "pdf") return { buffer };
        loadingTask = getDocument({ data: new Uint8Array(buffer) });
        return loadingTask.promise.then((documentProxy) => ({
          buffer,
          documentProxy,
        }));
      })
      .then(({ buffer, documentProxy = null }) => {
        if (cancelled) return;
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
        if (cancelled || error.name === "AbortError") return;
        setLoadState({
          data: null,
          documentProxy: null,
          error: "Comprueba tu conexión e inténtalo nuevamente.",
          pageCount: 1,
          source,
          status: "error",
        });
      });

    return () => {
      cancelled = true;
      controller.abort();
      loadingTask?.destroy();
    };
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
  } else if (kind === "docx") {
    viewer = <DocxViewerSurface annotations={comments} data={loadState.data} focusedId={focusedCommentId} onPointCreate={readOnly ? undefined : handleSelectionChange} onPointSelect={handlePointSelect} pendingSelection={pendingSelection} title={documentName} />;
  } else if (kind === "xlsx") {
    viewer = <XlsxViewerSurface annotations={comments} data={loadState.data} focusedId={focusedCommentId} onPointCreate={readOnly ? undefined : handleSelectionChange} onPointSelect={handlePointSelect} pendingSelection={pendingSelection} title={documentName} />;
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
          <ProjectDocumentCard
            closeIcon={<CloseIcon />}
            document={document}
            onClose={onClose}
            variant="modal"
          />
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {viewer}
          </div>
        </div>
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

    const controller = new AbortController();
    let cancelled = false;
    let loadingTask;

    fetch(source, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("DOCUMENT_LOAD_FAILED");
        return response.arrayBuffer();
      })
      .then((buffer) => {
        loadingTask = getDocument({ data: new Uint8Array(buffer) });
        return loadingTask.promise;
      })
      .then((pdfDocument) => {
        if (cancelled) return;
        setLoadState({
          documentProxy: pdfDocument,
          pageCount: pdfDocument.numPages,
          source,
          status: "loaded",
        });
      })
      .catch((error) => {
        if (!cancelled && error.name !== "AbortError") {
          setLoadState({
            documentProxy: null,
            pageCount: 1,
            source,
            status: "error",
          });
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
      loadingTask?.destroy();
    };
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
