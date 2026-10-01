import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import ObservationTooltip from "../../ObservationTooltip/ObservationTooltip.jsx";
import { getObservationTypeLabel } from "../../../../utils/commentDisplay.js";
import { getPanoramaOrientation } from "../../../../utils/panoramaCoordinates.js";
import { isPanoramaPointSelection } from "./model3DSelection.js";
const VIEWER_3D_OBSERVATION_LABEL = getObservationTypeLabel("panorama");

function getViewerPointPosition(selection) {
  if (isPanoramaPointSelection(selection) && selection.viewerPoint) {
    const x = Number(selection.viewerPoint.normalizedX);
    const y = Number(selection.viewerPoint.normalizedY);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }

    return {
      x,
      y,
    };
  }

  const pixels = selection?.displayPixels ?? selection?.imagePixels;
  const naturalSize = selection?.naturalSize;

  if (!pixels || !naturalSize?.width || !naturalSize?.height) {
    return null;
  }

  const x = (pixels.x + pixels.width / 2) / naturalSize.width;
  const y = (pixels.y + pixels.height / 2) / naturalSize.height;

  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function formatModelViewerPosition(vector) {
  if (!vector) {
    return null;
  }

  if (typeof vector === "string") {
    const position = vector
      .trim()
      .split(/\s+/)
      .map((value) => (/[a-z%]+$/i.test(value) ? value : `${value}m`))
      .join(" ");

    return position ? position : null;
  }

  const { x, y, z } = vector;

  if (![x, y, z].every((value) => Number.isFinite(value))) {
    return null;
  }

  return `${x}m ${y}m ${z}m`;
}

function formatModelViewerNormal(vector) {
  if (!vector) {
    return null;
  }

  if (typeof vector === "string") {
    const normal = vector.trim();

    return normal ? normal : null;
  }

  const { x, y, z } = vector;

  if (![x, y, z].every((value) => Number.isFinite(value))) {
    return null;
  }

  return `${x} ${y} ${z}`;
}

function getViewerModelPoint(selection) {
  const viewerPoint = selection?.viewerPoint;
  const position = formatModelViewerPosition(viewerPoint?.modelPosition);
  const normal = formatModelViewerNormal(viewerPoint?.modelNormal);

  if (!position || !normal) {
    return null;
  }

  return { normal, position };
}

function Model3DAnnotationMarker({
  active = false,
  className,
  item,
  onSelect,
  onReply,
  style,
  ...props
}) {
  const markerRef = useRef(null);
  const tooltipCloseTimerRef = useRef(null);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState(null);
  useEffect(() => () => window.clearTimeout(tooltipCloseTimerRef.current), []);
  const pointNumber = Number(item.pointNumber) || "";
  const tooltipText = pointNumber
    ? `${VIEWER_3D_OBSERVATION_LABEL} ${pointNumber}`
    : VIEWER_3D_OBSERVATION_LABEL;
  const canShowTooltip =
    tooltipOpen && !item.pending && tooltipPosition && typeof document !== "undefined";

  const openTooltip = () => {
    window.clearTimeout(tooltipCloseTimerRef.current);
    const rect = markerRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    setTooltipPosition({
      anchorBottom: rect.bottom,
      anchorTop: rect.top,
      anchorX: rect.left + rect.width / 2,
    });
    setTooltipOpen(true);
  };
  const scheduleTooltipClose = () => {
    window.clearTimeout(tooltipCloseTimerRef.current);
    tooltipCloseTimerRef.current = window.setTimeout(() => setTooltipOpen(false), 120);
  };

  useEffect(() => {
    if (!tooltipOpen) return undefined;
    let frameId;
    let previous = "";
    const followMarker = () => {
      const rect = markerRef.current?.getBoundingClientRect();
      if (rect) {
        const signature = `${rect.left.toFixed(1)}:${rect.top.toFixed(1)}:${rect.bottom.toFixed(1)}:${rect.width.toFixed(1)}`;
        if (signature !== previous) {
          previous = signature;
          setTooltipPosition({
            anchorBottom: rect.bottom,
            anchorTop: rect.top,
            anchorX: rect.left + rect.width / 2,
          });
        }
      }
      frameId = window.requestAnimationFrame(followMarker);
    };
    frameId = window.requestAnimationFrame(followMarker);
    return () => window.cancelAnimationFrame(frameId);
  }, [tooltipOpen]);

  return (
    <>
      <button
        type="button"
        ref={markerRef}
        className={clsx(
          "group relative flex size-[40px] appearance-none items-center justify-center rounded-full border-0 bg-transparent p-0 transition-[opacity,transform] duration-200 ease-out",
          item.pending
            ? "pointer-events-none"
            : "pointer-events-auto cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-neutral-100-uniform)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-accent-300)]",
          active && "scale-125",
          item.pending && "animate-pulse",
          className,
        )}
        style={style}
        aria-label={tooltipText}
        onFocus={openTooltip}
        onBlur={scheduleTooltipClose}
        onMouseEnter={openTooltip}
        onMouseLeave={scheduleTooltipClose}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (!item.pending) {
            onSelect?.(item.id);
          }
        }}
        {...props}
      >
        <span className="flex h-[24px] min-h-[24px] w-[24px] min-w-[24px] flex-none items-center justify-center rounded-full border-2 border-[var(--color-neutral-100-uniform)] bg-[var(--color-accent-300)] text-[11px] font-semibold leading-none text-[var(--color-neutral-100-uniform)] shadow-[0_0_0_4px_rgba(255,68,49,0.22),0_2px_8px_rgba(0,0,0,0.28)] transition-[box-shadow,transform,filter] duration-200 ease-out group-hover:scale-[1.08] group-hover:brightness-110 group-hover:shadow-[0_0_0_6px_rgba(255,68,49,0.18),0_4px_12px_rgba(0,0,0,0.32)] group-focus-visible:scale-[1.08]">
          {item.pending ? "" : pointNumber}
        </span>
      </button>

      {canShowTooltip ? (
        <ObservationTooltip
          authorName={item.name || item.author?.name}
          avatarSrc={item.avatarSrc}
          message={item.message || item.content}
          replyCount={item.replyCount}
          open={tooltipOpen}
          position={tooltipPosition}
          onOpenChange={(nextOpen) => nextOpen ? openTooltip() : scheduleTooltipClose()}
          onReply={onReply ? () => onReply(item.id) : undefined}
        />
      ) : null}
    </>
  );
}

export function Model3DHotspots({
  annotations = [],
  focusedAnnotationId = null,
  onAnnotationReply,
  onAnnotationSelect,
  pendingSelection = null,
}) {
  const hotspotItems = [
    ...annotations.map((comment) => ({
      id: comment.id,
      active: String(comment.id) === String(focusedAnnotationId),
      pointNumber: comment.pointNumber,
      selection: comment.selection,
      name: comment.name,
      avatarSrc: comment.avatarSrc,
      message: comment.message,
      author: comment.author,
      content: comment.content,
      replyCount: comment.replyCount,
    })),
    pendingSelection
      ? {
          id: "pending",
          active: true,
          pending: true,
          selection: pendingSelection,
        }
      : null,
  ].filter(Boolean);

  return (
    <>
      {hotspotItems.map((item) => {
        const point = getViewerModelPoint(item.selection);

        if (!point) {
          return null;
        }

        return (
          <Model3DAnnotationMarker
            key={item.id}
            item={item}
            slot={`hotspot-viewer3d-comment-${item.id}`}
            data-position={point.position}
            data-normal={point.normal}
            data-visibility-attribute="visible"
            style={{
              opacity: "var(--min-hotspot-opacity, 1)",
            }}
            active={item.active}
            onSelect={onAnnotationSelect}
            onReply={onAnnotationReply}
          />
        );
      })}
    </>
  );
}

export function Model3DCommentMarkers({
  annotations = [],
  focusedAnnotationId = null,
  modelViewerRef,
  onAnnotationReply,
  onAnnotationSelect,
  pendingSelection = null,
}) {
  const markerItems = useMemo(
    () => [
      ...annotations.map((comment) => ({
        id: comment.id,
        active: String(comment.id) === String(focusedAnnotationId),
        pointNumber: comment.pointNumber,
        selection: comment.selection,
        name: comment.name,
        avatarSrc: comment.avatarSrc,
        message: comment.message,
        author: comment.author,
        content: comment.content,
        replyCount: comment.replyCount,
      })),
      pendingSelection
        ? {
            id: "pending",
            active: true,
            pending: true,
            selection: pendingSelection,
          }
        : null,
    ].filter(Boolean),
    [annotations, focusedAnnotationId, pendingSelection],
  );
  const [projectedPoints, setProjectedPoints] = useState({});

  useEffect(() => {
    let frameId;
    let previousSignature = "";
    const update = () => {
      const viewer = modelViewerRef?.current;
      const next = {};
      markerItems.forEach((item) => {
        const orientation = getPanoramaOrientation(item.selection);
        const projected = orientation
          ? viewer?.projectPanoramaPoint?.(orientation.yaw, orientation.pitch)
          : null;
        const fallback = getViewerPointPosition(item.selection);
        next[item.id] = projected || (fallback
          ? { visible: true, x: fallback.x, y: fallback.y }
          : { visible: false, x: 0, y: 0 });
      });
      const signature = Object.entries(next)
        .map(([id, point]) => `${id}:${point.visible ? 1 : 0}:${point.x.toFixed(4)}:${point.y.toFixed(4)}`)
        .join("|");
      if (signature !== previousSignature) {
        previousSignature = signature;
        setProjectedPoints(next);
      }
      frameId = window.requestAnimationFrame(update);
    };
    frameId = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(frameId);
  }, [markerItems, modelViewerRef]);

  return (
    <div className="pointer-events-none absolute inset-0 z-[12]">
      {markerItems.map((item) => {
        const point = projectedPoints[item.id];

        if (!point?.visible) {
          return null;
        }

        return (
          <Model3DAnnotationMarker
            key={item.id}
            item={item}
            className="-translate-x-1/2 -translate-y-1/2 transition-transform"
            style={{
              left: `${Math.min(Math.max(point.x, 0), 1) * 100}%`,
              position: "absolute",
              top: `${Math.min(Math.max(point.y, 0), 1) * 100}%`,
            }}
            active={item.active}
            onSelect={onAnnotationSelect}
            onReply={onAnnotationReply}
          />
        );
      })}
    </div>
  );
}

